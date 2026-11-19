#!/usr/bin/env python3
"""
aggregate.py - turns the Caliper console logs written by run-benchmarks.sh into paper-ready numbers.

  aggregate.py quick  reports/stress-write-8w-rep1.log        failing / generator-limited rounds of one log
  aggregate.py check-seed reports/R-seed.log reports/R-verify.log   dataset sanity (used by experiment.sh)
  aggregate.py summary 'reports/stress-read-8w-rep*.log' [--csv out.csv]   mean +- SD over repetitions
  aggregate.py sweep   'reports/model-sweep-*.log'            fit latency vs N / P  (R^2)
  aggregate.py compare-workers 'reports/stress-read-[248]w-rep[123].log'   same result with 2, 4 and 8 workers?
  aggregate.py progress --workers "4 2"                   which runs are done / running / pending, and the estimated end
  aggregate.py validate 'reports/stress-*-8w-rep[123].log' [--reps "1 2 3"] [-v]   is every official run sound? (PASS/WARN/FAIL)
  aggregate.py state-size reports/stress-write-8w-rep1.log [--couch-rows N]   companies / pouches / POs in the world state at the start of every round

File names must follow  <bench>-<W>w-rep<R>[-variant].log  (run-benchmarks.sh does this).
Only the standard library is used.
"""
import argparse
import csv
import glob
import math
import os
import re
import statistics
import sys

ROW = re.compile(
    r'\|\s*([A-Za-z0-9_.\-]+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([\d.]+|-)\s*\|\s*([\d.]+|-)\s*\|'
    r'\s*([\d.]+|-)\s*\|\s*([\d.]+|-)\s*\|\s*([\d.]+|-|N/A)\s*\|')
FNAME = re.compile(r'(?P<bench>[a-z\-]+?)-(?P<w>\d+)w-rep(?P<rep>\d+)(?:-(?P<variant>[^.]+))?\.log$')
LABEL = re.compile(r'^(?P<fn>[A-Za-z]+)_tps(?P<tps>\d+)$')
SKIP_PREFIX = ('warmup_', 'cooldown_', 'recovery_', 'drift_', 'setup_', 'seed_', 'verify_', 'sweepadd_')   # setup_prime is covered by 'setup_'

SEND_OK = 0.95      # actual send rate must reach 95 % of the target, else the round is generator-limited
MAX_FAIL = 0.01     # a stable round has <= 1 % failures
MIN_EFF = 0.95      # ... and goodput (Succ/60) >= 95 % of the actual send rate
MAX_LAT = 2.0       # ... and mean latency <= this many seconds (--max-lat; STATE THE VALUE IN THE PAPER)


def num(x):
    try:
        return float(x)
    except ValueError:
        return None


def parse_log(path):
    """label -> dict(succ, fail, send, mx, mn, avg, thr). Last occurrence wins (tables can be printed twice)."""
    rows = {}
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            m = ROW.search(line)
            if m:
                rows[m.group(1)] = dict(succ=int(m.group(2)), fail=int(m.group(3)), send=num(m.group(4)),
                                        mx=num(m.group(5)), mn=num(m.group(6)), avg=num(m.group(7)),
                                        thr=num(m.group(8)))
    return rows


def enrich(label, r, seconds=60.0):
    total = r['succ'] + r['fail']
    r['failpct'] = (r['fail'] / total) if total else 1.0
    r['goodput'] = r['succ'] / seconds
    m = LABEL.match(label)
    r['target'] = int(m.group('tps')) if m else None
    send, thr = r['send'] or 0.0, r['thr'] or 0.0
    # efficiency uses goodput (Succ / txDuration), not Caliper's Throughput: with a write batch timeout the last
    # block is cut up to BatchTimeout after the last send, which makes Caliper's window ~62 s instead of 60 s (-3 %)
    r['eff'] = (r['goodput'] / send) if send else 0.0
    r['send_ok'] = bool(r['target']) and send >= SEND_OK * r['target']
    r['lat_ok'] = r['avg'] is not None and r['avg'] <= MAX_LAT
    r['stable'] = r['send_ok'] and r['failpct'] <= MAX_FAIL and r['eff'] >= MIN_EFF and r['lat_ok']
    return r


def why_unstable(r):
    out = []
    if not r['send_ok']:
        out.append('generator-limited')
    if r['failpct'] > MAX_FAIL:
        out.append('failures %.0f%%' % (100 * r['failpct']))
    elif r['eff'] < MIN_EFF:
        out.append('throughput < 95%% of send')
    if not r['lat_ok']:
        out.append('latency > %.1fs' % MAX_LAT)
    return ', '.join(out) or 'unstable'


