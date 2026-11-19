
### stress-read  workers=2    (6 logs, repetitions: [1, 2, 3])
stable round = send >= 95% of target, failures <= 1%, goodput >= 95% of send, mean latency <= 2.0 s

**queryAllCompanies**
| target | n | send | throughput (Caliper) | goodput (Succ/60) | avg latency (s) | fail % | stable | send>=95% |
|---|---|---|---|---|---|---|---|---|
| 10 | 3 | 10.0 ± 0.0 | 10.0 ± 0.0 | 10.0 ± 0.0 | 0.13 ± 0.01 | 0.0 | 3/3 | 3/3 |
| 20 | 3 | 20.0 ± 0.0 | 20.0 ± 0.0 | 20.0 ± 0.0 | 0.13 ± 0.01 | 0.0 | 3/3 | 3/3 |
| 30 | 3 | 30.0 ± 0.0 | 29.9 ± 0.1 | 30.0 ± 0.0 | 0.14 ± 0.02 | 0.0 | 3/3 | 3/3 |
| 40 | 3 | 40.0 ± 0.0 | 35.4 ± 0.2 | 40.0 ± 0.0 | 5.26 ± 0.46 | 0.0 | 0/3 | 3/3 |
| 50 | 3 | 50.0 ± 0.0 | 34.8 ± 0.1 | 50.0 ± 0.0 | 17.06 ± 0.09 | 0.0 | 0/3 | 3/3 |
| 80 | 3 | 80.0 ± 0.0 | 29.7 ± 2.1 | 29.5 ± 0.6 | 28.94 ± 0.42* | 63.1 | 0/3 | 3/3 |
| 160 | 3 | 160.0 ± 0.0 | 102.9 ± 13.8 | 14.6 ± 3.8 | 44.89 ± 9.61* | 90.9 | 0/3 | 3/3 |

saturation: highest stable rate = 30 TPS ; first unstable = 40 TPS (latency > 2.0s)  ->  knee in [30, 40)
(* = mean latency covers successful tx only and the round had >1% failures: survivor-biased)

**queryDrugUnits**
| target | n | send | throughput (Caliper) | goodput (Succ/60) | avg latency (s) | fail % | stable | send>=95% |
|---|---|---|---|---|---|---|---|---|
| 1 | 3 | 1.0 ± 0.0 | 1.0 ± 0.0 | 1.0 ± 0.0 | 0.56 ± 0.01 | 0.0 | 3/3 | 3/3 |
| 2 | 3 | 2.0 ± 0.0 | 2.0 ± 0.0 | 2.0 ± 0.0 | 0.56 ± 0.01 | 0.0 | 3/3 | 3/3 |
| 3 | 3 | 3.0 ± 0.0 | 3.0 ± 0.0 | 3.0 ± 0.0 | 0.55 ± 0.00 | 0.0 | 3/3 | 3/3 |
| 5 | 3 | 5.0 ± 0.0 | 5.0 ± 0.0 | 5.0 ± 0.0 | 0.54 ± 0.01 | 0.0 | 3/3 | 3/3 |
| 7 | 3 | 7.0 ± 0.0 | 7.0 ± 0.0 | 7.0 ± 0.0 | 0.52 ± 0.01 | 0.0 | 3/3 | 3/3 |
| 10 | 3 | 10.0 ± 0.0 | 9.7 ± 0.0 | 10.0 ± 0.0 | 3.52 ± 0.14 | 0.0 | 0/3 | 3/3 |
| 20 | 3 | 20.0 ± 0.0 | 16.8 ± 0.7 | 3.8 ± 1.1 | 16.20 ± 0.56* | 80.9 | 0/3 | 3/3 |
| 40 | 3 | 40.0 ± 0.0 | 31.0 ± 1.7 | 3.2 ± 0.9 | 17.79 ± 4.19* | 92.1 | 0/3 | 3/3 |
| 80 | 3 | 80.0 ± 0.0 | 64.1 ± 0.3 | 0.0 ± 0.0 | -* | 100.0 | 0/3 | 3/3 |
| 160 | 3 | 159.9 ± 0.1 | 97.3 ± 38.1 | 0.0 ± 0.1 | 119.59 ± 0.00* | 100.0 | 0/3 | 3/3 |

saturation: highest stable rate = 7 TPS ; first unstable = 10 TPS (latency > 2.0s)  ->  knee in [7, 10)
(* = mean latency covers successful tx only and the round had >1% failures: survivor-biased)

**viewDrugCurrentState**
| target | n | send | throughput (Caliper) | goodput (Succ/60) | avg latency (s) | fail % | stable | send>=95% |
|---|---|---|---|---|---|---|---|---|
| 10 | 3 | 10.0 ± 0.0 | 10.0 ± 0.0 | 10.0 ± 0.0 | 0.02 ± 0.00 | 0.0 | 3/3 | 3/3 |
| 40 | 3 | 40.0 ± 0.0 | 40.0 ± 0.0 | 40.0 ± 0.0 | 0.02 ± 0.00 | 0.0 | 3/3 | 3/3 |
| 80 | 3 | 80.0 ± 0.1 | 79.9 ± 0.1 | 80.0 ± 0.0 | 0.01 ± 0.01 | 0.0 | 3/3 | 3/3 |
| 160 | 3 | 159.8 ± 0.2 | 159.8 ± 0.1 | 160.0 ± 0.0 | 0.01 ± 0.00 | 0.0 | 3/3 | 3/3 |
| 320 | 3 | 319.9 ± 0.1 | 319.8 ± 0.1 | 320.0 ± 0.0 | 0.01 ± 0.00 | 0.0 | 3/3 | 3/3 |

saturation: NOT reached - stable up to the highest tested rate (320 TPS)
(* = mean latency covers successful tx only and the round had >1% failures: survivor-biased)

CSV written to results-package/derived/read-2w.csv
