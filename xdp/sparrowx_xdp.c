#include <linux/bpf.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <linux/in.h>
#include <bpf/bpf_helpers.h>

// Define the Sparrowx eBPF map for blacklisted IPs
// Key is __u32 (IPv4 address), Value is __u32 (banned status)
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1000000); // Support up to 1 million banned IPs instantly
    __type(key, __u32);
    __type(value, __u32);
} sparrowx_blacklist SEC(".maps");

SEC("xdp_sparrowx")
int xdp_prog_main(struct xdp_md *ctx) {
    void *data_end = (void *)(long)ctx->data_end;
    void *data = (void *)(long)ctx->data;

    // Parse Ethernet header
    struct ethhdr *eth = data;
    if ((void *)(eth + 1) > data_end) {
        return XDP_PASS;
    }

    // Only process IPv4 packets
    if (eth->h_proto != __constant_htons(ETH_P_IP)) {
        return XDP_PASS;
    }

    // Parse IPv4 header
    struct iphdr *iph = data + sizeof(struct ethhdr);
    if ((void *)(iph + 1) > data_end) {
        return XDP_PASS;
    }

    __u32 src_ip = iph->saddr;

    // Lookup IP in the Sparrowx blacklist map
    __u32 *banned = bpf_map_lookup_elem(&sparrowx_blacklist, &src_ip);
    if (banned) {
        // IP is in the blacklist, drop the packet instantly at the NIC!
        return XDP_DROP;
    }

    return XDP_PASS;
}

char _license[] SEC("license") = "GPL";