def mean_sd(xs):
    xs = [x for x in xs if x is not None]
    if not xs:
        return None, None
    return statistics.mean(xs), (statistics.stdev(xs) if len(xs) > 1 else 0.0)


def fmt(m, s, nd=1):
    if m is None:
        return '-'
    return ('%.' + str(nd) + 'f') % m + ((' ± %.' + str(nd) + 'f') % s if s is not None else '')


# ------------------------------------------------------------------ crash attribution
TS = re.compile(r'^(\d{4})\.(\d\d)\.(\d\d)-(\d\d):(\d\d):(\d\d)\.(\d+)')
ROUND_EV = re.compile(r'(Started|Finished) round \d+ \(([^)]+)\)')


def naive_epoch(m):
    import calendar
    y, mo, d, h, mi, se = (int(m.group(i)) for i in range(1, 7))
    return calendar.timegm((y, mo, d, h, mi, se, 0, 0, 0)) + int(m.group(7)) / 1000.0


def crash_by_round(logpath):
    """{label: n_crashes} using <run>.events.log (docker events, epoch seconds) and the round start/finish lines of the log.
       Caliper prints naive local time; its offset to UTC is derived from the '# started' line (date -Is) written by run-benchmarks.sh."""
    import datetime
    ev_path = logpath[:-4] + '.events.log' if logpath.endswith('.log') else logpath + '.events.log'
    if not os.path.exists(ev_path):
        return None
    events = []
    with open(ev_path) as f:
        for line in f:
            m = re.match(r'(\d+)\s+(\S+)\s+exitCode=([1-9]\d*)', line)
            if m:
                events.append((int(m.group(1)), m.group(2), int(m.group(3))))
    if not events:
        return {}
    started, first_ts, windows = None, None, {}
    with open(logpath, encoding='utf-8', errors='replace') as f:
        for line in f:
            m = re.match(r'# started\s*:\s*(\S+)', line)
            if m:
                try:
                    started = datetime.datetime.fromisoformat(m.group(1)).timestamp()
                except ValueError:
                    pass
            t = TS.match(line)
            if t and first_ts is None:
                first_ts = naive_epoch(t)
            r = ROUND_EV.search(line)
            if r and t:
                w = windows.setdefault(r.group(2), [None, None])
                w[0 if r.group(1) == 'Started' else 1] = naive_epoch(t)
    if started is None or first_ts is None:
        return None
    offset = round((started - first_ts) / 900.0) * 900     # whole quarter-hours = time-zone offset
    ordered = sorted(((w[0], lab, w[1]) for lab, w in windows.items() if w[0] is not None), key=lambda x: x[0])
    last_end = max((w[1] for w in windows.values() if w[1] is not None), default=None)
    out = {}
    for ts, name, code in events:
        label = '(before the first round)'
        for a, lab, b in ordered:          # the round that was running (or had just ended) when the container died
            if a + offset - 2 <= ts:
                label = lab
        if last_end is not None and ts > last_end + offset + 120:
            label = '(after the last round)'
        out[label] = out.get(label, 0) + 1
    return out


# ------------------------------------------------------------------ quick
def cmd_quick(args):
    rows = parse_log(args.log)
    if not rows:
        print('quick: no Caliper result rows found in %s (is the table format different? check the log)' % args.log)
        return 0
    bad = []
    for label, r in rows.items():
        if label.startswith(SKIP_PREFIX):
            continue
        enrich(label, r)
        flags = []
        if r['fail']:
            flags.append('fail=%d (%.1f%%)' % (r['fail'], 100 * r['failpct']))
        if r['target'] and not r['send_ok']:
            flags.append('generator-limited: send %.1f < 95%% of %d' % (r['send'] or 0, r['target']))
        if flags:
            bad.append((label, ', '.join(flags)))
    crashes = 0
    with open(args.log, encoding='utf-8', errors='replace') as f:
        for line in f:
            m = re.match(r'# container crashes during run: (\d+)', line)
            if m:
                crashes = int(m.group(1))
    print('quick: %d rounds parsed, %d need attention' % (len(rows), len(bad)))
    if crashes:
        print('   !! %d container crash(es) during this run - see reports/<run-id>.events.log (134 = Node heap abort, 137 = killed)' % crashes)
        by = crash_by_round(args.log)
        if by:
            print('      crashes by round: ' + ', '.join('%s x%d' % kv for kv in by.items()))
        elif by is None:
            print('      (could not attribute crashes to rounds: missing events file or "# started" line)')
    for label, why in bad:
        print('   %-36s %s' % (label, why))
    return 0


