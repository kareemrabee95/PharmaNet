#!/usr/bin/env bash
#
# One COMPLETE, valid measurement cycle  (or the whole matrix):
#
#   reset network + deploy chaincode  (hooks/reset.sh - yours)
#   -> setup-eda -> seed (8 workers) -> verify-seed (must pass) -> pin CPUs -> measure
#
#   ./experiment.sh --kind write --workers 8 --rep 1
#   ./experiment.sh --kind read  --workers 4 --rep 2 --variant asis
#   ./experiment.sh --matrix read  [--workers "8 4 2"] [--reps "1 2 3"] [--variant asis]
#   ./experiment.sh --kind sweep --workers 4 --rep 1
#   anything after "--" is forwarded to the measuring run-benchmarks.sh call, e.g.
#   ./experiment.sh --kind read -w 2 --rep 1 -- --cap-per-worker 80 --rates queryDrugUnits=2,5,10,20
#
# --interleave : order the matrix rep-first (rep1 of 8W,4W,2W, then rep2 ...) instead of worker-first
# --skip-reset : use the ledger as it is (only for debugging - results are NOT valid without a fresh seed)
# --dry-run    : print every step, execute nothing
#
set -euo pipefail
set -E
trap 'rc=$?; echo "[experiment] ERROR (exit ${rc}) at line ${LINENO}: ${BASH_COMMAND}" >&2' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

KIND=""; MATRIX=""; WORKERS_ARG=""; REPS_ARG=""; REP=1; VARIANT=""; SKIP_RESET=0; DRY=0; INTERLEAVE=0; FORWARD=()

while [[ $# -gt 0 ]]; do
	case "$1" in
		--kind)        KIND="$2"; shift 2 ;;
		--matrix)      MATRIX="$2"; shift 2 ;;
		-w|--workers)  WORKERS_ARG="$2"; shift 2 ;;
		--reps)        REPS_ARG="$2"; shift 2 ;;
		--rep)         REP="$2"; shift 2 ;;
		--variant)     VARIANT="$2"; shift 2 ;;
		--skip-reset)  SKIP_RESET=1; shift ;;
		--dry-run)     DRY=1; shift ;;
		--interleave)  INTERLEAVE=1; shift ;;
		-h|--help)     sed -n '2,24p' "$0"; exit 0 ;;
		--)            shift; FORWARD=("$@"); break ;;
		*) echo "unknown argument: $1" >&2; exit 2 ;;
	esac
done

step() { echo; echo "######## $*"; }
do_cmd() { if [[ "${DRY}" -eq 1 ]]; then echo "+ $*"; else "$@"; fi; }

bench_of() {
	case "$1" in
		read) echo stress-read ;; write) echo stress-write ;; sweep) echo model-sweep ;;
		*) echo "kind must be read|write|sweep" >&2; exit 2 ;;
	esac
}

check_empty_ledger() {
	if [[ -z "${COUCH_URL:-}" ]]; then
		echo "(COUCH_URL not set: cannot verify that the ledger is empty. Set COUCH_URL / COUCH_DB (and COUCH_USER / COUCH_PASS) to enable this check)"
		return 0
	fi
	local auth=""; [[ -n "${COUCH_USER:-}" ]] && auth="-u ${COUCH_USER}:${COUCH_PASS:-}"
	local rows
	# shellcheck disable=SC2086
	rows="$(curl -s -m 15 ${auth} "${COUCH_URL}/${COUCH_DB:-pharmachannel_pharmanet}/_all_docs?limit=0" 2>/dev/null | sed -n 's/.*"total_rows":\([0-9]*\).*/\1/p' || true)"
	if [[ -z "${rows}" ]]; then
		echo "(CouchDB at ${COUCH_URL} gave no answer or the database does not exist yet - the empty-ledger check is SKIPPED."
		echo " Check COUCH_URL / COUCH_DB / COUCH_USER / COUCH_PASS:  curl -s -u user:pass ${COUCH_URL}/_all_dbs )"
		return 0
	fi
	echo "CouchDB documents right after reset: ${rows}"
	if [[ "${rows}" -gt 20 ]]; then
		echo "LEDGER IS NOT EMPTY after reset (${rows} documents): the volumes were not wiped. Fix the reset hook and retry." >&2
		exit 1
	fi
}

