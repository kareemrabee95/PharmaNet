#!/usr/bin/env bash
#
#   nohup ./official-4-2.sh > official-4-2.log 2>&1 &
#   tail -f official-4-2.log
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# shellcheck disable=SC2086
./experiment.sh --matrix read --workers "4 2" --reps "1 2 3" ${EXP_FLAGS:-} -- --cap-per-worker 80 \
  --rates queryAllCompanies=10,20,30,40,50 --rates queryDrugUnits=1,2,3,5,7,10 \
  --tail queryAllCompanies=80,160,320 --tail queryDrugUnits=20,40,80,160,320

# shellcheck disable=SC2086
./experiment.sh --matrix write --workers "4 2" --reps "1 2 3" ${EXP_FLAGS:-} -- --cap-per-worker 80 \
  --rates createPO=10,40,80,100,120,160,320 \
  --rates addDrug=10,40,80,160,200,240,280,320 \
  --rates registerCompany=10,40,80,160,200,240,280,320

echo "ALL DONE (4 and 2 workers)"
