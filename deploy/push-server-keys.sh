#!/usr/bin/env bash
# Copies the oracle committee keys 1-2 and the relayer key from contracts/.env into the server's deploy/.env.
# Nothing is printed. Run from the repo root:  bash deploy/push-server-keys.sh user@host
set -euo pipefail
HOST="${1:?usage: bash deploy/push-server-keys.sh user@host}"
cd "$(dirname "$0")/.."
set -a; . contracts/.env; set +a

printf 'ORACLE_PRIVATE_KEYS=%s,%s\nRELAYER_PRIVATE_KEY=%s\n' "$ORACLE_1_KEY" "$ORACLE_2_KEY" "$RELAYER_KEY" |
  ssh "$HOST" 'set -e; cd /opt/docker/regrow/deploy; umask 077
    keys=$(cat)
    grep -v -e "^ORACLE_PRIVATE_KEYS=" -e "^RELAYER_PRIVATE_KEY=" .env > .env.new
    printf "%s\n" "$keys" >> .env.new
    mv .env.new .env
    echo "server keys set: $(grep -c "^ORACLE_PRIVATE_KEYS=0x" .env) oracle line, $(grep -c "^RELAYER_PRIVATE_KEY=0x" .env) relayer line"'
