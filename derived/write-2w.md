
### stress-write  workers=2    (6 logs, repetitions: [1, 2, 3])
stable round = send >= 95% of target, failures <= 1%, goodput >= 95% of send, mean latency <= 2.0 s

**addDrug**
| target | n | send | throughput (Caliper) | goodput (Succ/60) | avg latency (s) | fail % | stable | send>=95% |
|---|---|---|---|---|---|---|---|---|
| 10 | 3 | 10.0 ± 0.0 | 9.9 ± 0.1 | 10.0 ± 0.0 | 0.37 ± 0.02 | 0.0 | 3/3 | 3/3 |
| 40 | 3 | 40.0 ± 0.0 | 39.7 ± 0.2 | 40.0 ± 0.0 | 0.43 ± 0.05 | 0.0 | 3/3 | 3/3 |
| 80 | 3 | 80.0 ± 0.1 | 79.5 ± 0.1 | 80.0 ± 0.0 | 0.55 ± 0.12 | 0.0 | 3/3 | 3/3 |
| 160 | 3 | 159.8 ± 0.1 | 158.0 ± 0.3 | 160.0 ± 0.0 | 1.25 ± 0.19 | 0.0 | 3/3 | 3/3 |
| 200 | 3 | 195.8 ± 2.1 | 171.6 ± 9.0 | 196.1 ± 2.0 | 16.15 ± 5.30 | 0.0 | 0/3 | 3/3 |
| 240 | 3 | 230.7 ± 15.1 | 155.6 ± 11.0 | 231.4 ± 14.2 | 41.14 ± 8.76 | 0.0 | 0/3 | 2/3 |
| 280 | 3 | 257.0 ± 9.8 | 140.4 ± 7.2 | 250.2 ± 13.6 | 58.62 ± 5.42* | 2.8 | 0/3 | 1/3 |
| 320 | 3 | 258.5 ± 9.1 | 141.5 ± 1.2 | 226.8 ± 45.7 | 60.95 ± 1.19* | 11.8 | 0/3 | 0/3 |

saturation: highest stable rate = 160 TPS ; first unstable = 200 TPS (latency > 2.0s)  ->  knee in [160, 200)
(* = mean latency covers successful tx only and the round had >1% failures: survivor-biased)

**createPO**
| target | n | send | throughput (Caliper) | goodput (Succ/60) | avg latency (s) | fail % | stable | send>=95% |
|---|---|---|---|---|---|---|---|---|
| 10 | 3 | 10.0 ± 0.0 | 9.9 ± 0.0 | 10.0 ± 0.0 | 0.36 ± 0.02 | 0.0 | 3/3 | 3/3 |
| 40 | 3 | 40.0 ± 0.0 | 39.8 ± 0.1 | 40.0 ± 0.0 | 0.41 ± 0.00 | 0.0 | 3/3 | 3/3 |
| 80 | 3 | 80.0 ± 0.0 | 79.4 ± 0.1 | 80.0 ± 0.0 | 0.50 ± 0.02 | 0.0 | 3/3 | 3/3 |
| 100 | 3 | 99.9 ± 0.1 | 96.4 ± 4.8 | 100.0 ± 0.0 | 4.84 ± 7.18 | 0.0 | 2/3 | 3/3 |
| 120 | 3 | 119.9 ± 0.1 | 118.8 ± 0.3 | 120.0 ± 0.0 | 1.58 ± 0.66 | 0.0 | 2/3 | 3/3 |
| 160 | 3 | 158.2 ± 2.9 | 138.6 ± 8.5 | 158.3 ± 2.8 | 14.29 ± 5.83 | 0.0 | 0/3 | 3/3 |

saturation: highest stable rate = 80 TPS ; first unstable = 100 TPS (latency > 2.0s)  ->  knee in [80, 100)
(* = mean latency covers successful tx only and the round had >1% failures: survivor-biased)

**registerCompany**
| target | n | send | throughput (Caliper) | goodput (Succ/60) | avg latency (s) | fail % | stable | send>=95% |
|---|---|---|---|---|---|---|---|---|
| 10 | 3 | 10.0 ± 0.0 | 9.9 ± 0.1 | 10.0 ± 0.0 | 0.46 ± 0.16 | 0.0 | 3/3 | 3/3 |
| 40 | 3 | 40.0 ± 0.0 | 39.9 ± 0.1 | 40.0 ± 0.0 | 0.38 ± 0.01 | 0.0 | 3/3 | 3/3 |
| 80 | 3 | 80.0 ± 0.0 | 79.4 ± 0.1 | 80.0 ± 0.0 | 1.03 ± 1.03 | 0.0 | 2/3 | 3/3 |
| 160 | 3 | 160.0 ± 0.1 | 158.3 ± 0.2 | 160.0 ± 0.1 | 1.48 ± 0.58 | 0.0 | 2/3 | 3/3 |

saturation: highest stable rate = 40 TPS ; first unstable = 80 TPS (latency > 2.0s)  ->  knee in [40, 80)
(* = mean latency covers successful tx only and the round had >1% failures: survivor-biased)

CSV written to results-package/derived/write-2w.csv
