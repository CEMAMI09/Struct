#!/usr/bin/env bash
# Attach Struct XDP UDP prefilter (Linux only).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${ROOT}/config.env"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "XDP attach is Linux-only. macOS/Windows cannot load this program." >&2
  exit 1
fi

if [[ -z "${IFACE:-}" ]]; then
  echo "IFACE is required in config.env" >&2
  exit 1
fi

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing dependency: $1" >&2
    exit 1
  }
}

need clang
need bpftool
need ip

UDP_PORT="${UDP_PORT:-8081}"
MAX_FRAME_BYTES="${MAX_FRAME_BYTES:-1400}"
OBJ="${ROOT}/${OBJ:-struct_ingress_kern.o}"
XDP_MODE="${XDP_MODE:-skb}"

echo "[xdp] compiling UDP_PORT=${UDP_PORT} MAX_FRAME_BYTES=${MAX_FRAME_BYTES}"
clang -O2 -g -Wall -target bpf \
  -DSTRUCT_UDP_PORT="${UDP_PORT}" \
  -DSTRUCT_MAX_FRAME_BYTES="${MAX_FRAME_BYTES}" \
  -c "${ROOT}/struct_ingress_kern.c" \
  -o "${OBJ}"

MODE_FLAG="--skb-mode"
if [[ "${XDP_MODE}" == "native" ]]; then
  MODE_FLAG=""
fi

echo "[xdp] attaching ${OBJ} to ${IFACE} (${XDP_MODE})"
# Prefer bpftool; fall back to ip link
if bpftool prog load "${OBJ}" /sys/fs/bpf/struct_ingress type xdp >/dev/null 2>&1; then
  bpftool net attach xdp pinned /sys/fs/bpf/struct_ingress dev "${IFACE}" ${MODE_FLAG} || \
    ip link set dev "${IFACE}" xdpobj "${OBJ}" "${XDP_MODE}"
else
  ip link set dev "${IFACE}" xdpobj "${OBJ}" "${XDP_MODE}"
fi

echo "[xdp] loaded on ${IFACE}. Reminder: HMAC/auth still runs in Node."