# ------------------------------------------------------------------ check-seed
def cmd_check_seed(args):
    seed, ver = parse_log(args.seedlog), parse_log(args.verifylog)
    ok = True
    if args.setup:
        setup = parse_log(args.setup)
        for label, want in (('setup_eda_core', 12), ('setup_eda_po_rc', args.po)):
            r = setup.get(label)
            if not r or r['succ'] != want or r['fail'] != 0:
                print('  %-22s %s  (expected Succ=%d Fail=0)' % (label, ('Succ=%d Fail=%d' % (r['succ'], r['fail'])) if r else 'MISSING', want))
                print('     -> the chaincode is probably not installed/ready; check hooks/reset.sh (fabricNetwork.sh install)')
                ok = False
            else:
                print('  %-22s Succ=%d Fail=0  OK' % (label, r['succ']))

    def need(rows, label, succ):
        nonlocal ok
        r = rows.get(label)
        if not r:
            print('  MISSING round %s' % label)
            ok = False
        elif r['succ'] != succ or r['fail'] != 0:
            print('  %-22s Succ=%d Fail=%d  (expected Succ=%d Fail=0)' % (label, r['succ'], r['fail'], succ))
            ok = False
        else:
            print('  %-22s Succ=%d Fail=0  OK' % (label, r['succ']))

    need(seed, 'seed_registerCompany', 2000)
    need(seed, 'seed_addDrug', 4000)
    need(ver, 'verify_view', 4000)
    print('seed check:', 'PASSED' if ok else 'FAILED - do NOT measure on this ledger, reset and re-seed')
    return 0 if ok else 1


# ------------------------------------------------------------------ summary
def collect(patterns, merge=False):
    runs = {}
    if isinstance(patterns, str):
        patterns = [patterns]
    for pattern in patterns:
        for path in sorted(glob.glob(pattern)):
            m = FNAME.search(os.path.basename(path))
            if not m:
                continue
            key = (m.group('bench'), int(m.group('w')), '' if merge else (m.group('variant') or ''))
            runs.setdefault(key, []).append((int(m.group('rep')), parse_log(path), path))
    return runs


def cmd_summary(args):
    global MAX_LAT
    MAX_LAT = args.max_lat
    runs = collect(args.glob, args.merge_variants)
    if not runs:
        sys.exit('no logs matched %s' % args.glob)
    out_rows = []
    for (bench, w, variant), reps in sorted(runs.items()):
        n = len(reps)
        print('\n### %s  workers=%d  %s  (%d logs, repetitions: %s)' % (bench, w, variant, n, sorted(set(r[0] for r in reps))))
        print('stable round = send >= %d%% of target, failures <= %.0f%%, goodput >= %d%% of send, mean latency <= %.1f s'
              % (SEND_OK * 100, MAX_FAIL * 100, MIN_EFF * 100, MAX_LAT))
        by_label = {}
        for rep, rows, _ in reps:
            for label, r in rows.items():
                if label.startswith(SKIP_PREFIX) or not LABEL.match(label):
                    continue
                by_label.setdefault(label, []).append(enrich(label, dict(r)))
        by_fn = {}
        for label, lst in by_label.items():
            m = LABEL.match(label)
            by_fn.setdefault(m.group('fn'), []).append((int(m.group('tps')), label, lst))
        for fn, items in sorted(by_fn.items()):
            items.sort()
            print('\n**%s**' % fn)
            print('| target | n | send | throughput (Caliper) | goodput (Succ/60) | avg latency (s) | fail % | stable | send>=95% |')
            print('|---|---|---|---|---|---|---|---|---|')
            ladder = []
            reasons = {}
            for tps, label, lst in items:
                sm, ss = mean_sd([x['send'] for x in lst])
                tm, ts = mean_sd([x['thr'] for x in lst])
                gm, gs = mean_sd([x['goodput'] for x in lst])
                lm, ls = mean_sd([x['avg'] for x in lst])
                fm, _ = mean_sd([100 * x['failpct'] for x in lst])
                st = sum(1 for x in lst if x['stable'])
                so = sum(1 for x in lst if x['send_ok'])
                flag = '*' if fm is not None and fm > 1.0 else ''
                print('| %d | %d | %s | %s | %s | %s%s | %.1f | %d/%d | %d/%d |' % (
                    tps, len(lst), fmt(sm, ss), fmt(tm, ts), fmt(gm, gs), fmt(lm, ls, 2), flag, fm or 0, st, len(lst), so, len(lst)))
                ladder.append((tps, st == len(lst), so == len(lst)))
                bad = next((x for x in lst if not x['stable']), None)
                reasons[tps] = why_unstable(bad) if bad else ''
                sucm, _ = mean_sd([float(x['succ']) for x in lst])
                failm, _ = mean_sd([float(x['fail']) for x in lst])
                maxm, _ = mean_sd([x['mx'] for x in lst])
                minm, _ = mean_sd([x['mn'] for x in lst])
                out_rows.append([bench, variant, w, fn, tps, len(lst), sm, ss, tm, ts, gm, gs, lm, ls, fm, st, so, sucm, failm, maxm, minm])
            last_ok, first_bad, why = None, None, ''
            for tps, stable_all, send_all in ladder:
                if stable_all and first_bad is None:
                    last_ok = tps
                elif first_bad is None:
                    first_bad = tps
                    why = reasons.get(tps) or ('generator-limited' if not send_all else 'system saturation')
            if last_ok is None:
                print('\nsaturation: already unstable at the lowest tested rate (%d TPS)' % ladder[0][0])
            elif first_bad is None:
                print('\nsaturation: NOT reached - stable up to the highest tested rate (%d TPS)' % last_ok)
            else:
                print('\nsaturation: highest stable rate = %d TPS ; first unstable = %d TPS (%s)  ->  knee in [%d, %d)' % (
                    last_ok, first_bad, why, last_ok, first_bad))
            print('(* = mean latency covers successful tx only and the round had >1% failures: survivor-biased)')
    if args.csv:
        with open(args.csv, 'w', newline='') as f:
            wr = csv.writer(f)
            wr.writerow(['bench', 'variant', 'workers', 'function', 'target_tps', 'n', 'send_mean', 'send_sd', 'thr_mean',
                         'thr_sd', 'goodput_mean', 'goodput_sd', 'avg_lat_mean', 'avg_lat_sd', 'fail_pct_mean',
                         'stable_runs', 'send_ok_runs', 'succ_mean', 'fail_mean', 'max_lat_mean', 'min_lat_mean'])
            wr.writerows(out_rows)
        print('\nCSV written to', args.csv)
    return 0


