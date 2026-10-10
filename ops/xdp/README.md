# Struct XDP UDP Prefilter

Linux-only eBPF/XDP program that drops obviously malformed legacy and Secure V2 UDP
datagrams before they reach the Node gateway.

## What it checks

- IPv4 UDP destined to the configured `UDP_PORT`
- Non-fragmented packets only
- UDP payload at most `MAX_FRAME_BYTES`
- Legacy first byte `2`, `3`, or `4` and at least 66 payload bytes
- Secure V2 generation bits `10` and at least 25 payload bytes

## What it does **not** do

- HMAC verification
- ChaCha20 decrypt / Poly1305
- Supabase lookups or schema layout validation
- Replay / nonce checks

Node (`tcp-server`) authenticates and parses frames; PostgreSQL atomically owns
durable replay and event identity. The prefilter does not enable Secure V2.

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

Match `UDP_PORT` / `MAX_FRAME_BYTES` with `tcp-server/.env`. Secure V2 additionally
uses `STRUCT_SECURE_V2_ENABLED` and `STRUCT_SECURE_V2_MAX_FRAME_BYTES` in Node;
the XDP maximum must accommodate both protocols.
