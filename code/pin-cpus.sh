#!/usr/bin/env bash
#
# Pin Caliper and the Fabric network to DISJOINT CPU sets (same VM, no interference).
#
#   ./pin-cpus.sh                 apply (docker update --cpuset-cpus on every running container)
#   ./pin-cpus.sh --check         verify only (exit 1 if anything is not pinned) ; --quiet = no table
#   ./pin-cpus.sh --sut 0-7 --caliper 8-11
#
# Default split: Caliper gets 1/3 of the vCPUs (12 vCPU -> cores 8-11), everything else (peers, orderers, CouchDB,
# chaincode containers, Prometheus, cAdvisor, ...) gets the rest (cores 0-7).

set -euo pipefail

CALIPER_NAME="${CALIPER_CONTAINER:-caliper}"
MODE=apply
QUIET=0
SUT=""
CAL=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--check) MODE=check; shift ;;
		--quiet) QUIET=1; shift ;;
		--sut) SUT="$2"; shift 2 ;;
		--caliper) CAL="$2"; shift 2 ;;
		--caliper-name) CALIPER_NAME="$2"; shift 2 ;;
		-h|--help) sed -n '2,16p' "$0"; exit 0 ;;
		*) echo "unknown argument: $1" >&2; exit 2 ;;
	esac
done

NPROC="${NPROC_OVERRIDE:-$(nproc)}"
if [[ -z "${CAL}" || -z "${SUT}" ]]; then
	ncal=$(( NPROC / 3 )); [[ ${ncal} -lt 2 ]] && ncal=2
	[[ -z "${CAL}" ]] && CAL="$(( NPROC - ncal ))-$(( NPROC - 1 ))"
	[[ -z "${SUT}" ]] && SUT="0-$(( NPROC - ncal - 1 ))"
fi

say() { [[ "${QUIET}" -eq 1 ]] || echo "$@"; }

ids=$(docker ps -q)
if [[ -z "${ids}" ]]; then
	echo "no running containers" >&2
	exit 1
fi

say "vCPUs=${NPROC}   Fabric/SUT cores=${SUT}   Caliper cores=${CAL}   (caliper container name: ${CALIPER_NAME})"
bad=0
found_caliper=0
for id in ${ids}; do
	read -r name have < <(docker inspect -f '{{.Name}} {{.HostConfig.CpusetCpus}}' "${id}" || echo "? ?")
	name="${name#/}"
	if [[ "${name}" == "${CALIPER_NAME}" ]]; then
		want="${CAL}"; found_caliper=1
	else
		want="${SUT}"
	fi
	if [[ "${MODE}" == "apply" && "${have}" != "${want}" ]]; then
		docker update --cpuset-cpus "${want}" "${id}" >/dev/null
		have="$(docker inspect -f '{{.HostConfig.CpusetCpus}}' "${id}")"
		say "  pinned ${name} -> ${have}"
	elif [[ "${have}" == "${want}" ]]; then
		say "  ok    ${name} -> ${have}"
	fi
	if [[ "${have}" != "${want}" ]]; then
		say "  WRONG ${name}: cpuset='${have}' expected '${want}'"
		bad=1
	fi
done

if [[ "${found_caliper}" -eq 0 ]]; then
	echo "container '${CALIPER_NAME}' is not running" >&2
	bad=1
fi

if [[ "${bad}" -eq 0 && "${QUIET}" -eq 0 ]]; then
	echo -n "caliper effective affinity: "
	docker exec "${CALIPER_NAME}" sh -c 'grep Cpus_allowed_list /proc/self/status' 2>/dev/null || echo "(could not read)"
fi

[[ "${bad}" -eq 0 ]] && say "CPU pinning: OK" || say "CPU pinning: NOT OK"
exit "${bad}"