run_one() {
	local kind="$1" W="$2" rep="$3"
	local bench; bench="$(bench_of "${kind}")"
	local sfx="${VARIANT:+-${VARIANT}}"
	local base="${bench}-${W}w-rep${rep}${sfx}"           # name used by the measuring run (log/report/meta)
	local prep="prep-${kind}-${W}w-rep${rep}${sfx}"        # names of the setup/seed/verify logs
	local dry=(); [[ "${DRY}" -eq 1 ]] && dry=(--dry-run)

	echo "=============================================================="
	echo " ${base}"
	echo "=============================================================="

	step "1/7 reset network + deploy chaincode"
	if [[ "${SKIP_RESET}" -eq 1 ]]; then
		echo "(skipped)  -> results are NOT valid unless the ledger was fresh and seeded"
	elif [[ -x hooks/reset.sh ]]; then
		EXP_KIND="${kind}" EXP_WORKERS="${W}" EXP_REP="${rep}" do_cmd hooks/reset.sh
		if [[ "${DRY}" -eq 0 ]]; then
			for _ in $(seq 1 60); do docker ps --format '{{.Names}}' | grep -qx "${CALIPER_CONTAINER:-caliper}" && break; sleep 2; done
			check_empty_ledger
		fi
	else
		echo "hooks/reset.sh not found/executable. Copy hooks/reset.sh.example to hooks/reset.sh and fill in YOUR commands" >&2
		exit 1
	fi

	local pre=0 post=0

	step "2/7 setup-eda (RC/CoA)"
	do_cmd ./run-benchmarks.sh setup-eda --run-id "${prep}-setup" "${dry[@]}"

	step "3/7 seed (8 workers, identical dataset for every run)"
	[[ "${DRY}" -eq 0 ]] && pre="$(./snapshot.sh --endorse-total)"
	do_cmd ./run-benchmarks.sh seed --run-id "${prep}-seed" "${dry[@]}"
	[[ "${DRY}" -eq 0 ]] && post="$(./snapshot.sh --endorse-total)"      # before verify-seed: its reads must not be counted

	step "4/7 verify-seed"
	do_cmd ./run-benchmarks.sh verify-seed --run-id "${prep}-verify" "${dry[@]}"
	if [[ "${DRY}" -eq 0 ]]; then
		local po; po="$(sed -n 's/.*PO_GTIN_COUNT: *\([0-9]*\),.*/\1/p' caliper-benchmarks-local/benchmarks/scenario/simple/kareem/mainConfig.js)"
		python3 aggregate.py check-seed "reports/${prep}-seed.log" "reports/${prep}-verify.log" --setup "reports/${prep}-setup.log" --po "${po}" \
			|| { echo "seed check FAILED - aborting this run (reset and retry)"; exit 1; }
		local writes=$(( 2000 + 4000 ))     # seed only: 2000 registerCompany (EDA identity) + 4000 addDrug (manufacturer identity)
		echo "endorsements (ProcessProposal on all peers) during the seed: $(( post - pre )) for ${writes} write tx -> $(awk -v a=$(( post - pre )) -v b=${writes} 'BEGIN{printf "%.2f", a/b}') per write tx (average of the two identities)" \
			| tee -a "reports/${base}.meta.txt"
	fi

	step "5/7 pin CPUs (Caliper vs Fabric) - all chaincode containers exist now"
	do_cmd ./pin-cpus.sh
	do_cmd ./pin-cpus.sh --check --quiet
	do_cmd ./snapshot.sh "${base}" "before-measurement"

	step "6/7 measure: ${bench}"
	do_cmd ./run-benchmarks.sh "${bench}" -w "${W}" --rep "${rep}" ${VARIANT:+--variant "${VARIANT}"} "${dry[@]}" "${FORWARD[@]}"

	step "7/7 post-run snapshot"
	do_cmd ./snapshot.sh "${base}" "after-measurement"
	echo "done: reports/${base}.log"
}

if [[ -n "${MATRIX}" ]]; then
	KIND="${MATRIX}"
	WLIST="${WORKERS_ARG:-8 4 2}"
	[[ "${KIND}" == "sweep" ]] && WLIST="${WORKERS_ARG:-4}"
	RLIST="${REPS_ARG:-1 2 3}"
	if [[ "${INTERLEAVE}" -eq 1 ]]; then
		# repetition outermost: rep1 of every worker count, then rep2, ... (slow VM drift can't line up with one worker setting)
		for r in ${RLIST}; do for w in ${WLIST}; do run_one "${KIND}" "${w}" "${r}"; done; done
	else
		# default: all repetitions of one worker count, then the next worker count (8W: rep1 rep2 rep3, then 4W ...)
		for w in ${WLIST}; do for r in ${RLIST}; do run_one "${KIND}" "${w}" "${r}"; done; done
	fi
else
	[[ -n "${KIND}" ]] || { sed -n '2,24p' "$0"; exit 1; }
	run_one "${KIND}" "${WORKERS_ARG:-8}" "${REP}"
fi
