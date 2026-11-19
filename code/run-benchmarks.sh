#!/usr/bin/env bash
#
# Run ONE Hyperledger Caliper benchmark inside the Docker container.
# YAML files are generated (gen-yaml.py) - nothing to edit by hand.
#
#   ./run-benchmarks.sh setup-eda                       (1 worker, always)
#   ./run-benchmarks.sh seed                            (8 workers, always)
#   ./run-benchmarks.sh verify-seed                     (8 workers, always)
#   ./run-benchmarks.sh stress-read  -w 8 --rep 1
#   ./run-benchmarks.sh stress-write -w 8 --rep 1
#   ./run-benchmarks.sh model-sweep  -w 4
#   ./run-benchmarks.sh list
#
# For the full, correct cycle (reset -> seed -> verify -> pin CPUs -> measure) use ./experiment.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CALIPER_DIR="${SCRIPT_DIR}"
WORKSPACE_HOST="${CALIPER_DIR}/caliper-benchmarks-local"
WORKSPACE_CONTAINER="/hyperledger/caliper/workspace"
BENCH_REL="benchmarks/scenario/simple/kareem"
NETWORK_REL="networks/fabric/kareem/network-config.yaml"
GENERATED_REL="${BENCH_REL}/generated"
REPORTS_DIR="${CALIPER_DIR}/reports"

CONTAINER_NAME="${CALIPER_CONTAINER:-caliper}"
WORKERS="${WORKERS:-8}"
REP=1
RUN_ID=""
VARIANT=""
USE_COMPOSE_RUN=0
DRY_RUN=0
PIN_CHECK=1
GEN_EXTRA=()

BENCHES="setup-eda seed verify-seed probe probe-eda probe-man probe-dist stress-read stress-write model-sweep"
declare -A FIXED_WORKERS=( [setup-eda]=1 [seed]=8 [verify-seed]=8 [probe]=1 [probe-eda]=1 [probe-man]=1 [probe-dist]=1 )

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
log_info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

usage() {
	cat <<'EOF'
Usage: ./run-benchmarks.sh <benchmark> [options]

Benchmarks
  setup-eda     RC/CoA for the 6 drugs + RC for the createPO key-space GTINs      (1 worker, fixed)
  seed          2000 companies + 4000 pouches - identical dataset for every run    (8 workers, fixed)
  verify-seed   reads every seeded pouch once; Fail must be 0                      (8 workers, fixed)
  probe         4 short rounds (EDA/manufacturer/consumer, submit+evaluate) - checks every peer in the connection profiles (1 worker)
  stress-read   warm-up, viewDrugCurrentState / queryAllCompanies / queryDrugUnits, drift check
  stress-write  warm-up, createPO / registerCompany / addDrug (order rotates with --rep)
  model-sweep   latency vs N (companies) and P (pouches) at low load - complexity-model fit
  list          show benchmarks

Options
  -w, --workers N        workers for stress-* / model-sweep (default 8)
      --rep R            repetition number, 1..3 (rotates the write-function order)
      --run-id ID        base name of yaml/log/report (default <bench>-<W>w-rep<R>)
      --variant NAME     suffix for the run id (e.g. asis, opt)
      --rates F=a,b,c    override the rate grid of one function (repeatable)
      --cap-per-worker N drop rates above N TPS per worker (e.g. 80 saves time at 2W/4W)
      --tail F=a,b,c     (stress-read) overload rates of one function, appended at the END of the same run (repeatable)
      --only F[,F]       run only these functions (pilot refinement), e.g. queryDrugUnits,queryAllCompanies
  -c, --container NAME   caliper container (default: caliper)
      --compose-run      use "docker compose run" instead of "docker exec"
      --no-pin-check     do not require pin-cpus.sh --check to pass for stress-* / model-sweep
      --dry-run          print what would run, execute nothing
  -h, --help

Outputs (host):  reports/<run-id>.log   reports/<run-id>.html   caliper-benchmarks-local/.../generated/<run-id>.yaml
EOF
}

run() {            # run a command, or just print it in --dry-run mode
	if [[ "${DRY_RUN}" -eq 1 ]]; then
		echo "+ $*"
	else
		"$@"
	fi
}

require_container() {
	if [[ "${DRY_RUN}" -eq 1 ]]; then return 0; fi
	if docker ps --format '{{.Names}}' | grep -qx "${CONTAINER_NAME}"; then
		return 0
	fi
	log_error "Container '${CONTAINER_NAME}' is not running."
	log_error "  docker compose down && docker compose up -d && docker ps --filter name=${CONTAINER_NAME}"
	exit 1
}

