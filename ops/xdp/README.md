# Struct XDP UDP Prefilter

Linux-only eBPF/XDP program that drops obviously malformed Protocol v2 UDP
datagrams before they reach the Node gateway.

## What it checks

- IPv4 UDP destined to the configured `UDP_PORT`
- Non-fragmented packets only
- UDP payload length between 66 bytes (minimum Protocol v2) and `MAX_FRAME_BYTES`
- First payload byte is protocol version `2`
- Schema byte is present (any `0..255`)

## What it does **not** do

- HMAC verification
- ChaCha20 decrypt / Poly1305
- Supabase lookups or schema layout validation
- Replay / nonce checks

Node (`tcp-server`) remains the source of truth for authentication and parsing.

## Requirements

- Linux host with XDP-capable NIC (or generic/skb mode in VMs)
- `clang`, `llvm`, `bpftool`, `iproute2`
- Root privileges to attach

**macOS cannot attach XDP.** Development on macOS can still edit/compile sources
in a Linux VM or CI job.

## Usage

```bash
cd ops/xdp
# edit config.env — set IFACE, UDP_PORT, MAX_FRAME_BYTES
sudo ./load.sh
sudo ./unload.sh
```

Match `UDP_PORT` / `MAX_FRAME_BYTES` with `tcp-server/.env`.
