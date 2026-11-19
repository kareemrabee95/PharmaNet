#!/usr/bin/env python3
"""
gen-yaml.py - generates every Caliper benchmark YAML used by the corrected methodology.

  setup-eda    (1 worker)   RC/CoA for the 6 drugs + RC for the PO_GTIN_COUNT extra GTINs
  seed         (8 workers)  2000 companies + 4000 pouches   -> identical dataset for every run
  verify-seed  (8 workers)  reads every seeded pouch once   -> Fail must be 0
  stress-read  (-w N)       warm-up -> 3 read functions x rate sweep (60 s) -> drift check
  stress-write (-w N)       warm-up -> 3 write functions x rate sweep (60 s); order rotated by --rep
  model-sweep  (-w N)       N (companies) and P (pouches) sweeps at low load, for the complexity-model fit

Only the standard library is needed.  Example:
  python3 gen-yaml.py stress-write -w 8 --rep 2 > generated/write.yaml
"""
import argparse
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
KAREEM = os.path.join(HERE, 'caliper-benchmarks-local', 'benchmarks', 'scenario', 'simple', 'kareem')
MOD = 'benchmarks/scenario/simple/kareem/'

FIXED_WORKERS = {'setup-eda': 1, 'seed': 8, 'verify-seed': 8, 'probe': 1, 'probe-eda': 1, 'probe-man': 1, 'probe-dist': 1}
DEFAULT_RATES = [10, 40, 80, 160, 320]
READ_FUNCS = ['viewDrugCurrentState', 'queryAllCompanies', 'queryDrugUnits']
WRITE_FUNCS = ['createPO', 'registerCompany', 'addDrug']
MEASURE_SECONDS = 60
WARMUP_SECONDS = 30
COOLDOWN_SECONDS = 30
PO_WINDOW_MARGIN = 1.15


def read_cfg_int(name):
    text = open(os.path.join(KAREEM, 'mainConfig.js'), encoding='utf-8').read()
    m = re.search(r'\b' + name + r'\s*:\s*(\d+)\s*,', text)
    if not m:
        sys.exit('cannot read %s from mainConfig.js' % name)
    return int(m.group(1))


PO_GTIN_COUNT = read_cfg_int('PO_GTIN_COUNT')
SEED_WORKERS = read_cfg_int('SEED_WORKERS')
NUM_BUYERS = read_cfg_int('NUM_BUYERS')
PO_CAPACITY = SEED_WORKERS * NUM_BUYERS * PO_GTIN_COUNT

MONITORS = """
monitors:
  resource:
  - module: prometheus
    options:
      url: "http://prometheus:9090"
      metrics:
        include: [pharma, caliper]
        queries:
        - name: CPU% (avg)
          query: 'sum(rate(container_cpu_usage_seconds_total{name=~".+"}[1m])) by (name) * 100'
          step: 5
          label: name
          statistic: avg
        - name: CPU% (max)
          query: 'sum(rate(container_cpu_usage_seconds_total{name=~".+"}[1m])) by (name) * 100'
          step: 5
          label: name
          statistic: max
        - name: Memory(MB) (avg)
          query: 'sum(container_memory_working_set_bytes{name=~".+"}) by (name)'
          step: 5
          label: name
          statistic: avg
          multiplier: 0.000001
        - name: Memory(MB) (max)
          query: 'sum(container_memory_working_set_bytes{name=~".+"}) by (name)'
          step: 5
          label: name
          statistic: max
          multiplier: 0.000001
"""


def q(value):
    s = str(value)
    if re.search(r'[:#\'"{}\[\],&*!|>%@`]', s):
        return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'
    return s


