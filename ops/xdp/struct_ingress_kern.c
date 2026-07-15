/*
 * Struct Protocol v2 UDP ingress prefilter (XDP).
 *
 * Coarse admission control only — keeps obviously malformed datagrams away
 * from the Node gateway. This program does NOT:
 *   - verify HMAC-SHA256
 *   - decrypt ChaCha20 payloads
 *   - query Supabase / schemas
 *   - validate schema layouts beyond the schema version byte range
 *
 * Build (Linux):
 *   clang -O2 -g -target bpf -c struct_ingress_kern.c -o struct_ingress_kern.o
 *
 * Defaults (override via bpftool / rewrite before compile if needed):
 *   UDP_PORT = 8081, MAX_FRAME_BYTES = 1400
 */
#include <linux/bpf.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <linux/udp.h>
#include <linux/in.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_endian.h>

#ifndef STRUCT_UDP_PORT
#define STRUCT_UDP_PORT 8081
#endif

#ifndef STRUCT_MAX_FRAME_BYTES
#define STRUCT_MAX_FRAME_BYTES 1400
#endif

/* Protocol v2 minimum: proto + key_id + schema + ts + nonce + hmac = 66 */
#define STRUCT_V2_MIN_LEN 66
#define STRUCT_PROTOCOL_V2 2

char LICENSE[] SEC("license") = "Dual BSD/GPL";

static __always_inline int parse_ipv4_udp(void *data, void *data_end,
                                          struct ethhdr **eth_out,
                                          struct iphdr **ip_out,
                                          struct udphdr **udp_out,
                                          void **payload_out,
                                          __u16 *payload_len_out)
{
  struct ethhdr *eth = data;
  if ((void *)(eth + 1) > data_end)
    return -1;

  if (eth->h_proto != bpf_htons(ETH_P_IP))
    return 1; /* not IPv4 — pass */

  struct iphdr *ip = (void *)(eth + 1);
  if ((void *)(ip + 1) > data_end)
    return -1;

  if (ip->protocol != IPPROTO_UDP)
    return 1; /* not UDP — pass */

  /* Drop IPv4 fragments — we require a complete datagram. */
  __u16 frag_off = bpf_ntohs(ip->frag_off);
  if (frag_off & 0x3FFF)
    return -1;

  __u32 ihl = ip->ihl * 4;
  if (ihl < sizeof(*ip))
    return -1;

  struct udphdr *udp = (void *)ip + ihl;
  if ((void *)(udp + 1) > data_end)
    return -1;

  __u16 udp_len = bpf_ntohs(udp->len);
  if (udp_len < sizeof(*udp))
    return -1;

  void *payload = (void *)(udp + 1);
  __u16 payload_len = udp_len - sizeof(*udp);

  if (payload + payload_len > data_end)
    return -1;

  *eth_out = eth;
  *ip_out = ip;
  *udp_out = udp;
  *payload_out = payload;
  *payload_len_out = payload_len;
  return 0;
}

SEC("xdp")
int struct_ingress(struct xdp_md *ctx)
{
  void *data = (void *)(long)ctx->data;
  void *data_end = (void *)(long)ctx->data_end;

  struct ethhdr *eth;
  struct iphdr *ip;
  struct udphdr *udp;
  void *payload;
  __u16 payload_len;

  int rc = parse_ipv4_udp(data, data_end, &eth, &ip, &udp, &payload, &payload_len);
  if (rc < 0)
    return XDP_DROP;
  if (rc > 0)
    return XDP_PASS;

  /* Only filter our configured UDP destination port. */
  if (udp->dest != bpf_htons(STRUCT_UDP_PORT))
    return XDP_PASS;

  if (payload_len < STRUCT_V2_MIN_LEN)
    return XDP_DROP;

  if (payload_len > STRUCT_MAX_FRAME_BYTES)
    return XDP_DROP;

  /* Need at least protocol + key_id + schema before further Node validation. */
  if (payload + 18 > data_end)
    return XDP_DROP;

  __u8 *bytes = payload;
  if (bytes[0] != STRUCT_PROTOCOL_V2)
    return XDP_DROP;

  /* Schema byte exists at offset 17 (after protocol + 16B key_id); any 0..255 is allowed. */
  __u8 schema = bytes[17];
  (void)schema;

  return XDP_PASS;
}