# ------------------------------------------------------------------ state-size (answers: how big is the world state in each round?)
SEED_STATE = {'companies': 2000, 'pouches': 4000, 'pos': 0}
CONST_DOCS = 6 + 200 + 6          # RC for 6 drugs + 200 PO GTINs + CoA for 6 batches (see mainConfig.js PO_GTIN_COUNT)


def adds_of(label):
    base = label[len('warmup_'):] if label.startswith('warmup_') else label
    if base.startswith('registerCompany'):
        return 'companies'
    if base.startswith('addDrug'):
        return 'pouches'
    if base.startswith('createPO'):
        return 'pos'
    return None


def cmd_state_size(args):
    rows = parse_log(args.log)
    if not rows:
        sys.exit('no Caliper rows in %s' % args.log)
    st = dict(SEED_STATE)
    print('world state at the START of every round (seed = %d companies, %d pouches, %d POs; all keys of a write round are new,' %
          (st['companies'], st['pouches'], st['pos']))
    print('so every committed tx (Succ) adds exactly one asset)\n')
    print('| round | adds | Succ | companies | pouches | POs | business docs |')
    print('|---|---|---|---|---|---|---|')
    out = []
    for label, r in rows.items():
        kind = adds_of(label)
        start = dict(st)
        if kind:
            st[kind] += r['succ']
        docs = start['companies'] + start['pouches'] + start['pos'] + CONST_DOCS
        print('| %s | %s | %d | %d | %d | %d | %d |' % (label, kind or '-', r['succ'] if kind else 0,
                                                       start['companies'], start['pouches'], start['pos'], docs))
        out.append((label, kind, r['succ'] if kind else 0, start['companies'], start['pouches'], start['pos'], docs))
    final = st['companies'] + st['pouches'] + st['pos'] + CONST_DOCS
    print('\nfinal state: %d companies, %d pouches, %d POs  -> %d business documents' % (st['companies'], st['pouches'], st['pos'], final))
    if args.couch_rows is not None:
        print('CouchDB total_rows reported: %d  (difference %+d = design/index docs; it must be a small constant, the same in every run)'
              % (args.couch_rows, args.couch_rows - final))
    if args.csv:
        with open(args.csv, 'w', newline='') as f:
            wr = csv.writer(f)
            wr.writerow(['round', 'adds', 'succ', 'companies_at_start', 'pouches_at_start', 'pos_at_start', 'business_docs_at_start'])
            wr.writerows(out)
        print('CSV written to', args.csv)
    return 0


def cmd_count(args):
    r = parse_log(args.log).get(args.label)
    if not r:
        sys.exit('round %s not found in %s' % (args.label, args.log))
    print(r['succ'] + r['fail'])
    return 0


