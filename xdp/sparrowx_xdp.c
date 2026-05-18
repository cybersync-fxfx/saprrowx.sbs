#include <linux/bpf.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <linux/in.h>
#include <bpf/bpf_endian.h>
#include <bpf/bpf_helpers.h>

/* Map for blacklisted IPs */
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 100000);
    __type(key, __be32);
    __type(value, __u64); // timestamp or count
} sparrowx_blacklist SEC(".maps");

SEC("xdp_prog")
int xdp_sparrowx_filter(struct xdp_md *ctx) {
    void *data_end = (void *)(long)ctx->data_end;
    void *data = (void *)(long)ctx->data;

    struct ethhdr *eth = data;
    if ((void *)(eth + 1) > data_end)
        return XDP_PASS;

    if (eth->h_proto != bpf_htons(ETH_P_IP))
        return XDP_PASS;

    struct iphdr *iph = (void *)(eth + 1);
    if ((void *)(iph + 1) > data_end)
        return XDP_PASS;

    /* Check blacklist */
    __be32 src_ip = iph->saddr;
    __u64 *value = bpf_map_lookup_elem(&sparrowx_blacklist, &src_ip);
    if (value) {
        return XDP_DROP;
    }

    /* Basic Rate Limiting (Conceptual - simplified for this implementation) */
    /* In a full production version, we would implement a per-IP counter map here */

    return XDP_PASS;
}

char _license[] SEC("license") = "GPL";
