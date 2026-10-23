#!/usr/bin/env bash
# Install pinned Solidity dependencies into contracts/lib (not committed).
set -euo pipefail
cd "$(dirname "$0")"
forge install foundry-rs/forge-std@v1.17.0 OpenZeppelin/openzeppelin-contracts@v5.7.0 --no-git
