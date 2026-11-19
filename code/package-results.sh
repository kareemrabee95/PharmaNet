#!/usr/bin/env bash

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
HERE="$(pwd)"

ARCHIVE=0; SPLITMB=95
RESCSV=""; OUT="results-package"; NETDIR="${HOME}/pharma/network"; CC_DIR=""; EXPL=0; ZIP=0; SLIM=0; COMPRESS=0
while [[ $# -gt 0 ]]; do
	case "$1" in
		--out) OUT="$2"; shift 2 ;;
		--network-dir) NETDIR="$2"; shift 2 ;;
		--chaincode) CC_DIR="$2"; shift 2 ;;
		--include-exploratory) EXPL=1; shift ;;
		--zip) ZIP=1; shift ;;
		--slim) SLIM=1; shift ;;
		--resources-csv) RESCSV="$2"; shift 2 ;;
		--compress) COMPRESS=1; shift ;;
		--archive-reports) ARCHIVE=1; shift ;;
		--split-mb) SPLITMB="$2"; shift 2 ;;
		-h|--help) sed -n '2,17p' "$0"; exit 0 ;;
		*) echo "unknown argument: $1" >&2; exit 2 ;;
	esac
done

rm -rf "${OUT}"
mkdir -p "${OUT}"/{official/reports,official/benchmark-configs,official/endorsement,derived,code,config,exploratory}
GEN="caliper-benchmarks-local/benchmarks/scenario/simple/kareem/generated"

# ---- 1) official runs = exactly  stress-(read|write)-<W>w-rep<N>.*   and  prep-(read|write)-<W>w-rep<N>-(setup|seed|verify).*
OFFICIAL_RE='^(stress-(read|write)-[0-9]+w-rep[0-9]+(-extra)?\.(log|html|events\.log|meta\.txt)|prep-(read|write)-[0-9]+w-rep[0-9]+(-extra)?-(setup|seed|verify)\.(log|html))$'
n_off=0
for f in $(ls reports 2>/dev/null); do
	if [[ "${f}" =~ ${OFFICIAL_RE} ]]; then
		cp -p "reports/${f}" "${OUT}/official/reports/"; n_off=$(( n_off + 1 ))
		base="${f%.*}"; base="${base%.events}"; base="${base%.meta}"
		[[ -f "${GEN}/${base}.yaml" ]] && cp -p "${GEN}/${base}.yaml" "${OUT}/official/benchmark-configs/" || true
	elif [[ "${EXPL}" -eq 1 && -f "reports/${f}" ]]; then
		mkdir -p "${OUT}/exploratory/reports"; cp -p "reports/${f}" "${OUT}/exploratory/reports/"
	fi
