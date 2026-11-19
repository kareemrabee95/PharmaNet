
### stress-write  workers=8    (3 logs, repetitions: [1, 2, 3])
stable round = send >= 95% of target, failures <= 1%, goodput >= 95% of send, mean latency <= 2.0 s

**addDrug**
| target | n | send | throughput (Caliper) | goodput (Succ/60) | avg latency (s) | fail % | stable | send>=95% |
|---|---|---|---|---|---|---|---|---|
| 10 | 3 | 10.1 ± 0.0 | 10.0 ± 0.0 | 10.1 ± 0.0 | 0.44 ± 0.04 | 0.0 | 3/3 | 3/3 |
| 40 | 3 | 39.9 ± 0.1 | 39.7 ± 0.2 | 40.1 ± 0.0 | 0.39 ± 0.02 | 0.0 | 3/3 | 3/3 |
| 80 | 3 | 79.7 ± 0.1 | 79.1 ± 0.3 | 80.1 ± 0.0 | 0.48 ± 0.04 | 0.0 | 3/3 | 3/3 |
| 160 | 3 | 159.1 ± 0.3 | 157.7 ± 0.3 | 160.1 ± 0.0 | 1.12 ± 0.21 | 0.0 | 3/3 | 3/3 |
| 200 | 3 | 198.6 ± 0.7 | 166.2 ± 2.7 | 199.9 ± 0.4 | 23.70 ± 1.77 | 0.0 | 0/3 | 3/3 |
| 240 | 3 | 238.3 ± 0.8 | 158.5 ± 2.8 | 239.3 ± 1.0 | 45.11 ± 3.39 | 0.3 | 0/3 | 3/3 |
| 280 | 3 | 277.1 ± 0.6 | 166.5 ± 2.3 | 279.0 ± 1.0 | 53.86 ± 1.76 | 0.0 | 0/3 | 3/3 |
| 320 | 3 | 312.4 ± 6.4 | 175.6 ± 8.0 | 284.3 ± 9.6 | 60.54 ± 3.21* | 9.7 | 0/3 | 3/3 |

saturation: highest stable rate = 160 TPS ; first unstable = 200 TPS (latency > 2.0s)  ->  knee in [160, 200)
(* = mean latency covers successful tx only and the round had >1% failures: survivor-biased)

**createPO**
| target | n | send | throughput (Caliper) | goodput (Succ/60) | avg latency (s) | fail % | stable | send>=95% |
|---|---|---|---|---|---|---|---|---|
| 10 | 3 | 10.1 ± 0.0 | 10.0 ± 0.0 | 10.1 ± 0.0 | 0.36 ± 0.05 | 0.0 | 3/3 | 3/3 |
| 40 | 3 | 39.9 ± 0.1 | 39.6 ± 0.1 | 40.1 ± 0.0 | 0.42 ± 0.02 | 0.0 | 3/3 | 3/3 |
| 80 | 3 | 79.7 ± 0.1 | 79.3 ± 0.2 | 80.1 ± 0.0 | 0.51 ± 0.01 | 0.0 | 3/3 | 3/3 |
| 100 | 3 | 99.5 ± 0.1 | 99.0 ± 0.1 | 100.1 ± 0.0 | 0.67 ± 0.06 | 0.0 | 3/3 | 3/3 |
| 120 | 3 | 119.4 ± 0.4 | 118.1 ± 0.3 | 120.1 ± 0.0 | 1.28 ± 0.20 | 0.0 | 3/3 | 3/3 |
| 160 | 3 | 159.2 ± 0.1 | 132.7 ± 2.4 | 160.1 ± 0.0 | 19.53 ± 5.14 | 0.0 | 0/3 | 3/3 |
| 320 | 3 | 309.7 ± 6.1 | 168.5 ± 2.2 | 302.7 ± 8.7 | 63.47 ± 2.79* | 3.1 | 0/3 | 2/3 |

saturation: highest stable rate = 120 TPS ; first unstable = 160 TPS (latency > 2.0s)  ->  knee in [120, 160)
(* = mean latency covers successful tx only and the round had >1% failures: survivor-biased)

**registerCompany**
| target | n | send | throughput (Caliper) | goodput (Succ/60) | avg latency (s) | fail % | stable | send>=95% |
|---|---|---|---|---|---|---|---|---|
| 10 | 3 | 10.1 ± 0.0 | 10.0 ± 0.0 | 10.1 ± 0.0 | 0.38 ± 0.06 | 0.0 | 3/3 | 3/3 |
| 40 | 3 | 40.0 ± 0.1 | 39.7 ± 0.1 | 40.1 ± 0.0 | 0.40 ± 0.04 | 0.0 | 3/3 | 3/3 |
| 80 | 3 | 79.6 ± 0.3 | 79.1 ± 0.2 | 80.1 ± 0.0 | 0.45 ± 0.01 | 0.0 | 3/3 | 3/3 |
| 160 | 3 | 159.1 ± 0.1 | 157.7 ± 0.4 | 160.1 ± 0.0 | 1.06 ± 0.12 | 0.0 | 3/3 | 3/3 |
| 200 | 3 | 197.6 ± 1.2 | 173.8 ± 3.0 | 199.3 ± 1.4 | 13.30 ± 0.96 | 0.0 | 0/3 | 3/3 |
| 240 | 3 | 237.7 ± 1.0 | 173.9 ± 2.9 | 238.8 ± 1.2 | 32.36 ± 4.48 | 0.0 | 0/3 | 3/3 |
| 280 | 3 | 277.9 ± 0.1 | 174.3 ± 10.4 | 277.5 ± 2.9 | 46.17 ± 10.72 | 0.9 | 0/3 | 3/3 |
| 320 | 3 | 269.7 ± 36.1 | 181.0 ± 10.9 | 263.5 ± 15.5 | 50.62 ± 10.53* | 4.1 | 0/3 | 1/3 |

saturation: highest stable rate = 160 TPS ; first unstable = 200 TPS (latency > 2.0s)  ->  knee in [160, 200)
(* = mean latency covers successful tx only and the round had >1% failures: survivor-biased)

CSV written to results-package/derived/write-8w.csv
