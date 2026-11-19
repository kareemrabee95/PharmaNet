#!/usr/bin/env bash

# export COUCH_URL=http://localhost:5984 COUCH_DB=pharmachannel_pharmanet COUCH_USER=admin COUCH_PASS=adminpw
# export CONFIGTX=$HOME/pharma/network/configtx.yaml
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# shellcheck disable=SC2086
./experiment.sh --matrix read --workers 8 --reps "1 2 3" ${EXP_FLAGS:-} -- \
  --rates queryAllCompanies=10,20,30,40,50 --rates queryDrugUnits=1,2,3,5,7,10 \
  --tail queryAllCompanies=80,160,320 --tail queryDrugUnits=20,40,80,160,320

# shellcheck disable=SC2086
./experiment.sh --matrix write --workers 8 --reps "1 2 3" ${EXP_FLAGS:-} -- \
  --rates createPO=10,40,80,100,120,160,320 \
  --rates addDrug=10,40,80,160,200,240,280,320 \
  --rates registerCompany=10,40,80,160,200,240,280,320

echo "ALL DONE (8 workers)"