class Round:
    def __init__(self, label, js, tps, seconds=None, tx=None, args=None, desc=''):
        self.label, self.js, self.tps = label, js, tps
        self.seconds, self.tx, self.args, self.desc = seconds, tx, args or {}, desc

    def est_seconds(self):
        base = self.seconds if self.seconds else (self.tx / float(self.tps))
        return base + 12          # ~12 s of Caliper round set-up/tear-down

    def emit(self):
        out = ['  - label: ' + q(self.label)]
        if self.desc:
            out.append('    description: ' + q(self.desc))
        if self.seconds:
            out.append('    txDuration: %d' % self.seconds)
        else:
            out.append('    txNumber: %d' % self.tx)
        out += ['    rateControl:', '      type: fixed-rate', '      opts:', '        tps: %s' % self.tps,
                '    workload:', '      module: ' + MOD + self.js]
        if self.args:
            out.append('      arguments:')
            for k, v in self.args.items():
                out.append('        %s: %s' % (k, q(v)))
        return '\n'.join(out)


def cooldown(i):
    return Round('cooldown_%d' % i, 'viewDrugCurrentState.js', 2, COOLDOWN_SECONDS,
                 args={'maxSerialPerWorker': 500}, desc='idle gap so the previous round backlog drains (excluded from analysis)')


def recovery(fn, js, a):
    return Round('recovery_%s' % fn, js, 1, 60, args=dict(a),
                 desc='1 tps for 60 s: lets a crashed/overloaded chaincode restart and drain before the next block (excluded)')


def tail_rates(name, rates, args):
    if args.cap_per_worker:
        cap = args.cap_per_worker * args.workers
        dropped = [r for r in rates if r > cap]
        if dropped:
            sys.stderr.write('note: %s overload rates %s dropped (> %d TPS per worker x %d workers)\n'
                             % (name, dropped, args.cap_per_worker, args.workers))
        rates = [r for r in rates if r <= cap]
    return sorted(set(rates))


def rates_for(name, args):
    rates = args.rates.get(name, DEFAULT_RATES)
    if args.cap_per_worker:
        cap = args.cap_per_worker * args.workers
        kept = [r for r in rates if r <= cap]
        dropped = [r for r in rates if r > cap]
        if dropped:
            sys.stderr.write('note: %s rates %s dropped (> %d TPS per worker x %d workers)\n'
                             % (name, dropped, args.cap_per_worker, args.workers))
        rates = kept
    for r in rates:
        if r / float(args.workers) > 80:
            sys.stderr.write('warning: %s @ %d TPS = %.0f TPS/worker - the load generator will probably be the '
                             'bottleneck (check Send Rate >= 95%% of target)\n' % (name, r, r / float(args.workers)))
    return sorted(set(rates))


# ------------------------------------------------------------------ benchmarks

def setup_eda(args):
    return [
        Round('setup_prime', 'prime.js', 2, 60,
              desc='wake the freshly installed chaincode on every peer - writes nothing; failures here are ignored'),
        Round('setup_eda_core', 'setupEdaDocuments.js', 5, tx=12, args={'phase': 'all'},
              desc='RC and CoA for the 6 benchmark drugs (serialized)'),
        Round('setup_eda_po_rc', 'setupEdaDocuments.js', 20, tx=PO_GTIN_COUNT, args={'phase': 'rcpo'},
              desc='RC for the extra GTINs that form the createPO key space'),
    ]


def seed(args):
    return [
        Round('seed_registerCompany', 'registerCompany.js', 40, tx=SEED_WORKERS * 250,
              desc='2000 companies (250 per seed worker) - fixed pool'),
        Round('seed_addDrug', 'addDrug.js', 40, tx=SEED_WORKERS * 500,
              desc='4000 pouches (500 serials per seed worker)'),
    ]


def verify_seed(args):
    return [Round('verify_view', 'viewDrugCurrentState.js', 100, tx=SEED_WORKERS * 500,
                  args={'maxSerialPerWorker': 500}, desc='read every seeded pouch once - Fail must be 0')]


def wanted(args, fn):
    return not args.only or fn in args.only


