#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${IMAGE:-smal}"
PORT="${PORT:-1112}"
DATA_DIR="${DATA_DIR:-$ROOT/data}"

mkdir -p "$DATA_DIR"

podman build -t "$IMAGE" -f "$ROOT/container/Containerfile" "$ROOT"

exec podman run --rm -d \
  --replace \
  --name smf \
  -p "${PORT}:3000" \
  -v "${DATA_DIR}:/app/data:Z" \
  -e PORT=3000 \
  "$IMAGE"