list_benchmarks() {
	echo "Available benchmarks:"
	for b in ${BENCHES}; do
		printf "  %-13s %s\n" "${b}" "${FIXED_WORKERS[${b}]+(fixed workers=${FIXED_WORKERS[${b}]})}"
	done
	echo
	echo "Cycle: reset -> setup-eda -> seed -> verify-seed -> pin-cpus -> stress-read | stress-write  (see experiment.sh)"
}

# ------------------------------------------------------------------ args
BENCHMARK=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		-w|--workers)        WORKERS="$2"; shift 2 ;;
		--rep)               REP="$2"; shift 2 ;;
		--run-id)            RUN_ID="$2"; shift 2 ;;
		--variant)           VARIANT="$2"; shift 2 ;;
		--rates)             GEN_EXTRA+=(--rates "$2"); shift 2 ;;
		--cap-per-worker)    GEN_EXTRA+=(--cap-per-worker "$2"); shift 2 ;;
		--only)              GEN_EXTRA+=(--only "$2"); shift 2 ;;
		--tail)              GEN_EXTRA+=(--tail "$2"); shift 2 ;;
		-c|--container)      CONTAINER_NAME="$2"; shift 2 ;;
		--compose-run)       USE_COMPOSE_RUN=1; shift ;;
		--no-pin-check)      PIN_CHECK=0; shift ;;
		--dry-run)           DRY_RUN=1; shift ;;
		-h|--help)           usage; exit 0 ;;
		list)                list_benchmarks; exit 0 ;;
		setup-eda|seed|verify-seed|probe|probe-eda|probe-man|probe-dist|stress-read|stress-write|model-sweep) BENCHMARK="$1"; shift ;;
		*) log_error "Unknown argument: $1"; usage; exit 1 ;;
	esac
done

[[ -n "${BENCHMARK}" ]] || { usage; exit 1; }
[[ "${WORKERS}" =~ ^[0-9]+$ && "${WORKERS}" -ge 1 ]] || { log_error "workers must be a positive integer (got ${WORKERS})"; exit 1; }
[[ "${REP}" =~ ^[0-9]+$ && "${REP}" -ge 1 ]] || { log_error "--rep must be a positive integer"; exit 1; }
command -v python3 >/dev/null || { log_error "python3 is required (gen-yaml.py)"; exit 1; }

if [[ -n "${FIXED_WORKERS[${BENCHMARK}]+x}" ]]; then
	if [[ "${WORKERS}" != "${FIXED_WORKERS[${BENCHMARK}]}" ]]; then
		log_info "${BENCHMARK} always runs with ${FIXED_WORKERS[${BENCHMARK}]} worker(s) (dataset must not depend on -w)"
	fi
	WORKERS="${FIXED_WORKERS[${BENCHMARK}]}"
fi

if [[ -z "${RUN_ID}" ]]; then
	RUN_ID="${BENCHMARK}-${WORKERS}w-rep${REP}"
fi
[[ -n "${VARIANT}" ]] && RUN_ID="${RUN_ID}-${VARIANT}"

BENCH_FILE_REL="${GENERATED_REL}/${RUN_ID}.yaml"
YAML_HOST="${WORKSPACE_HOST}/${BENCH_FILE_REL}"
YAML_CONTAINER="${WORKSPACE_CONTAINER}/${BENCH_FILE_REL}"
LOG_FILE="${REPORTS_DIR}/${RUN_ID}.log"
REPORT_FILE="${REPORTS_DIR}/${RUN_ID}.html"
REPORT_CONTAINER="/hyperledger/caliper/reports/${RUN_ID}.html"

mkdir -p "${WORKSPACE_HOST}/${GENERATED_REL}" "${REPORTS_DIR}"

log_info "Benchmark : ${BENCHMARK}"
log_info "Workers   : ${WORKERS}   rep=${REP}"
log_info "Run id    : ${RUN_ID}"

# ------------------------------------------------------------------ generate yaml
python3 "${CALIPER_DIR}/gen-yaml.py" "${BENCHMARK}" -w "${WORKERS}" --rep "${REP}" "${GEN_EXTRA[@]}" -o "${YAML_HOST}"
log_info "YAML      : ${YAML_HOST}"

# ------------------------------------------------------------------ pre-flight
case "${BENCHMARK}" in
	stress-read|stress-write|model-sweep)
		if [[ "${PIN_CHECK}" -eq 1 && "${DRY_RUN}" -eq 0 ]]; then
			if ! "${CALIPER_DIR}/pin-cpus.sh" --check --quiet; then
				log_error "CPU pinning is not applied (Caliper and the Fabric containers share cores) -> the load generator"
				log_error "can starve the peers. Run ./pin-cpus.sh first (after the seed, when all chaincode containers exist),"
				log_error "or pass --no-pin-check if you really want to skip it."
				exit 1
			fi
		fi
		;;
esac