# ------------------------------------------------------------------ compare-workers
def cmd_compare_workers(args):
    runs = collect(args.glob, True)
    byw = {}
    for (bench, w, _v), reps in runs.items():
        for rep, rows, _ in reps:
            for label, r in rows.items():
                if label.startswith(SKIP_PREFIX) or not LABEL.match(label):
                    continue
                byw.setdefault(label, {}).setdefault(w, []).append(enrich(label, dict(r)))
    print('Is the outcome independent of the number of Caliper workers?  (rounds that were stable and not generator-limited at EVERY worker count)')
    print('tolerance: goodput spread <= %.0f%% of the mean and latency spread <= max(%.2f s, %.0f%% of the mean)\n' % (100 * args.tol, args.lat_abs, 100 * args.tol * 2.5))
    print('| round | workers | goodput (Succ/60) | avg latency (s) | verdict |')
    print('|---|---|---|---|---|')
    ok = bad = skipped = 0
    for label in sorted(byw, key=lambda x: (LABEL.match(x).group('fn'), int(LABEL.match(x).group('tps')))):
        d = byw[label]
        if len(d) < 2:
            continue
        if not all(all(x['stable'] and x['send_ok'] for x in lst) for lst in d.values()):
            skipped += 1
            continue
        g = {w: mean_sd([x['goodput'] for x in lst]) for w, lst in d.items()}
        l = {w: mean_sd([x['avg'] for x in lst]) for w, lst in d.items()}
        gm = [v[0] for v in g.values()]
        lm = [v[0] for v in l.values()]
        gs = (max(gm) - min(gm)) / (sum(gm) / len(gm)) if sum(gm) else 0
        ls_ = max(lm) - min(lm)
        same = gs <= args.tol and ls_ <= max(args.lat_abs, args.tol * 2.5 * (sum(lm) / len(lm)))
        ok += same
        bad += (not same)
        print('| %s | %s | %s | %s | %s |' % (label, '/'.join(str(w) for w in sorted(d)),
              ' / '.join(fmt(g[w][0], g[w][1]) for w in sorted(d)), ' / '.join(fmt(l[w][0], l[w][1], 2) for w in sorted(d)),
              'same' if same else 'DIFFERENT'))
    print('\n%d rounds consistent across worker counts, %d different, %d skipped (unstable or generator-limited at some worker count).'
          % (ok, bad, skipped))
    return 0


# ------------------------------------------------------------------ progress (which runs are done / running / pending)
def _hdr_time(path, key):
    import datetime
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            for line in f:
                m = re.match(r'# %s\s*:\s*(\S+)' % key, line)
                if m:
                    return datetime.datetime.fromisoformat(m.group(1))
    except (OSError, ValueError):
        pass
    return None


def cmd_progress(args):
    import datetime
    kinds, ws, reps = args.kinds.split(), args.workers.split(), args.reps.split()
    rows, done_tot = [], {}
    now = datetime.datetime.now().astimezone()
    for kind in kinds:
        for w in ws:
            for r in reps:
                base = 'stress-%s-%sw-rep%s' % (kind, w, r)
                log = os.path.join(args.dir, base + '.log')
                setup = os.path.join(args.dir, 'prep-%s-%sw-rep%s-setup.log' % (kind, w, r))
                st, fin = _hdr_time(log, 'started'), _hdr_time(log, 'finished')
                pre = _hdr_time(setup, 'started')
                if fin:
                    meas = (fin - st).total_seconds() / 60.0
                    total = (fin - pre).total_seconds() / 60.0 if pre else meas + 15
                    rows.append((kind, w, r, 'DONE', '%.0f min measure, %.0f min total' % (meas, total), total))
                    done_tot.setdefault((kind, w), []).append(total)
                elif st:
                    rows.append((kind, w, r, 'RUNNING', 'measuring for %.0f min' % ((now - st).total_seconds() / 60.0), None))
                elif pre:
                    rows.append((kind, w, r, 'PREP', 'reset/setup/seed for %.0f min' % ((now - pre).total_seconds() / 60.0), None))
                else:
                    rows.append((kind, w, r, 'PENDING', '', None))
    allv = [v for lst in done_tot.values() for v in lst]
    fallback = {'read': 55.0, 'write': 45.0}
    remaining = 0.0
    print('run                          status    detail')
    for kind, w, r, status, detail, _ in rows:
        print('stress-%s-%sw-rep%s'.ljust(0) % (kind, w, r) + ' ' * max(1, 29 - len('stress-%s-%sw-rep%s' % (kind, w, r))) + status.ljust(9) + detail)
        if status in ('PENDING', 'PREP', 'RUNNING'):
            lst = done_tot.get((kind, w)) or [v for (k, _w), l in done_tot.items() if k == kind for v in l]
            est = (sum(lst) / len(lst)) if lst else fallback.get(kind, 50.0)
            remaining += est * (0.5 if status == 'RUNNING' else 1.0)
    n = {k: sum(1 for x in rows if x[3] == k) for k in ('DONE', 'RUNNING', 'PREP', 'PENDING')}
    print('\n%d runs expected: %d done, %d running/prep, %d pending.  Each run = 13 files in reports/ (4 measurement + 9 setup/seed/verify).'
          % (len(rows), n['DONE'], n['RUNNING'] + n['PREP'], n['PENDING']))
    if n['PENDING'] + n['RUNNING'] + n['PREP']:
        eta = now + datetime.timedelta(minutes=remaining)
        print('estimated remaining: ~%.1f h (average of the finished runs of the same kind); expected end around %s'
              % (remaining / 60.0, eta.strftime('%a %H:%M')))
    else:
        print('all runs finished.')
    return 0


