#!/usr/bin/env python3
"""Re-extract per-round container resources straight from Prometheus.

Why: Caliper's own HTML resource table was wrong for some write rounds
(e.g. 8W rep3 registerCompany_tps200: Caliper CPU 1.6% vs ~60% in Prometheus).
This script uses ONE method for every round, so the table is consistent.

Round window = first..last default-observer line of that round in the log.
  (series of a restarted container, same name, are summed for CPU and max-ed for memory)
  cpu_avg  = increase(cpu_seconds_total over window) / window * 100   (exact mean, % of one core)
  cpu_max  = max over window of rate(cpu_seconds_total[15s]) * 100   (5 s subquery step)
  mem_avg  = avg_over_time(working_set_bytes over window) / 1e6      (MB)
  mem_max  = max_over_time(working_set_bytes over window) / 1e6

Usage (run on the machine that still has the Prometheus data):
  python3 export-resources-prom.py --reports reports --out resources-prom.csv \
      [--prom http://localhost:9090] [--classes resources.csv] [--compare resources.csv]

--classes : existing resources.csv, used to copy the container->class mapping.
--compare : prints the largest differences vs Caliper's numbers (sanity check).
"""
import argparse, csv, glob, json, os, re, sys, urllib.parse, urllib.request
from datetime import datetime, timezone
LOGTZ = timezone.utc   # Caliper runs in a UTC container: log timestamps are UTC

LOGTS = re.compile(r'^(\d{4})\.(\d\d)\.(\d\d)-(\d\d):(\d\d):(\d\d)\.(\d+)')
OBS = re.compile(r'\[default-observer\]\s+\[(\S+) Round \d+ Transaction Info\]')
RUN = re.compile(r'stress-(read|write)-(\d+)w-rep(\d+)(-extra)?')


def ts(line):
    m = LOGTS.match(line)
    if not m:
        return None
    y, mo, d, h, mi, s, ms = map(int, m.groups())
    # Caliper log timestamps are UTC (verified: run at 08:30 Cairo shows 06:28)
    return datetime(y, mo, d, h, mi, s, tzinfo=LOGTZ).timestamp() + ms / 1000.0


STARTED = re.compile(r'Started round \d+ \((\S+)\)')


def rounds_in_log(path):
    """-> list of (round, t0, t1, n_obs, src). Window = first..last observer line of the round;
    if a round has no observer lines, fall back to [Started round, next Started round or +60 s]."""
    first, last, nobs, started = {}, {}, {}, []
    with open(path, errors='replace') as f:
        for line in f:
            t = ts(line)
            if t is None:
                continue
            m = STARTED.search(line)
            if m:
                started.append((m.group(1), t))
                continue
            m = OBS.search(line)
            if m:
                r = m.group(1)
                first.setdefault(r, t)
                last[r] = t
                nobs[r] = nobs.get(r, 0) + 1
    out, seen = [], set()
    for i, (r, t0) in enumerate(started):
        seen.add(r)
        if r in first:
            out.append((r, first[r], last[r], nobs[r], 'obs'))
        else:
            nxt = started[i + 1][1] if i + 1 < len(started) else t0 + 60
            out.append((r, t0, min(nxt, t0 + 120), 0, 'started'))
    for r in first:                       # observer lines without a Started line (should not happen)
        if r not in seen:
            out.append((r, first[r], last[r], nobs[r], 'obs-only'))
    return out


def q(prom, query, t):
    url = prom.rstrip('/') + '/api/v1/query?' + urllib.parse.urlencode({'query': query, 'time': '%.3f' % t})
    with urllib.request.urlopen(url, timeout=120) as r:
        d = json.load(r)
    if d.get('status') != 'success':
        raise RuntimeError(d)
    return {x['metric'].get('name', ''): float(x['value'][1]) for x in d['data']['result'] if x['metric'].get('name')}


