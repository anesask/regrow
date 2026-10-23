#!/usr/bin/env bash
# Deploys ReGrow to Base Sepolia with the committee and relayer from contracts/.env.
# Run from the repo root:  bash contracts/deploy-base-sepolia.sh
# Writes the new addresses to backend/chain/addresses.json and app/src/lib/chain/addresses.json.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a

VERIFY=()
if [ -n "${ETHERSCAN_API_KEY:-}" ]; then VERIFY=(--verify --etherscan-api-key "$ETHERSCAN_API_KEY"); fi

ORACLE_ADDRESSES="$ORACLE_1_ADDRESS,$ORACLE_2_ADDRESS,$ORACLE_3_ADDRESS" \
ORACLE_THRESHOLD=2 \
RELAYER_ADDRESS="$RELAYER_ADDRESS" \
STEWARD_ADDRESS="$STEWARD_ADDRESS" \
APP_URL=https://regrow.living API_URL=https://regrow.living \
CHALLENGE_WINDOW=120 SEED_PLOTS=4 \
RELAYER_GAS_WEI=20000000000000000 \
"${FORGE:-$HOME/.foundry/bin/forge}" script script/Deploy.s.sol \
  --rpc-url https://sepolia.base.org --broadcast --slow "${VERIFY[@]}"