# ------------------------------------------------------------------ validate (is every official run sound?)
GEN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'caliper-benchmarks-local', 'benchmarks', 'scenario',
                       'simple', 'kareem', 'generated')


def yaml_labels(base):
    """(all labels, labels of the OVERLOAD tail) from the generated YAML of a run, without needing PyYAML."""
    path = os.path.join(GEN_DIR, base + '.yaml')
    if not os.path.exists(path):
        return None, None
    labels, tail, cur = [], set(), None
    with open(path) as f:
        for line in f:
            m = re.match(r'\s*- label:\s*(.+)', line)
            if m:
                cur = m.group(1).strip().strip('"\'')
                labels.append(cur)
            elif 'OVERLOAD tail' in line and cur:
                tail.add(cur)
    return labels, tail


def cmd_validate(args):
    paths = sorted({p for g in args.glob for p in glob.glob(g)})
    if not paths:
        sys.exit('no logs matched %s' % args.glob)
    want_reps = sorted(int(x) for x in args.reps.split())
    verdicts, families = [], {}
    for path in paths:
        base = os.path.basename(path)[:-4]
        folder = os.path.dirname(path) or '.'
        m = FNAME.search(base + '.log')
        if not m:
            continue
        kind, w, rep, variant = m.group('bench'), int(m.group('w')), int(m.group('rep')), m.group('variant') or ''
        notes = []     # (level, text)  level: OK / INFO / WARN / FAIL
        text = open(path, encoding='utf-8', errors='replace').read()

        # 1 finished + all rounds ran
        notes.append(('OK', 'finished') if '# finished' in text else ('FAIL', 'log has no "# finished" line (run interrupted?)'))
        labels, tail = yaml_labels(base)
        done = re.findall(r'Finished round \d+ \(([^)]+)\)', text)
        rows = parse_log(path)
        if labels is None:
            notes.append(('WARN', 'generated YAML not found - cannot check the round list'))
        else:
            no_row = [x for x in labels if x not in rows]
            no_fin = [x for x in labels if x in rows and x not in done]
            if no_row:
                notes.append(('FAIL', 'no result row for round(s): ' + ', '.join(no_row[:6])))
            else:
                notes.append(('OK', '%d/%d rounds have a result row' % (len(labels), len(labels))))
            if no_fin:
                notes.append(('INFO', 'no "Finished round" line for: ' + ', '.join(no_fin[:4]) + ' (result row present, so the round ran)'))
        measured = [x for x in rows if not x.startswith(SKIP_PREFIX)]
        families.setdefault((kind, w, variant), {})[rep] = set(measured)

        # 2 CPU pinning
        if '# pin-check after run: OK' in text:
            notes.append(('OK', 'CPU pinning held until the end'))
        elif 'pin-check after run: NOT OK' in text:
            notes.append(('FAIL', 'a container ran unpinned during the run'))
        else:
            notes.append(('WARN', 'no pin-check line (run made with an older run-benchmarks.sh)'))

        # 3 crashes: acceptable only in the overload tail
        mc = re.search(r'# container crashes during run: (\d+)', text)
        n_crash = int(mc.group(1)) if mc else None
        if n_crash is None:
            notes.append(('WARN', 'no crash counter in the log'))
        elif n_crash == 0:
            notes.append(('OK', 'no container crashes'))
        else:
            by = crash_by_round(path)
            if not by:
                notes.append(('WARN', '%d crash(es), could not attribute them to rounds' % n_crash))
            else:
                bad = {k: v for k, v in by.items() if not (tail and k in tail) and not k.startswith('recovery_')}
                if bad:
                    notes.append(('WARN', 'crash outside the overload tail: ' + ', '.join('%s x%d' % kv for kv in bad.items())))
                else:
                    notes.append(('INFO', '%d crash(es), all inside the overload tail (expected)' % n_crash))

        # 4 generator limited / failures in clean rounds
        gl = []
        for label, r in rows.items():
            if label.startswith(SKIP_PREFIX):
                continue
            enrich(label, r)
            if r['target'] and not r['send_ok']:
                gl.append('%s (send %.0f)' % (label, r['send'] or 0))
        if gl:
            notes.append(('INFO', 'generator-limited rounds: ' + ', '.join(gl[:5]) + (' ...' if len(gl) > 5 else '')))

        # 5 dataset: setup / seed / verify of this run
        prep = os.path.join(folder, 'prep-%s-%dw-rep%d%s' % ('read' if 'read' in kind else 'write', w, rep, ('-' + variant) if variant else ''))
        if all(os.path.exists(prep + sfx) for sfx in ('-setup.log', '-seed.log', '-verify.log')):
            ok = all(_rows_ok(parse_log(prep + '-seed.log'), 'seed_registerCompany', 2000) and
                     _rows_ok(parse_log(prep + '-seed.log'), 'seed_addDrug', 4000) and
                     _rows_ok(parse_log(prep + '-verify.log'), 'verify_view', 4000) for _ in [0])
            notes.append(('OK', 'dataset seeded and verified (2000 companies, 4000 pouches)') if ok
                         else ('FAIL', 'seed/verify check failed - this ledger was not the standard dataset'))
        else:
            notes.append(('WARN', 'setup/seed/verify logs not found (%s-*.log)' % os.path.basename(prep)))

        # 6 meta (snapshots, endorsements)
        meta = path[:-4] + '.meta.txt'
        if os.path.exists(meta):
            mt = open(meta, encoding='utf-8', errors='replace').read()
            e = re.search(r'endorsements[^\n]*?-> ([\d.]+) per write tx', mt)
            ok = 'before-measurement' in mt and 'after-measurement' in mt
            notes.append(('OK' if ok else 'WARN', 'meta snapshots present' + (', endorsements/write tx = %s' % e.group(1) if e else '')))
        else:
            notes.append(('WARN', 'meta file missing'))

        level = 'FAIL' if any(l == 'FAIL' for l, _ in notes) else 'WARN' if any(l == 'WARN' for l, _ in notes) else 'PASS'
        verdicts.append((base, level, notes))

    # 7 same repetitions and same round set in every family
    for (kind, w, variant), reps in sorted(families.items()):
        have = sorted(reps)
        fam = '%s %dW %s' % (kind, w, variant)
        if have != want_reps:
            verdicts.append((fam.strip(), 'FAIL', [('FAIL', 'repetitions found %s, expected %s' % (have, want_reps))]))
        sets = [reps[r] for r in have]
        if sets and any(x != sets[0] for x in sets):
            verdicts.append((fam.strip(), 'WARN', [('WARN', 'the repetitions do not contain the same rounds')]))

    worst = 0
    for name, level, notes in verdicts:
        print('%-4s %s' % (level, name))
        for lv, t in notes:
            if lv in ('FAIL', 'WARN') or args.verbose:
                print('       [%s] %s' % (lv, t))
        worst = max(worst, 2 if level == 'FAIL' else 1 if level == 'WARN' else 0)
    n = {k: sum(1 for _, l, _ in verdicts if l == k) for k in ('PASS', 'WARN', 'FAIL')}
    print('\n%d runs/groups: %d PASS, %d WARN, %d FAIL%s' % (len(verdicts), n['PASS'], n['WARN'], n['FAIL'],
          '' if args.verbose else '   (add -v for the detail of every check)'))
    return 1 if n['FAIL'] else 0