def classify(name):
    n = name
    if n.startswith('ca.'): return 'ca'
    if n.startswith('couchdb'): return 'couchdb'
    if n.startswith('dev-peer'): return 'chaincode'
    if n.startswith('peer'): return 'peer'
    if n.startswith('orderer'): return 'orderer'
    if n == 'caliper': return 'caliper'
    if n == 'chaincode': return 'chaincode'
    return 'other'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--reports', default='reports')
    ap.add_argument('--out', default='resources-prom.csv')
    ap.add_argument('--prom', default='http://localhost:9090')
    ap.add_argument('--classes')
    ap.add_argument('--compare')
    a = ap.parse_args()

    cls = {}
    if a.classes:
        with open(a.classes) as f:
            for r in csv.DictReader(f):
                cls[r['container']] = r['class']

    rows = []
    logs = sorted(glob.glob(os.path.join(a.reports, 'stress-*.log')))
    if not logs:
        sys.exit('no stress-*.log found in %s' % a.reports)
    for lg in logs:
        base = os.path.basename(lg)[:-4]
        m = RUN.match(base)
        if not m:
            continue
        kind, w, rep = m.group(1), int(m.group(2)), int(m.group(3))
        for rnd, t0, t1, nobs, src in rounds_in_log(lg):
            dur = max(int(round(t1 - t0)), 10)
            win = '%ds' % dur
            try:
                cpu_a = q(a.prom, 'sum by (name) (increase(container_cpu_usage_seconds_total{name!=""}[%s]))' % win, t1)
                cpu_m = q(a.prom, 'max by (name) (max_over_time(rate(container_cpu_usage_seconds_total{name!=""}[15s])[%s:5s]))' % win, t1)
                mem_a = q(a.prom, 'max by (name) (avg_over_time(container_memory_working_set_bytes{name!=""}[%s]))' % win, t1)
                cnt_s = q(a.prom, 'max by (name) (count_over_time(container_cpu_usage_seconds_total{name!=""}[%s]))' % win, t1)
                mem_m = q(a.prom, 'max by (name) (max_over_time(container_memory_working_set_bytes{name!=""}[%s]))' % win, t1)
            except Exception as e:
                print('FAIL', base, rnd, e, file=sys.stderr)
                continue
            if src != 'obs' or len(cpu_a) < 40:
                print('WARN', base, rnd, 'window=%s src=%s n_obs=%d series=%d' % (win, src, nobs, len(cpu_a)), file=sys.stderr)
            for c in sorted(cpu_a):
                rows.append({
                    'run': base, 'kind': kind, 'workers': w, 'rep': rep, 'round': rnd, 'container': c,
                    'class': cls.get(c) or classify(c),
                    'cpu_avg': round(cpu_a[c] / dur * 100, 3),
                    'cpu_max': round(cpu_m.get(c, 0) * 100, 3),
                    'mem_avg_mb': round(mem_a.get(c, 0) / 1e6, 2),
                    'mem_max_mb': round(mem_m.get(c, 0) / 1e6, 2),
                    'win_s': dur, 'n_obs': nobs, 'src': src, 'n_samp': int(cnt_s.get(c, 0)),
                })
            print('ok', base, rnd, win, file=sys.stderr)

    cols = ['run', 'kind', 'workers', 'rep', 'round', 'container', 'class', 'cpu_avg', 'cpu_max', 'mem_avg_mb', 'mem_max_mb', 'win_s', 'n_obs', 'src', 'n_samp']
    with open(a.out, 'w', newline='') as f:
        wr = csv.DictWriter(f, fieldnames=cols)
        wr.writeheader()
        wr.writerows(rows)
    print('wrote %d rows -> %s' % (len(rows), a.out))

    if a.compare:
        old = {}
        with open(a.compare) as f:
            for r in csv.DictReader(f):
                old[(r['run'], r['round'], r['container'])] = float(r['cpu_avg'])
        diffs = []
        for r in rows:
            if r['class'] != 'caliper':
                continue
            k = (r['run'], r['round'], r['container'])
            if k in old:
                diffs.append((abs(r['cpu_avg'] - old[k]), k, old[k], r['cpu_avg']))
        diffs.sort(reverse=True)
        print('\nlargest Caliper-container CPU differences (Caliper csv vs Prometheus):')
        for d, k, o, n in diffs[:15]:
            print('  %-28s %-26s caliper=%8.1f  prom=%8.1f' % (k[0], k[1], o, n))


if __name__ == '__main__':
    main()