def stress_read(args):
    warm = {
        'viewDrugCurrentState': Round('warmup_viewDrugCurrentState', 'viewDrugCurrentState.js', 50, WARMUP_SECONDS,
                                      args={'maxSerialPerWorker': 500}, desc='warm-up (excluded)'),
        'queryAllCompanies': Round('warmup_queryAllCompanies', 'queryAllCompanies.js', 5, WARMUP_SECONDS, desc='warm-up (excluded)'),
        'queryDrugUnits': Round('warmup_queryDrugUnits', 'queryDrugUnits.js', 2, WARMUP_SECONDS, desc='warm-up (excluded)'),
    }
    rounds = [warm[f] for f in READ_FUNCS if wanted(args, f)] + [cooldown(0)]
    jsmap = {'viewDrugCurrentState': ('viewDrugCurrentState.js', {'maxSerialPerWorker': 500}),
             'queryAllCompanies': ('queryAllCompanies.js', {}),
             'queryDrugUnits': ('queryDrugUnits.js', {})}
    for i, fn in enumerate(READ_FUNCS, start=1):
        if not wanted(args, fn):
            continue
        js, a = jsmap[fn]
        for r in rates_for(fn, args):
            rounds.append(Round('%s_tps%d' % (fn, r), js, r, MEASURE_SECONDS, args=dict(a),
                                desc='%s at %d tps (60 s)' % (fn, r)))
        rounds.append(recovery(fn, js, a) if fn in ('queryAllCompanies', 'queryDrugUnits') else cooldown(i))
    if wanted(args, 'viewDrugCurrentState'):
        rounds.append(Round('drift_viewDrugCurrentState_tps10', 'viewDrugCurrentState.js', 10, MEASURE_SECONDS,
                            args={'maxSerialPerWorker': 500}, desc='same as the first 10-tps round - drift check'))

    # OVERLOAD TAIL: rates above the knee (they crash the single-threaded chaincode). They run LAST, after every
    # clean round and after the drift check, so a crash cannot contaminate anything measured before it.
    for fn in ('queryAllCompanies', 'queryDrugUnits'):
        tail = args.tail.get(fn)
        if not tail or not wanted(args, fn):
            continue
        js, a = jsmap[fn]
        tail = tail_rates(fn, tail, args)
        for r in tail:
            rounds.append(Round('%s_tps%d' % (fn, r), js, r, MEASURE_SECONDS, args=dict(a),
                                desc='%s at %d tps (60 s) - OVERLOAD tail, expect failures/crashes' % (fn, r)))
        if tail:
            rounds.append(recovery(fn, js, a))
    return rounds


def stress_write(args):
    orders = [['createPO', 'registerCompany', 'addDrug'],
              ['registerCompany', 'addDrug', 'createPO'],
              ['addDrug', 'createPO', 'registerCompany']]
    order = [f for f in orders[(max(args.rep, 1) - 1) % 3] if wanted(args, f)]
    sys.stderr.write('write order for rep %d: %s\n' % (args.rep, ' -> '.join(order)))

    # disjoint createPO windows (warm-up first, then rounds in the order they are executed)
    po_cursor = 0
    po_window = {}

    def alloc(key, tps, seconds):
        nonlocal po_cursor
        size = int(math.ceil(tps * seconds * PO_WINDOW_MARGIN)) + 50
        po_window[key] = (po_cursor, size)
        po_cursor += size

    alloc('warm', 20, WARMUP_SECONDS)
    for r in rates_for('createPO', args):
        alloc(r, r, MEASURE_SECONDS)
    if po_cursor > PO_CAPACITY:
        sys.exit('createPO needs %d unique (buyer,gtin) pairs but only %d exist - raise PO_GTIN_COUNT in '
                 'mainConfig.js (and re-run setup-eda)' % (po_cursor, PO_CAPACITY))

    def block(fn, idx):
        out = []
        if fn == 'createPO':
            ws, wz = po_window['warm']
            out.append(Round('warmup_createPO', 'createPO.js', 20, WARMUP_SECONDS,
                             args={'windowStart': ws, 'windowSize': wz}, desc='warm-up (excluded)'))
            for r in rates_for(fn, args):
                ws, wz = po_window[r]
                out.append(Round('createPO_tps%d' % r, 'createPO.js', r, MEASURE_SECONDS,
                                 args={'windowStart': ws, 'windowSize': wz}, desc='createPO at %d tps (60 s)' % r))
        elif fn == 'registerCompany':
            out.append(Round('warmup_registerCompany', 'registerCompany.js', 20, WARMUP_SECONDS,
                             args={'tag': 'warm'}, desc='warm-up (excluded)'))
            for r in rates_for(fn, args):
                out.append(Round('registerCompany_tps%d' % r, 'registerCompany.js', r, MEASURE_SECONDS,
                                 args={'tag': 'rc%d' % r}, desc='registerCompany at %d tps (60 s)' % r))
        else:
            out.append(Round('warmup_addDrug', 'addDrug.js', 20, WARMUP_SECONDS,
                             args={'tag': 'warm'}, desc='warm-up (excluded)'))
            for r in rates_for(fn, args):
                out.append(Round('addDrug_tps%d' % r, 'addDrug.js', r, MEASURE_SECONDS,
                                 args={'tag': 'wr%d' % r}, desc='addDrug at %d tps (60 s)' % r))
        out.append(cooldown(idx))
        return out

    rounds = []
    for i, fn in enumerate(order, start=1):
        rounds += block(fn, i)
    return rounds


