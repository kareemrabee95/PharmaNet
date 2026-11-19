
### stress-read  workers=8    (3 logs, repetitions: [1, 2, 3])
stable round = send >= 95% of target, failures <= 1%, goodput >= 95% of send, mean latency <= 2.0 s

**queryAllCompanies**
| target | n | send | throughput (Caliper) | goodput (Succ/60) | avg latency (s) | fail % | stable | send>=95% |
|---|---|---|---|---|---|---|---|---|
| 10 | 3 | 10.1 ± 0.0 | 10.0 ± 0.1 | 10.1 ± 0.0 | 0.25 ± 0.05 | 0.0 | 3/3 | 3/3 |
| 20 | 3 | 20.0 ± 0.0 | 19.9 ± 0.1 | 20.1 ± 0.0 | 0.18 ± 0.02 | 0.0 | 3/3 | 3/3 |
| 30 | 3 | 30.1 ± 0.1 | 29.9 ± 0.1 | 30.1 ± 0.0 | 0.27 ± 0.02 | 0.0 | 3/3 | 3/3 |
| 40 | 3 | 39.9 ± 0.1 | 35.7 ± 0.3 | 40.1 ± 0.0 | 4.66 ± 0.32 | 0.0 | 0/3 | 3/3 |
| 50 | 3 | 49.9 ± 0.1 | 35.1 ± 0.3 | 50.1 ± 0.0 | 16.53 ± 0.35 | 0.0 | 0/3 | 3/3 |
| 80 | 3 | 75.8 ± 6.6 | 27.8 ± 2.7 | 27.2 ± 5.7 | 26.03 ± 4.99* | 65.6 | 0/3 | 2/3 |
| 160 | 3 | 159.1 ± 0.2 | 88.1 ± 18.6 | 18.2 ± 4.8 | 53.99 ± 12.44* | 88.6 | 0/3 | 3/3 |
| 320 | 3 | 318.0 ± 0.3 | 188.8 ± 3.3 | 4.4 ± 3.9 | 21.52 ± 6.12* | 98.6 | 0/3 | 3/3 |

saturation: highest stable rate = 30 TPS ; first unstable = 40 TPS (latency > 2.0s)  ->  knee in [30, 40)
(* = mean latency covers successful tx only and the round had >1% failures: survivor-biased)

**queryDrugUnits**
| target | n | send | throughput (Caliper) | goodput (Succ/60) | avg latency (s) | fail % | stable | send>=95% |
|---|---|---|---|---|---|---|---|---|
| 1 | 3 | 1.1 ± 0.0 | 1.1 ± 0.0 | 1.2 ± 0.0 | 1.61 ± 0.05 | 0.0 | 3/3 | 3/3 |
| 2 | 3 | 2.1 ± 0.0 | 2.1 ± 0.0 | 2.1 ± 0.0 | 1.56 ± 0.02 | 0.0 | 3/3 | 3/3 |
| 3 | 3 | 3.1 ± 0.0 | 3.0 ± 0.0 | 3.2 ± 0.0 | 1.55 ± 0.08 | 0.0 | 3/3 | 3/3 |
| 5 | 3 | 5.1 ± 0.0 | 5.0 ± 0.0 | 5.2 ± 0.0 | 1.56 ± 0.04 | 0.0 | 3/3 | 3/3 |
| 7 | 3 | 7.1 ± 0.0 | 6.9 ± 0.0 | 7.2 ± 0.0 | 1.53 ± 0.12 | 0.0 | 3/3 | 3/3 |
| 10 | 3 | 10.1 ± 0.0 | 9.7 ± 0.0 | 10.1 ± 0.0 | 3.40 ± 0.36 | 0.0 | 0/3 | 3/3 |
| 20 | 3 | 20.0 ± 0.1 | 17.2 ± 0.5 | 3.7 ± 0.5 | 15.55 ± 1.01* | 81.5 | 0/3 | 3/3 |
| 40 | 3 | 39.9 ± 0.1 | 31.3 ± 0.5 | 2.9 ± 0.6 | 17.03 ± 2.18* | 92.7 | 0/3 | 3/3 |
| 80 | 3 | 79.7 ± 0.2 | 63.1 ± 0.5 | 0.0 ± 0.0 | -* | 100.0 | 0/3 | 3/3 |
| 160 | 3 | 159.4 ± 0.0 | 66.0 ± 13.3 | 5.4 ± 4.7 | 56.36 ± 4.88* | 96.6 | 0/3 | 3/3 |
| 320 | 3 | 318.6 ± 0.5 | 288.2 ± 22.6 | 0.0 ± 0.0 | -* | 100.0 | 0/3 | 3/3 |

saturation: highest stable rate = 7 TPS ; first unstable = 10 TPS (latency > 2.0s)  ->  knee in [7, 10)
(* = mean latency covers successful tx only and the round had >1% failures: survivor-biased)

**viewDrugCurrentState**
| target | n | send | throughput (Caliper) | goodput (Succ/60) | avg latency (s) | fail % | stable | send>=95% |
|---|---|---|---|---|---|---|---|---|
| 10 | 3 | 10.1 ± 0.0 | 10.1 ± 0.0 | 10.1 ± 0.0 | 0.02 ± 0.00 | 0.0 | 3/3 | 3/3 |
| 40 | 3 | 39.9 ± 0.1 | 39.9 ± 0.1 | 40.1 ± 0.0 | 0.02 ± 0.00 | 0.0 | 3/3 | 3/3 |
| 80 | 3 | 79.8 ± 0.1 | 79.7 ± 0.1 | 80.1 ± 0.0 | 0.02 ± 0.01 | 0.0 | 3/3 | 3/3 |
| 160 | 3 | 159.3 ± 0.3 | 159.3 ± 0.3 | 160.1 ± 0.0 | 0.01 ± 0.00 | 0.0 | 3/3 | 3/3 |
| 320 | 3 | 318.7 ± 0.6 | 318.7 ± 0.7 | 320.1 ± 0.0 | 0.01 ± 0.00 | 0.0 | 3/3 | 3/3 |

saturation: NOT reached - stable up to the highest tested rate (320 TPS)
(* = mean latency covers successful tx only and the round had >1% failures: survivor-biased)

CSV written to results-package/derived/read-8w.csv
