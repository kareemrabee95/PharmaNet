#!/usr/bin/env bash
#
# Record the facts a reviewer will ask for (reproducibility): hardware, cpusets, image versions, ledger size,
# batch settings and the number of endorsements that were really executed.
#
#   ./snapshot.sh <run-id> <label>        append a block to reports/<run-id>.meta.txt
#   ./snapshot.sh --endorse-total         print only the total ProcessProposal count of all peers
#
# env: COUCH_URL (default http://localhost:5984)  COUCH_DB (default pharmachannel_pharmanet)
#      COUCH_USER / COUCH_PASS   CONFIGTX=/path/to/configtx.yaml
#
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORTS_DIR="${SCRIPT_DIR}/reports"
CALIPER_NAME="${CALIPER_CONTAINER:-caliper}"

endorse_total() {
	local total=0 n
	for c in $(docker ps --format '{{.Names}}' | grep -E '^peer' || true); do
		n=$(docker logs "${c}" 2>&1 | grep -c 'grpc.method=ProcessProposal' || true)
		total=$(( total + n ))
	done
	echo "${total}"
}

if [[ "${1:-}" == "--endorse-total" ]]; then
	endorse_total
	exit 0
fi

RUN_ID="${1:?usage: snapshot.sh <run-id> <label>}"
LABEL="${2:-snapshot}"
mkdir -p "${REPORTS_DIR}"
OUT="${REPORTS_DIR}/${RUN_ID}.meta.txt"

{
	echo "=================== ${LABEL}  $(date -Is) ==================="
	echo "host      : $(hostname)   vCPU=$(nproc)   $(free -m | awk '/^Mem:/{print "RAM_MB="$2" free_MB="$4}')"
	echo "swap      : $(free -m | awk '/^Swap:/{print "total_MB="$2" used_MB="$3}')"
	echo "docker    : $(docker version --format '{{.Server.Version}}' 2>/dev/null)"
	echo "caliper   : image=$(docker inspect -f '{{.Config.Image}}' "${CALIPER_NAME}" 2>/dev/null)"
	echo "containers (name | image | cpuset):"
	docker ps --format '{{.Names}}|{{.Image}}' | while IFS='|' read -r n i; do
		echo "   ${n} | ${i} | cpuset='$(docker inspect -f '{{.HostConfig.CpusetCpus}}' "${n}")'"
	done
	echo "endorse_total (ProcessProposal, all peers) : $(endorse_total)"
	if command -v curl >/dev/null 2>&1; then
		AUTH=""
		[[ -n "${COUCH_USER:-}" ]] && AUTH="-u ${COUCH_USER}:${COUCH_PASS:-}"
		# shellcheck disable=SC2086
		rows=$(curl -s ${AUTH} "${COUCH_URL:-http://localhost:5984}/${COUCH_DB:-pharmachannel_pharmanet}/_all_docs?limit=0" 2>/dev/null | sed -n 's/.*"total_rows":\([0-9]*\).*/\1/p')
		echo "couchdb total_rows (${COUCH_DB:-pharmachannel_pharmanet}) : ${rows:-n/a}"
	fi
	if [[ -n "${CONFIGTX:-}" && -f "${CONFIGTX}" ]]; then
		echo "configtx batch settings:"
		grep -E -A6 'BatchTimeout|BatchSize' "${CONFIGTX}" | sed 's/^/   /'
	fi
} >> "${OUT}"

echo "snapshot '${LABEL}' appended to ${OUT}"
