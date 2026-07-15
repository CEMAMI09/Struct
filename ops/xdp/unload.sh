#!/usr/bin/env bash
# Detach Struct XDP UDP prefilter (Linux only).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${ROOT}/config.env"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "XDP unload is Linux-only." >&2
  exit 1
fi

IFACE="${IFACE:-eth0}"

echo "[xdp] detaching from ${IFACE}"
ip link set dev "${IFACE}" xdp off 2>/dev/null || true
rm -f /sys/fs/bpf/struct_ingress 2>/dev/null || true
echo "[xdp] unloaded"