def _rows_ok(rows, label, succ):
    r = rows.get(label)
    return bool(r) and r['succ'] == succ and r['fail'] == 0


# ------------------------------------------------------------------ sweep (model fit)
def solve(a, b):
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for i in range(n):
        p = max(range(i, n), key=lambda r: abs(m[r][i]))
        m[i], m[p] = m[p], m[i]
        if abs(m[i][i]) < 1e-12:
            raise ValueError('singular')
        for r in range(i + 1, n):
            f = m[r][i] / m[i][i]
            for c in range(i, n + 1):
                m[r][c] -= f * m[i][c]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        x[i] = (m[i][n] - sum(m[i][c] * x[c] for c in range(i + 1, n))) / m[i][i]
    return x


def ols(rows, y):
    k = len(rows[0])
    xtx = [[sum(r[i] * r[j] for r in rows) for j in range(k)] for i in range(k)]
    xty = [sum(r[i] * yy for r, yy in zip(rows, y)) for i in range(k)]
    beta = solve(xtx, xty)
    pred = [sum(b * v for b, v in zip(beta, r)) for r in rows]
    my = sum(y) / len(y)
    ss_res = sum((a - b) ** 2 for a, b in zip(y, pred))
    ss_tot = sum((a - my) ** 2 for a in y) or 1e-12
    return beta, 1 - ss_res / ss_tot


