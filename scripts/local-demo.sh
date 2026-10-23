#!/usr/bin/env bash
# Run the full ReGrow demo on this computer with a private test chain (no real or test-network money).
# Usage (Git Bash):  ./scripts/local-demo.sh          → open http://localhost:5173  (admin passcode: regrow-local)
#                    ./scripts/local-demo.sh --reset  → start from a fresh chain (forget all test transactions)
# Stop with Ctrl+C.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$HOME/.local/bin:$PATH"
ROOT=$(pwd)
STATE="$ROOT/backend/cache/anvil-state.json"

# anvil's public default test accounts (the same on every computer; never hold real funds)
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
RELAYER_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d # account 1: pays gas, holds no role
RELAYER_ADDR=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
STEWARD_ADDR=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
# oracle committee: accounts 4, 5, 6 with threshold 2. Keys 4 and 5 run on this server; 6 stays offline.
ORACLE_ADDRS=0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65,0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc,0x976EA74026E726554dB657fA54763abd0C3a0aa9
ORACLE_KEYS=0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a,0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba

mkdir -p backend/cache
if [[ "${1:-}" == "--reset" ]]; then
  rm -f "$STATE" backend/cache/events.json backend/cache/photo_hashes.json
  echo "Local chain reset."
fi

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT

FRESH=0
[[ -s "$STATE" ]] || FRESH=1
anvil --silent --port 8545 --state "$STATE" --state-interval 10 &
pids+=($!)
until cast block-number --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1; do sleep 0.5; done

if [[ $FRESH == 1 ]]; then
  echo "Deploying contracts and plots to the local chain..."
  (cd contracts && PRIVATE_KEY=$DEPLOYER_KEY ORACLE_ADDRESSES=$ORACLE_ADDRS ORACLE_THRESHOLD=2 \
    RELAYER_ADDRESS=$RELAYER_ADDR STEWARD_ADDRESS=$STEWARD_ADDR APP_URL=http://localhost:5173 \
    TIMELOCK_DELAY=60 MAX_PAUSE=120 forge script script/Deploy.s.sol \
    --rpc-url http://127.0.0.1:8545 --broadcast >/dev/null)
fi

(cd backend && RPC_URL=http://127.0.0.1:8545 CHAIN_ID=31337 ORACLE_PRIVATE_KEYS=$ORACLE_KEYS \
  RELAYER_PRIVATE_KEY=$RELAYER_KEY ADMIN_PASSCODE=regrow-local PYTHONUTF8=1 \
  uv run uvicorn regrow_api.main:app --port 8000 --log-level warning) &
pids+=($!)

echo
echo "  ReGrow local demo:  http://localhost:5173   (admin passcode: regrow-local)"
echo
cd app && VITE_CHAIN_ID=31337 VITE_RPC_URL=http://127.0.0.1:8545 pnpm dev --port 5173 --strictPort
