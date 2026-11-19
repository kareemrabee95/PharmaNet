#!/usr/bin/env python3
"""
Per-container resource utilisation of every round of every run, taken from the Caliper HTML reports (Prometheus monitor).

  python3 export-resources.py 'reports/stress-*-[248]w-rep[123].html' --csv resources.csv

CSV columns: run, kind, workers, rep, round, container, class, cpu_avg, cpu_max, mem_avg_mb, mem_max_mb
CPU is in percent of ONE core (cAdvisor, 100 = one full core). Container classes: caliper, peer, chaincode, couchdb, orderer, ca, other.
"""
import argparse, collections, csv, glob, html, os, re, sys

RUN = re.compile(r'stress-(?P<kind>read|write)-(?P<w>\d+)w-rep(?P<rep>\d+)\.html$')


def klass(name):
    if name == 'caliper':
        return 'caliper'
    if name.startswith('dev-peer'):
        return 'chaincode'
    if re.match(r'peer\d\.', name):
        return 'peer'
    if name.startswith('couchdb'):
        return 'couchdb'
    if name.startswith('orderer'):
        return 'orderer'
    if name.startswith('ca.'):
        return 'ca'
    return 'other'


def parse_report(path):
    s = open(path, encoding='utf-8', errors='replace').read()
    out = {}
    for part in re.split(r'<h3>Resource utilization for ', s)[1:]:
        label = part.split('</h3>')[0].strip()
        body = re.split(r'Benchmark round:', part)[0]
        cur, d = None, collections.OrderedDict()
        for row in re.findall(r'<tr>(.*?)</tr>', body, re.S):
            tds = [html.unescape(re.sub(r'<[^>]+>', '', x)).strip() for x in re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)]
            if len(tds) == 4:
                if tds[0]:
                    cur = tds[0]
                d.setdefault(cur, {})[tds[2]] = tds[3]
        out[label] = d
    return out


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('glob', nargs='+')
    ap.add_argument('--csv', required=True)
    a = ap.parse_args()
    paths = sorted({p for g in a.glob for p in glob.glob(g)})
    if not paths:
        sys.exit('no reports matched')
    n = 0
    with open(a.csv, 'w', newline='') as f:
        wr = csv.writer(f)
        wr.writerow(['run', 'kind', 'workers', 'rep', 'round', 'container', 'class', 'cpu_avg', 'cpu_max', 'mem_avg_mb', 'mem_max_mb'])
        for p in paths:
            m = RUN.search(os.path.basename(p))
            if not m:
                continue
            rounds = parse_report(p)
            for label, d in rounds.items():
                names = set()
                for v in d.values():
                    names.update(v)
                for name in sorted(names):
                    wr.writerow([os.path.basename(p)[:-5], m.group('kind'), int(m.group('w')), int(m.group('rep')), label, name, klass(name),
                                 num(d.get('CPU% (avg)', {}).get(name)), num(d.get('CPU% (max)', {}).get(name)),
                                 num(d.get('Memory(MB) (avg)', {}).get(name)), num(d.get('Memory(MB) (max)', {}).get(name))])
                    n += 1
    print('%d reports, %d rows -> %s' % (len(paths), n, a.csv))


if __name__ == '__main__':
    main()