def model_sweep(args):
    """latency vs N (companies) and P (pouches per GTIN) at LOW load, for the complexity-model fit.
       expected sizes (seed = 8 workers):  P(drug 0) = 664 -> 1328 -> 2656    N = 2000 -> 4000 -> 8000 -> 16000"""
    def meas(tag):
        return [
            Round('sweep_%s_view' % tag, 'viewDrugCurrentState.js', 20, 20, args={'maxSerialPerWorker': 500},
                  desc='O(1) control at %s' % tag),
            Round('sweep_%s_qac' % tag, 'queryAllCompanies.js', 5, 20, desc='queryAllCompanies at %s' % tag),
            Round('sweep_%s_qdu' % tag, 'queryDrugUnits.js', 2, 20, args={'drugIndex': 0},
                  desc='queryDrugUnits (drug 0 only) at %s' % tag),
        ]

    rounds = [
        Round('warmup_view', 'viewDrugCurrentState.js', 20, 20, args={'maxSerialPerWorker': 500}, desc='warm-up (excluded)'),
        Round('warmup_qac', 'queryAllCompanies.js', 5, 20, desc='warm-up (excluded)'),
        Round('warmup_qdu', 'queryDrugUnits.js', 2, 20, args={'drugIndex': 0}, desc='warm-up (excluded)'),
    ]
    rounds += meas('P0_N0')
    rounds.append(Round('sweepadd_P1', 'addDrug.js', 80, tx=4000, args={'tag': 'swp1'}, desc='+4000 pouches'))
    rounds += meas('P1_N0')
    rounds.append(Round('sweepadd_P2', 'addDrug.js', 80, tx=8000, args={'tag': 'swp2'}, desc='+8000 pouches'))
    rounds += meas('P2_N0')
    rounds.append(Round('sweepadd_N1', 'registerCompany.js', 80, tx=2000, args={'tag': 'swn1'}, desc='+2000 companies'))
    rounds += meas('P2_N1')
    rounds.append(Round('sweepadd_N2', 'registerCompany.js', 80, tx=4000, args={'tag': 'swn2'}, desc='+4000 companies'))
    rounds += meas('P2_N2')
    rounds.append(Round('sweepadd_N3', 'registerCompany.js', 80, tx=8000, args={'tag': 'swn3'}, desc='+8000 companies'))
    rounds += meas('P2_N3')
    return rounds


