#!/usr/bin/env bash
#
# How many peers really execute the chaincode for ONE transaction of each write identity?
# (Reviewer 2, 3.3: "a majority endorsement policy across 6 organisations means at least 4 executions per transaction")
#

# a seed, or on the current ledger); it adds ~600 assets, so do a reset before any official run afterwards.
#
#   ./endorse-count.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
mkdir -p reports

OUTTXT="reports/endorse-count.txt"
{ echo "# endorsements per write transaction - $(date -Is)"; echo "identity              tx   proposals   per tx"; } | tee "${OUTTXT}"
for id in eda man dist; do
	case "${id}" in eda) label=endorse_eda; fn="registerCompany (EDA)";; man) label=endorse_man; fn="addDrug (manufacturer)";; dist) label=endorse_dist; fn="createPO (distributor)";; esac
	pre="$(./snapshot.sh --endorse-total)"
	./run-benchmarks.sh "probe-${id}" --run-id "endorse-${id}" > "reports/endorse-${id}.out" 2>&1 || { echo "probe-${id} failed, see reports/endorse-${id}.out"; exit 1; }
	post="$(./snapshot.sh --endorse-total)"
	tx="$(python3 aggregate.py count "reports/endorse-${id}.log" "${label}")"
	printf '%-22s %4d %10d   %s\n' "${fn}" "${tx}" "$(( post - pre ))" "$(awk -v a=$(( post - pre )) -v b="${tx}" 'BEGIN{printf "%.2f", a/b}')" | tee -a "${OUTTXT}"
done
echo | tee -a "${OUTTXT}"
echo "A value of 4.00 = one execution per endorsing organisation in the connection profile; 5.00 means a non-endorsing peer is also being asked." | tee -a "${OUTTXT}"
echo "saved: ${OUTTXT}"