done
if [[ "${EXPL}" -eq 1 ]]; then cp -p "${GEN}"/*.yaml "${OUT}/exploratory/" 2>/dev/null || true; fi
rmdir "${OUT}/exploratory" 2>/dev/null || true
# endorsement measurement (endorse-count.sh): table + the three probe runs
cp -p reports/endorse-count.txt "${OUT}/official/endorsement/" 2>/dev/null || true
for f in reports/endorse-eda.log reports/endorse-man.log reports/endorse-dist.log reports/endorse-eda.html reports/endorse-man.html reports/endorse-dist.html; do
	[[ -f "${f}" ]] && cp -p "${f}" "${OUT}/official/endorsement/" || true
done
rmdir "${OUT}/official/endorsement" 2>/dev/null || true
echo "official files copied: ${n_off}"

# ---- 2) code
mkdir -p "${OUT}/code/workloads" "${OUT}/code/hooks"
cp -p caliper-benchmarks-local/benchmarks/scenario/simple/kareem/*.js "${OUT}/code/workloads/"
cp -p gen-yaml.py run-benchmarks.sh experiment.sh official-*.sh pin-cpus.sh snapshot.sh aggregate.py export-resources.py export-resources-prom.py make-tables.py make-figures.py endorse-count.sh package-results.sh RUNBOOK.md "${OUT}/code/" 2>/dev/null || true
cp -p hooks/reset.sh "${OUT}/code/hooks/" 2>/dev/null || true
[[ -d chaincode-ops-counter ]] && cp -rp chaincode-ops-counter "${OUT}/code/" || true
if [[ -n "${CC_DIR}" && -d "${CC_DIR}" ]]; then
	mkdir -p "${OUT}/code/chaincode"
	# node_modules (hundreds of MB) and key files are never copied
	( cd "${CC_DIR}" && tar --exclude=node_modules --exclude='*.pem' --exclude='*_sk' --exclude='*.key' -cf - . ) | ( cd "${OUT}/code/chaincode" && tar -xf - )
else
	echo "NOTE: pass --chaincode <dir> to include the chaincode source (utils/, contracts/, enums/) - Reviewer 2 asked for it."
fi

# ---- 3) config (never crypto-config / keys)
for f in "${NETDIR}"/configtx.yaml "${NETDIR}"/docker-compose*.y*ml "${NETDIR}"/crypto-config.yaml "${NETDIR}"/fabricNetwork.sh \
         caliper-benchmarks-local/networks/fabric/kareem/network-config.yaml caliper-benchmarks-local/networks/fabric/kareem/connection-*.yaml \
         docker-compose.yaml; do
	[[ -f "${f}" ]] && cp -p "${f}" "${OUT}/config/" || true
done
[[ -d "${NETDIR}/prometheus-grafana" ]] && find "${NETDIR}/prometheus-grafana" -maxdepth 2 -name '*.yml' -o -maxdepth 2 -name '*.yaml' 2>/dev/null | while read -r f; do cp -p "${f}" "${OUT}/config/prometheus-$(basename "${f}")"; done || true

# ---- 4) derived numbers
mkdir -p "${OUT}/derived/state-size"
{
	echo "# aggregate.py validate"
	python3 aggregate.py validate 'reports/stress-*-[0-9]*w-rep[0-9].log' 'reports/stress-*-[0-9]*w-rep[0-9]-extra.log' -v || true
} > "${OUT}/derived/validation.txt" 2>&1
for kind in read write; do
	for w in $(ls reports 2>/dev/null | sed -n "s/^stress-${kind}-\([0-9]*\)w-rep[0-9]*\.log$/\1/p" | sort -un); do
		python3 aggregate.py summary "reports/stress-${kind}-${w}w-rep[0-9].log" "reports/stress-${kind}-${w}w-rep[0-9]-extra.log" --merge-variants --csv "${OUT}/derived/${kind}-${w}w.csv" \
			> "${OUT}/derived/${kind}-${w}w.md" 2>/dev/null || true
	done
done
for f in reports/stress-write-*w-rep[0-9].log; do
	[[ -f "${f}" ]] || continue
	python3 aggregate.py state-size "${f}" --csv "${OUT}/derived/state-size/$(basename "${f%.log}").csv" > /dev/null 2>&1 || true
done

# per-container resources of every round (from the HTML reports) and the LaTeX tables of the paper
mkdir -p "${OUT}/derived/tables"
# The resource data come straight from Prometheus (export-resources-prom.py, run on the host while Prometheus still holds the data).
# The CPU values in the Caliper HTML reports are NOT used: they were 17-38 % below docker stats and wrong for some write rounds.
[[ -z "${RESCSV}" && -f resources-prom.csv ]] && RESCSV="resources-prom.csv"
if [[ -n "${RESCSV}" && -f "${RESCSV}" ]]; then
	cp -p "${RESCSV}" "${OUT}/derived/resources.csv"
else
	echo "WARNING: no resources-prom.csv found - run export-resources-prom.py first (or pass --resources-csv). The resource table is skipped." >&2
fi
python3 make-tables.py results   --csv-dir "${OUT}/derived" --out "${OUT}/derived/tables/caliper_table.tex" > /dev/null 2>&1 || true
python3 make-tables.py knee      --csv-dir "${OUT}/derived" --out "${OUT}/derived/tables/saturation_table.tex" > "${OUT}/derived/tables/saturation.md" 2>&1 || true
[[ -f "${OUT}/derived/resources.csv" ]] && python3 make-tables.py resources --resources "${OUT}/derived/resources.csv" --csv-dir "${OUT}/derived" --workers 8 --out "${OUT}/derived/tables/resource_table.tex" > /dev/null 2>&1 || true

# failure causes per run (counts of the error strings that Caliper prints)
{
	printf '%-28s %9s %9s %9s %9s %9s %9s %9s\n' run timeout 'timed_out' query_failed mvcc phantom endorse_pol unavailable
	for f in reports/stress-*-[0-9]*w-rep[0-9].log; do
		[[ -f "${f}" ]] || continue
		c() { grep -ci -- "$1" "${f}" || true; }
		printf '%-28s %9s %9s %9s %9s %9s %9s %9s\n' "$(basename "${f%.log}")" "$(c 'REQUEST TIMEOUT')" "$(c 'timed out')" "$(c 'Query failed')" \
			"$(c 'MVCC_READ_CONFLICT')" "$(c 'PHANTOM_READ_CONFLICT')" "$(c 'ENDORSEMENT_POLICY_FAILURE')" "$(c 'Unavailable')"
	done
} > "${OUT}/derived/failure-causes.txt" 2>/dev/null || true

# ---- size reduction (after every derived table has been built from reports/)
if [[ "${SLIM}" -eq 1 ]]; then
	find "${OUT}/official/reports" -name 'prep-*.html' -delete
fi
if [[ "${COMPRESS}" -eq 1 ]]; then
	find "${OUT}/official" -type f \( -name '*.log' -o -name '*.html' \) -exec gzip -9 {} +
	echo "official/ files are gzip-compressed (*.log.gz, *.html.gz); the scripts in code/ read the plain files, so gunzip them first to re-run aggregate.py"
fi

# ---- 5) safety scan: refuse to produce a package that contains key material
if grep -rIlE 'BEGIN [A-Z ]*PRIVATE KEY' "${OUT}" 2>/dev/null | head -1 | grep -q .; then
	echo "ABORT: private key material found in the package:" >&2
	grep -rIlE 'BEGIN [A-Z ]*PRIVATE KEY' "${OUT}" >&2
	rm -rf "${OUT}"; exit 1
fi
find "${OUT}" \( -name '*_sk' -o -name 'priv_sk' -o -name '*.key' \) -print -delete

# ---- 6) archive, README, .gitignore, checksums
NREP="$(ls "${OUT}/official/reports" 2>/dev/null | wc -l)"
if [[ "${ARCHIVE}" -eq 1 ]]; then
	( cd "${OUT}/official" && zip -q -r -9 reports.zip reports )
	rm -rf "${OUT}/official/reports"
	asz=$(stat -c %s "${OUT}/official/reports.zip")
	if [[ "${asz}" -gt $(( SPLITMB * 1024 * 1024 )) ]]; then
		( cd "${OUT}/official" && split -b "${SPLITMB}M" reports.zip reports.zip.part- && rm reports.zip )
		echo "official/reports packed and split into $(ls "${OUT}"/official/reports.zip.part-* | wc -l) parts of at most ${SPLITMB} MB"
	else
		echo "official/reports packed: reports.zip ($(du -sh "${OUT}/official/reports.zip" | cut -f1))"
	fi
fi

FIRST_META="$(ls "${OUT}"/official/reports/*.meta.txt 2>/dev/null | head -1 || true)"
[[ -z "${FIRST_META}" && -f "${HERE}/.first-meta.txt" ]] && FIRST_META="${HERE}/.first-meta.txt"
if [[ "${ARCHIVE}" -eq 1 ]]; then
	REPORTS_ROW="official/reports.zip (or reports.zip.part-aa, -ab, ...): one zip archive with all ${NREP} official report files (Caliper log, HTML report with per-container CPU/RAM, docker die-events, meta snapshots, setup/seed/verify logs)"
else
	REPORTS_ROW="official/reports: $(ls "${OUT}/official/reports" | wc -l) files (Caliper log, HTML report with per-container CPU/RAM, docker die-events, meta snapshots, setup/seed/verify logs)"
fi
cat > "${OUT}/.gitignore" <<'GI'
# Extracted copy of official/reports.zip. Only the archive is versioned (the folder is ~1.5 GB).
official/reports/
# Never commit key material or generated crypto
crypto-config/
organizations/
*.pem
*_sk
*.key
# local files
node_modules/
__pycache__/
*.pyc
*.zip
.DS_Store
GI
{
cat <<EOF
# PharmaNet benchmark artifacts

Code, configuration and measured data for the paper "A Regulator-Centric Blockchain Framework for Pharmaceutical Traceability with Chaincode Performance Evaluation" (Hyperledger Fabric 2.5.9, Hyperledger Caliper 0.6.0).

Generated: $(date -Is)

## Contents

| path | content |
|---|---|
| \`official/\` | $(echo "${REPORTS_ROW}" | sed 's/^official\///') |
| \`official/benchmark-configs/\` | the exact Caliper YAML of every run (written by \`code/gen-yaml.py\`) |
| \`derived/\` | mean ± SD tables (CSV and Markdown), per-container resources, world-state size per write run, failure causes, validation verdicts |
| \`derived/tables/\` | the LaTeX tables of the paper (Tables 7 to 9) |
| \`code/workloads/\` | Caliper workload modules |
| \`code/\` | benchmark generator, runner, pinning, snapshot, analysis and figure scripts, RUNBOOK.md |
| \`code/chaincode/\` | chaincode source (no \`node_modules\`) |
| \`code/chaincode-ops-counter/\` | tool that counts ledger reads, writes and iterators per function (used for the complexity model) |
| \`config/\` | network-config, connection profiles, configtx.yaml, Docker Compose files. No keys or certificates. |
| \`SHA256SUMS\` | checksums of all files in this repository |

## Why the reports are one archive

The reports of all official runs, 18 main runs and 9 extra runs (Caliper logs and HTML reports), take about 1.5 GB of the 1.6 GB of this package. We therefore pack the folder \`official/reports\` into one archive and keep all other files as plain text. The files inside the archive are not modified. The extracted folder is listed in \`.gitignore\`, so it is not committed by mistake.

\`\`\`bash
# check the file(s) first, then join the parts if the archive is split
sha256sum -c SHA256SUMS --ignore-missing
cat official/reports.zip.part-* > official/reports.zip   # only if split
# extract
unzip official/reports.zip -d official
\`\`\`

The tables in \`derived/\` were built from these reports before they were packed.

## Naming

\`stress-<read|write>-<W>w-rep<N>\` is official run N with W Caliper workers. Every repetition starts from a wiped ledger and the same seed (\`prep-*-setup|seed|verify\`). Runs with the suffix \`-extra\` are additional runs for rates above the main sweep (2 workers: viewDrugCurrentState and addDrug up to 320 TPS). Rounds named \`warmup_*\`, \`cooldown_*\`, \`recovery_*\` and \`drift_*\` are excluded from the statistics.

## Requirements

- Linux host with 12 vCPU (Caliper on cores 8 to 11, the network on cores 0 to 7; see \`code/pin-cpus.sh\`)
- Docker and Docker Compose
- Hyperledger Fabric 2.5.9 (6 organizations, 12 peers, 3 Raft orderers, CouchDB)
- Hyperledger Caliper 0.6.0 (CLI in a container), Node.js
- Python 3 with \`numpy\`, \`matplotlib\`, \`openpyxl\` (analysis and figures only)

## How to run

1. Start the network and deploy the chaincode with \`config/fabricNetwork.sh\` (\`restart\`, then \`install\`). \`code/hooks/reset.sh\` does this for every run; edit its four paths first.
2. Copy \`code/workloads/\` and the scripts into \`network/caliper/\` (same folder layout) and run \`chmod +x code/*.sh code/*.py\`.
3. One run (pilot): \`./experiment.sh --kind write -w 8 --rep 1 --variant pilot\`
4. Official runs (3 repetitions, reset before each): \`./experiment.sh --matrix read --workers "8 4 2" --reps "1 2 3"\`, then the same with \`write\`
5. Statistics: \`python3 aggregate.py summary 'reports/stress-read-8w-rep[123].log' --csv derived/read-8w.csv\`
6. Checks: \`python3 aggregate.py validate 'reports/stress-*-8w-rep[123].log' -v\`
7. Tables and figures: \`python3 make-tables.py results|knee|resources ...\` and \`python3 make-figures.py --csv-dir derived --resources derived/resources.csv --out figures\`

See \`code/RUNBOOK.md\` for details (in Arabic) and for the stability criterion and the knee definition.

## Stability criterion

A round is stable if the send rate is at least 95% of the target, failures are at most 1%, goodput (successful transactions per second) is at least 95% of the send rate, and the mean latency is at most 2 s. The knee is the interval between the highest stable and the first unstable offered rate.

## Resource data
\`derived/resources.csv\` holds the CPU and memory of every container in every round. It comes straight from Prometheus (cAdvisor counters) with \`code/export-resources-prom.py\`: mean CPU between the first and last progress line of the round, memory peak in the same window; the columns \`win_s\`, \`n_obs\`, \`src\` and \`n_samp\` give the window and the number of samples. We checked the method against \`docker stats\` in one 80 TPS round (Prometheus 6 to 7 % lower). The CPU values in the Caliper HTML reports are not used (17 to 38 % lower in that check). Prometheus scraped every 5 s up to 80 TPS of the write functions; at higher write rates the interval grew to 11 to 50 s (\`n_samp\` is small), and the paper reports no resource values for those rounds. Log timestamps of Caliper are UTC.

## License and citation

License: <to be added> (see the LICENSE file).
EOF
[[ -n "${FIRST_META}" ]] && { echo; echo '## Environment (first run)'; echo; echo '```'; head -25 "${FIRST_META}"; echo '```'; }
} > "${OUT}/README.md"
( cd "${OUT}" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS )
echo "package: ${OUT}  ($(find "${OUT}" -type f | wc -l) files, $(du -sh "${OUT}" | cut -f1))"
if [[ "${ZIP}" -eq 1 ]]; then zip -qr "${OUT}.zip" "${OUT}" && echo "zip: ${OUT}.zip"; fi