def probe(args):
    """4 short rounds, one per identity/path - to check that every peer in the connection profiles works.
       Needs a seeded ledger. addDrug adds ~100 pouches: reset before any official run."""
    return [
        Round('probe_eda_submit', 'prime.js', 5, 20, desc='EDA identity - submit path (writes nothing)'),
        Round('probe_manufacturer_submit', 'addDrug.js', 5, 20, args={'tag': 'probe'}, desc='manufacturer identity - submit path'),
        Round('probe_manufacturer_read', 'viewDrugCurrentState.js', 5, 20, args={'maxSerialPerWorker': 500}, desc='manufacturer identity - evaluate path'),
        Round('probe_eda_read', 'queryAllCompanies.js', 5, 20, desc='EDA identity - evaluate path (queryAllCompanies)'),
        Round('probe_consumer_view', 'viewDrugCurrentState.js', 5, 20, args={'maxSerialPerWorker': 500, 'identity': 'consumer'},
              desc='consumer identity - evaluate path (viewDrugCurrentState)'),
    ]


def probe_eda(args):
    return [Round('endorse_eda', 'registerCompany.js', 10, 20, args={'tag': 'ep'}, desc='200 registerCompany (EDA identity) - counts endorsements per tx')]


def probe_man(args):
    return [Round('endorse_man', 'addDrug.js', 10, 20, args={'tag': 'ep'}, desc='200 addDrug (manufacturer identity) - counts endorsements per tx')]


def probe_dist(args):
    return [Round('endorse_dist', 'createPO.js', 10, 20, args={'windowStart': 90000, 'windowSize': 400},
                  desc='200 createPO (distributor identity) - counts endorsements per tx')]


BENCHES = {'probe-eda': probe_eda, 'probe-man': probe_man, 'probe-dist': probe_dist, 'probe': probe, 'setup-eda': setup_eda, 'seed': seed, 'verify-seed': verify_seed, 'stress-read': stress_read,
           'stress-write': stress_write, 'model-sweep': model_sweep}


def parse_rates(items):
    out = {}
    for it in items or []:
        name, _, vals = it.partition('=')
        out[name] = [int(v) for v in vals.split(',') if v]
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('bench', choices=sorted(BENCHES))
    ap.add_argument('-w', '--workers', type=int, default=4)
    ap.add_argument('--rep', type=int, default=1, help='repetition number (rotates the write-function order)')
    ap.add_argument('--rates', action='append', metavar='FUNC=a,b,c', help='override the rate grid of one function')
    ap.add_argument('--cap-per-worker', type=int, default=0, help='drop rates above N TPS per worker (e.g. 80)')
    ap.add_argument('--tail', action='append', metavar='FUNC=a,b,c',
                    help='stress-read: extra OVERLOAD rates for one function, run at the very end of the same run')
    ap.add_argument('--only', help='comma-separated functions to include, e.g. queryDrugUnits,queryAllCompanies (pilot refinement)')
    ap.add_argument('-o', '--out')
    args = ap.parse_args()
    args.rates = parse_rates(args.rates)
    args.tail = parse_rates(args.tail)
    args.only = [x for x in (args.only or '').split(',') if x]

    if args.bench in FIXED_WORKERS:
        if args.workers not in (4, FIXED_WORKERS[args.bench]):
            sys.stderr.write('note: %s always uses %d workers\n' % (args.bench, FIXED_WORKERS[args.bench]))
        args.workers = FIXED_WORKERS[args.bench]

    rounds = BENCHES[args.bench](args)
    est = sum(r.est_seconds() for r in rounds)

    text = ['# GENERATED by gen-yaml.py - do not edit by hand',
            '# command : gen-yaml.py ' + ' '.join(sys.argv[1:]),
            '# rounds  : %d   estimated duration: %.0f min' % (len(rounds), est / 60.0),
            'test:',
            '  name: pharma-network %s' % args.bench,
            '  description: %s (workers=%d)' % (args.bench, args.workers),
            '  workers:',
            '    number: %d' % args.workers,
            '  rounds:', '']
    text.append('\n\n'.join(r.emit() for r in rounds))
    text.append(MONITORS)
    doc = '\n'.join(text)

    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            f.write(doc)
    else:
        sys.stdout.write(doc)
    sys.stderr.write('%s: %d rounds, ~%.0f min\n' % (args.bench, len(rounds), est / 60.0))


if __name__ == '__main__':
    main()
