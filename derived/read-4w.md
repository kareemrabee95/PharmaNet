
### stress-read  workers=4    (3 logs, repetitions: [1, 2, 3])
stable round = send >= 95% of target, failures <= 1%, goodput >= 95% of send, mean latency <= 2.0 s

**queryAllCompanies**
| target | n | send | throughput (Caliper) | goodput (Succ/60) | avg latency (s) | fail % | stable | send>=95% |
|---|---|---|---|---|---|---|---|---|
| 10 | 3 | 10.1 ± 0.0 | 10.0 ± 0.0 | 10.1 ± 0.0 | 0.20 ± 0.02 | 0.0 | 3/3 | 3/3 |
| 20 | 3 | 20.1 ± 0.1 | 20.0 ± 0.0 | 20.1 ± 0.0 | 0.19 ± 0.02 | 0.0 | 3/3 | 3/3 |
| 30 | 3 | 30.0 ± 0.0 | 29.9 ± 0.0 | 30.1 ± 0.0 | 0.16 ± 0.02 | 0.0 | 3/3 | 3/3 |
| 40 | 3 | 40.0 ± 0.0 | 35.0 ± 0.6 | 40.1 ± 0.0 | 5.61 ± 0.74 | 0.0 | 0/3 | 3/3 |
| 50 | 3 | 50.0 ± 0.0 | 34.2 ± 0.3 | 50.1 ± 0.0 | 18.08 ± 0.81 | 0.0 | 0/3 | 3/3 |
| 80 | 3 | 80.0 ± 0.1 | 31.4 ± 0.8 | 28.4 ± 1.1 | 28.57 ± 0.11* | 64.5 | 0/3 | 3/3 |
| 160 | 3 | 159.9 ± 0.1 | 92.8 ± 15.4 | 16.2 ± 5.7 | 52.17 ± 11.69* | 89.9 | 0/3 | 3/3 |
| 320 | 3 | 319.5 ± 0.2 | 189.3 ± 2.7 | 1.5 ± 0.2 | 25.49 ± 0.66* | 99.5 | 0/3 | 3/3 |

saturation: highest stable rate = 30 TPS ; first unstable = 40 TPS (latency > 2.0s)  ->  knee in [30, 40)
(* = mean latency covers successful tx only and the round had >1% failures: survivor-biased)

**queryDrugUnits**
| target | n | send | throughput (Caliper) | goodput (Succ/60) | avg latency (s) | fail % | stable | send>=95% |
|---|---|---|---|---|---|---|---|---|
| 1 | 3 | 1.1 ± 0.0 | 1.0 ± 0.0 | 1.1 ± 0.0 | 1.00 ± 0.03 | 0.0 | 3/3 | 3/3 |
| 2 | 3 | 2.1 ± 0.0 | 2.0 ± 0.0 | 2.1 ± 0.0 | 0.96 ± 0.04 | 0.0 | 3/3 | 3/3 |
| 3 | 3 | 3.1 ± 0.0 | 3.0 ± 0.0 | 3.1 ± 0.0 | 0.95 ± 0.03 | 0.0 | 3/3 | 3/3 |
| 5 | 3 | 5.1 ± 0.0 | 5.0 ± 0.0 | 5.1 ± 0.0 | 0.92 ± 0.02 | 0.0 | 3/3 | 3/3 |
| 7 | 3 | 7.1 ± 0.0 | 7.0 ± 0.0 | 7.1 ± 0.0 | 0.94 ± 0.02 | 0.0 | 3/3 | 3/3 |
| 10 | 3 | 10.1 ± 0.0 | 9.7 ± 0.1 | 10.1 ± 0.0 | 3.62 ± 0.24 | 0.0 | 0/3 | 3/3 |
| 20 | 3 | 20.0 ± 0.1 | 17.6 ± 0.5 | 3.0 ± 0.4 | 15.20 ± 0.27* | 85.1 | 0/3 | 3/3 |
| 40 | 3 | 40.0 ± 0.0 | 30.5 ± 0.6 | 3.5 ± 0.6 | 19.67 ± 2.56* | 91.4 | 0/3 | 3/3 |
| 80 | 3 | 79.9 ± 0.1 | 63.2 ± 0.5 | 0.0 ± 0.0 | -* | 100.0 | 0/3 | 3/3 |
| 160 | 3 | 159.9 ± 0.1 | 106.1 ± 18.8 | 4.1 ± 3.6 | 36.46 ± 7.69* | 97.5 | 0/3 | 3/3 |
| 320 | 3 | 320.0 ± 0.1 | 296.5 ± 6.9 | 0.0 ± 0.0 | -* | 100.0 | 0/3 | 3/3 |

saturation: highest stable rate = 7 TPS ; first unstable = 10 TPS (latency > 2.0s)  ->  knee in [7, 10)
(* = mean latency covers successful tx only and the round had >1% failures: survivor-biased)

**viewDrugCurrentState**
| target | n | send | throughput (Caliper) | goodput (Succ/60) | avg latency (s) | fail % | stable | send>=95% |
|---|---|---|---|---|---|---|---|---|
| 10 | 3 | 10.1 ± 0.0 | 10.1 ± 0.0 | 10.1 ± 0.0 | 0.02 ± 0.00 | 0.0 | 3/3 | 3/3 |
| 40 | 3 | 40.0 ± 0.0 | 40.0 ± 0.0 | 40.1 ± 0.0 | 0.02 ± 0.00 | 0.0 | 3/3 | 3/3 |
| 80 | 3 | 80.0 ± 0.1 | 79.9 ± 0.1 | 80.1 ± 0.0 | 0.02 ± 0.01 | 0.0 | 3/3 | 3/3 |
| 160 | 3 | 160.0 ± 0.1 | 159.9 ± 0.1 | 160.1 ± 0.0 | 0.01 ± 0.01 | 0.0 | 3/3 | 3/3 |
| 320 | 3 | 319.6 ± 0.1 | 319.5 ± 0.1 | 320.1 ± 0.0 | 0.01 ± 0.00 | 0.0 | 3/3 | 3/3 |

saturation: NOT reached - stable up to the highest tested rate (320 TPS)
(* = mean latency covers successful tx only and the round had >1% failures: survivor-biased)

CSV written to results-package/derived/read-4w.csv
