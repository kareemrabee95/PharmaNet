# PharmaNet benchmark artifacts

Code, configuration and measured data for the paper "A Regulator-Centric Blockchain Framework for Pharmaceutical Traceability with Chaincode Performance Evaluation" (Hyperledger Fabric 2.5.9, Hyperledger Caliper 0.6.0).


## Contents

| path | content |
|---|---|
| `official/` | reports.zip (or reports.zip.part-aa, -ab, ...): one zip archive with all 270 official report files (Caliper log, HTML report with per-container CPU/RAM, docker die-events, meta snapshots, setup/seed/verify logs) |
| `official/benchmark-configs/` | the exact Caliper YAML of every run (written by `code/gen-yaml.py`) |
| `derived/` | mean ± SD tables (CSV and Markdown), per-container resources, world-state size per write run, failure causes, validation verdicts |
| `code/workloads/` | Caliper workload modules |
| `code/` | benchmark generator, runner, pinning, snapshot, analysis and figure scripts, RUNBOOK.md |
| `code/chaincode/` | chaincode source (no `node_modules`) |
| `code/chaincode-ops-counter/` | tool that counts ledger reads, writes and iterators per function (used for the complexity model) |
| `config/` | network-config, connection profiles, configtx.yaml, Docker Compose files. No keys or certificates. |
| `SHA256SUMS` | checksums of all files in this repository |

## Why the reports are one archive

The reports of all official runs, 18 main runs and 9 extra runs (Caliper logs and HTML reports), take about 1.6 GB of the 1.7 GB of this package. We therefore pack the folder `official/reports` into one archive and keep all other files as plain text. The files inside the archive are not modified. The extracted folder is listed in `.gitignore`, so it is not committed by mistake.

```bash
# check the file(s) first, then join the parts if the archive is split
sha256sum -c SHA256SUMS --ignore-missing
cat official/reports.zip.part-* > official/reports.zip   # only if split
# extract
unzip official/reports.zip -d official
```


## Naming

`stress-<read|write>-<W>w-rep<N>` is official run N with W Caliper workers. Every repetition starts from a wiped ledger and the same seed (`prep-*-setup|seed|verify`). Runs with the suffix `-extra` are additional runs for rates above the main sweep (2 workers: viewDrugCurrentState and addDrug up to 320 TPS). Rounds named `warmup_*`, `cooldown_*`, `recovery_*` and `drift_*` are excluded from the statistics.

## Requirements

- Linux host with 12 vCPU (Caliper on cores 8 to 11, the network on cores 0 to 7; see `code/pin-cpus.sh`)
- Docker and Docker Compose
- Hyperledger Fabric 2.5.9 (6 organizations, 12 peers, 3 Raft orderers, CouchDB)
- Hyperledger Caliper 0.6.0 (CLI in a container), Node.js
- Python 3 with `numpy`, `matplotlib`, `openpyxl` (analysis and figures only)

## How to run

1. Start the network and deploy the chaincode with `config/fabricNetwork.sh` (`restart`, then `install`). `code/hooks/reset.sh` does this for every run; edit its four paths first.
2. Copy `code/workloads/` and the scripts into `network/caliper/` (same folder layout) and run `chmod +x code/*.sh code/*.py`.
3. One run (pilot): `./experiment.sh --kind write -w 8 --rep 1 --variant pilot`
4. Official runs (3 repetitions, reset before each): `./experiment.sh --matrix read --workers "8 4 2" --reps "1 2 3"`, then the same with `write`
5. Statistics: `python3 aggregate.py summary 'reports/stress-read-8w-rep[123].log' --csv derived/read-8w.csv`
6. Checks: `python3 aggregate.py validate 'reports/stress-*-8w-rep[123].log' -v`



## Stability criterion

A round is stable if the send rate is at least 95% of the target, failures are at most 1%, goodput (successful transactions per second) is at least 95% of the send rate, and the mean latency is at most 2 s. The knee is the interval between the highest stable and the first unstable offered rate.

## Resource data
`derived/resources.csv` holds the CPU and memory of every container in every round. It comes straight from Prometheus (cAdvisor counters) with `code/export-resources-prom.py`: mean CPU between the first and last progress line of the round, memory peak in the same window; the columns `win_s`, `n_obs`, `src` and 
## License and citation

License: <to be added> (see the LICENSE file).
