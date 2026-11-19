#!/usr/bin/env bash
#
# 
set -euo pipefail

NETWORK_DIR="${NETWORK_DIR:-$HOME/pharma/network}"
CALIPER_DIR="${NETWORK_DIR}/caliper"
PROM_DIR="${NETWORK_DIR}/prometheus-grafana"
IPFS_DIR="${NETWORK_DIR}/ipfs"
EXPLORER_DIR="${NETWORK_DIR}/explorer"     

dc() {
	if docker compose version >/dev/null 2>&1; then docker compose "$@"; else docker-compose "$@"; fi
}

echo "[reset] 1/5 stop caliper / prometheus-grafana / ipfs / explorer"
(cd "${CALIPER_DIR}" && dc down) || true
(cd "${PROM_DIR}"    && dc down) || true
(cd "${IPFS_DIR}"    && dc down) || true
[[ -d "${EXPLORER_DIR}" ]] && { (cd "${EXPLORER_DIR}" && dc down) || true; }

echo "[reset] 2/5 remove leftover chaincode containers (dev-peer*)"
docker ps -aq --filter "name=dev-peer" | xargs -r docker rm -f


raft_leader_elected() {
	local last
	last="$(docker logs orderer1.pharma-network.com 2>&1 | grep 'Raft leader changed' | tail -1 || true)"
	[[ "${last}" =~ -\>\ ([0-9]+) ]] && [[ "${BASH_REMATCH[1]}" -ne 0 ]]
}

wait_for_raft_leader() {
	local waited=0 limit="${1:-120}"
	until raft_leader_elected; do
		if [[ "${waited}" -ge "${limit}" ]]; then
			echo "[reset] WARNING: no Raft leader after ${limit}s (see: docker logs orderer1.pharma-network.com | tail)"
			return 1
		fi
		sleep 5; waited=$(( waited + 5 ))
	done
	echo "[reset] Raft leader elected (waited ${waited}s)"
}

bootstrap_network() {
	if ./fabricNetwork.sh restart <<< "y"; then
		return 0
	fi
	echo "[reset] bootstrap failed (usually: no Raft leader yet). Waiting for a leader and retrying the bootstrap only..."
	local i
	for i in 1 2 3; do
		wait_for_raft_leader 120 || true
		if ./fabricNetwork.sh retry <<< "y"; then
			echo "[reset] bootstrap succeeded on retry ${i}"
			return 0
		fi
		sleep 20
	done
	echo "[reset] retries failed - one more full restart"
	./fabricNetwork.sh restart <<< "y"
}

echo "[reset] 3/5 fabricNetwork.sh restart (down --volumes + up + bootstrap) ثم install للـchaincode"
cd "${NETWORK_DIR}"
bootstrap_network
./fabricNetwork.sh install <<< "y"

docker stop ipfs.pharma-network.com >/dev/null 2>&1 || true

echo "[reset] 4/5 start prometheus-grafana and caliper"
(cd "${PROM_DIR}"    && dc up -d)
(cd "${CALIPER_DIR}" && dc up -d)

echo "[reset] 5/5 settle"
sleep 30
docker ps --format '{{.Names}}' | sort
echo "[reset] done"
