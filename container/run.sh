#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-smal}"
PORT="${PORT:-1112}"
DATA_DIR="${DATA_DIR:-$ROOT/data}"
NETWORK="giorgio-smal"

mkdir -p "$DATA_DIR"

if ! podman network exists "$NETWORK"; then
  podman network create "$NETWORK" >/dev/null
fi

DNS_ENABLED="$(podman network inspect --format '{{.DNSEnabled}}' "$NETWORK")"
if [[ "$DNS_ENABLED" != "true" ]]; then
  echo "Podman network must have DNS enabled: $NETWORK" >&2
  exit 1
fi

podman build -t "$IMAGE" -f "$ROOT/container/Containerfile" "$ROOT"

exec podman run --rm -d \
  --replace \
  --name smf \
  --network "$NETWORK" \
  --network-alias smal \
  -p "${PORT}:3000" \
  -v "${DATA_DIR}:/app/data:Z" \
  -e PORT=3000 \
  "$IMAGE"