P_VAL = {'P0': 664, 'P1': 1328, 'P2': 2656}              # pouches of drug 0 (seed = 8 workers)
N_VAL = {'N0': 2000, 'N1': 4000, 'N2': 8000, 'N3': 16000}  # companies


def cmd_sweep(args):
    pts = {}
    files = sorted(glob.glob(args.glob))
    if not files:
        sys.exit('no logs matched %s' % args.glob)
    for path in files:
        for label, r in parse_log(path).items():
            m = re.match(r'sweep_(P\d)_(N\d)_(view|qac|qdu)$', label)
            if m and r['avg'] is not None and r['fail'] == 0:
                pts.setdefault((m.group(1), m.group(2), m.group(3)), []).append(r['avg'])
    print('files: %d   points: %d' % (len(files), len(pts)))
    for fn in ('view', 'qac', 'qdu'):
        cells = sorted((k for k in pts if k[2] == fn))
        if not cells:
            continue
        print('\n%s (avg latency, s):' % fn)
        xs, ys = [], []
        for (p, n, _) in cells:
            m, s = mean_sd(pts[(p, n, fn)])
            print('  P=%-5d N=%-6d  %.4f ± %.4f  (n=%d)' % (P_VAL[p], N_VAL[n], m, s, len(pts[(p, n, fn)])))
            xs.append((P_VAL[p], N_VAL[n]))
            ys.append(m)
        try:
            if fn == 'qac':
                beta, r2 = ols([[1, n] for p, n in xs], ys)
                print('  fit  lat = %.4f + %.3e*N                 R^2 = %.4f   (model: O(N))' % (beta[0], beta[1], r2))
            elif fn == 'qdu':
                b1, r2a = ols([[1, p] for p, n in xs], ys)
                print('  fit  lat = %.4f + %.3e*P                 R^2 = %.4f   (documented model: O(P))' % (b1[0], b1[1], r2a))
                b2, r2b = ols([[1, p * n] for p, n in xs], ys)
                print('  fit  lat = %.4f + %.3e*P*N               R^2 = %.4f   (alternative hypothesis - expected to fit worse; the code counts say O(P))' % (b2[0], b2[1], r2b))
            else:
                print('  O(1) control: should stay flat (mean %.4f s)' % (sum(ys) / len(ys)))
        except ValueError:
            print('  not enough distinct points to fit')
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    a = sp.add_parser('quick'); a.add_argument('log'); a.set_defaults(f=cmd_quick)
    a = sp.add_parser('check-seed'); a.add_argument('seedlog'); a.add_argument('verifylog'); a.add_argument('--setup'); a.add_argument('--po', type=int, default=200); a.set_defaults(f=cmd_check_seed)
    a = sp.add_parser('summary'); a.add_argument('glob', nargs='+'); a.add_argument('--merge-variants', action='store_true', help='treat e.g. -overload logs as more rounds of the same run family'); a.add_argument('--csv'); a.add_argument('--max-lat', type=float, default=2.0, help='mean-latency bound (s) of a stable round'); a.set_defaults(f=cmd_summary)
    a = sp.add_parser('sweep'); a.add_argument('glob'); a.set_defaults(f=cmd_sweep)
    a = sp.add_parser('compare-workers'); a.add_argument('glob', nargs='+'); a.add_argument('--tol', type=float, default=0.10); a.add_argument('--lat-abs', type=float, default=0.05); a.set_defaults(f=cmd_compare_workers)
    a = sp.add_parser('progress'); a.add_argument('--dir', default='reports'); a.add_argument('--kinds', default='read write'); a.add_argument('--workers', default='8'); a.add_argument('--reps', default='1 2 3'); a.set_defaults(f=cmd_progress)
    a = sp.add_parser('count'); a.add_argument('log'); a.add_argument('label'); a.set_defaults(f=cmd_count)
    a = sp.add_parser('validate'); a.add_argument('glob', nargs='+'); a.add_argument('--reps', default='1 2 3'); a.add_argument('-v', '--verbose', action='store_true'); a.set_defaults(f=cmd_validate)
    a = sp.add_parser('state-size'); a.add_argument('log'); a.add_argument('--couch-rows', type=int); a.add_argument('--csv'); a.set_defaults(f=cmd_state_size)
    args = ap.parse_args()
    sys.exit(args.f(args))


if __name__ == '__main__':
    main()