require_container
if [[ "${USE_COMPOSE_RUN}" -eq 0 ]]; then
	run docker exec "${CONTAINER_NAME}" mkdir -p "$(dirname "${YAML_CONTAINER}")"
	if [[ "${DRY_RUN}" -eq 1 ]]; then
		echo "+ docker exec -i ${CONTAINER_NAME} tee ${YAML_CONTAINER} < ${YAML_HOST}"
	else
		docker exec -i "${CONTAINER_NAME}" tee "${YAML_CONTAINER}" > /dev/null < "${YAML_HOST}"
		docker exec "${CONTAINER_NAME}" test -f "${YAML_CONTAINER}" || { log_error "yaml not copied into the container"; exit 1; }
	fi
fi

# ------------------------------------------------------------------ run caliper
caliper_cmd=(
	caliper launch manager
	--caliper-workspace "${WORKSPACE_CONTAINER}"
	--caliper-benchconfig "${BENCH_FILE_REL}"
	--caliper-networkconfig "${NETWORK_REL}"
	--caliper-report-path "${REPORT_CONTAINER}"
)

log_info "Log       : ${LOG_FILE}"
log_info "Report    : ${REPORT_FILE}"

if [[ "${DRY_RUN}" -eq 1 ]]; then
	echo "+ docker exec ${CONTAINER_NAME} ${caliper_cmd[*]} 2>&1 | tee ${LOG_FILE}"
	log_ok "dry-run finished (nothing executed)"
	exit 0
fi

# chaincode containers are created lazily on the first transaction of each peer: a container that appears
# in the middle of the run would be unpinned. While a measuring run is active, re-apply the pinning every 20 s.
REPIN_PID=""
case "${BENCHMARK}" in
	stress-read|stress-write|model-sweep)
		if [[ "${PIN_CHECK}" -eq 1 ]]; then
			( while true; do sleep 20; "${CALIPER_DIR}/pin-cpus.sh" --quiet >/dev/null 2>&1 || true; done ) &
			REPIN_PID=$!
			trap '[[ -n "${REPIN_PID}" ]] && kill "${REPIN_PID}" 2>/dev/null || true' EXIT
		fi
		;;
esac

RUN_START_EPOCH="$(date +%s)"
{
	echo "# run-id   : ${RUN_ID}"
	echo "# started  : $(date -Is)"
	echo "# command  : ${caliper_cmd[*]}"
} > "${LOG_FILE}"

if [[ "${USE_COMPOSE_RUN}" -eq 1 ]]; then
	( cd "${CALIPER_DIR}" && docker compose run --rm --entrypoint caliper caliper_2.2 "${caliper_cmd[@]:1}" ) 2>&1 | tee -a "${LOG_FILE}"
else
	docker exec "${CONTAINER_NAME}" "${caliper_cmd[@]}" 2>&1 | tee -a "${LOG_FILE}"
fi

echo "# finished : $(date -Is)" >> "${LOG_FILE}"

# did any container die during the run? (e.g. a Node chaincode killed by "JavaScript heap out of memory" = exit code 134)
EVENTS_FILE="${REPORTS_DIR}/${RUN_ID}.events.log"
timeout 30 docker events --since "${RUN_START_EPOCH}" --until "$(date +%s)" --filter type=container --filter event=die \
	--format '{{.Time}} {{.Actor.Attributes.name}} exitCode={{.Actor.Attributes.exitCode}}' > "${EVENTS_FILE}" 2>/dev/null || true
CRASHES="$(grep -c 'exitCode=[1-9]' "${EVENTS_FILE}" 2>/dev/null || true)"
echo "# container crashes during run: ${CRASHES:-0}" >> "${LOG_FILE}"
if [[ "${CRASHES:-0}" -gt 0 ]]; then
	log_warn "${CRASHES} container(s) crashed during this run (see ${EVENTS_FILE}):"
	grep 'exitCode=[1-9]' "${EVENTS_FILE}" | sed 's/^/        /'
fi
if [[ -n "${REPIN_PID}" ]]; then
	kill "${REPIN_PID}" 2>/dev/null || true; REPIN_PID=""
	if "${CALIPER_DIR}/pin-cpus.sh" --check --quiet; then
		echo "# pin-check after run: OK" >> "${LOG_FILE}"
	else
		echo "# pin-check after run: NOT OK (a container ran unpinned) - treat this run with caution" >> "${LOG_FILE}"
		log_warn "some container was not pinned at the end of the run"
	fi
fi
log_ok "Finished ${RUN_ID}"

if [[ -f "${REPORT_FILE}" ]]; then
	log_ok "Report saved: ${REPORT_FILE}"
else
	log_warn "HTML report not found at ${REPORT_FILE} (is ./reports mounted at /hyperledger/caliper/reports ?)"
fi

# quick look at failures (non-fatal)
python3 "${CALIPER_DIR}/aggregate.py" quick "${LOG_FILE}" || true
