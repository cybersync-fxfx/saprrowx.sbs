#!/bin/bash
# Sparrowx XDP Engine Loader
# This script compiles and attaches the eBPF/XDP drop engine to the main network interface

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root"
  exit 1
fi

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo -e "\033[0;34m[Sparrowx XDP] Checking dependencies...\033[0m"
apt-get update -yqq
apt-get install -yqq clang llvm libbpf-dev linux-headers-generic linux-tools-common linux-tools-generic jq

# Determine the primary network interface facing the internet
IFACE=$(ip route | grep default | awk '{print $5}' | head -n 1)
if [ -z "$IFACE" ]; then
    echo "Could not detect default interface."
    exit 1
fi

echo -e "\033[0;34m[Sparrowx XDP] Compiling XDP Engine for $IFACE...\033[0m"
clang -O2 -g -Wall -target bpf -I/usr/include/$(uname -m)-linux-gnu -c sparrowx_xdp.c -o sparrowx_xdp.o

if [ ! -f "sparrowx_xdp.o" ]; then
    echo -e "\033[0;31m[!] Compilation failed.\033[0m"
    exit 1
fi

echo -e "\033[0;34m[Sparrowx XDP] Unloading existing XDP (if any)...\033[0m"
ip link set dev $IFACE xdp off 2>/dev/null

if ! mount | grep -q "/sys/fs/bpf"; then
    mount -t bpf bpf /sys/fs/bpf/
fi

echo -e "\033[0;34m[Sparrowx XDP] Attaching Engine...\033[0m"
ip link set dev $IFACE xdp obj sparrowx_xdp.o sec xdp_sparrowx

# Extract Map ID and pin it to the filesystem for Node.js/Radar Scanner interaction
PROG_ID=$(ip -j link show dev $IFACE | jq -r '.[0].xdp.prog.id')
if [ "$PROG_ID" == "null" ] || [ -z "$PROG_ID" ]; then
    echo -e "\033[0;31m[!] Failed to attach XDP.\033[0m"
    exit 1
fi

MAP_ID=$(bpftool prog show id $PROG_ID -j | jq -r '.map_ids[0]')
rm -f /sys/fs/bpf/sparrowx_blacklist
bpftool map pin id $MAP_ID /sys/fs/bpf/sparrowx_blacklist

echo -e "\033[0;32m============================================\033[0m"
echo -e "\033[0;32m  Sparrowx XDP Engine Active!               \033[0m"
echo -e "\033[0;32m  - Attached to: $IFACE                     \033[0m"
echo -e "\033[0;32m  - Map Pinned: /sys/fs/bpf/sparrowx_blacklist \033[0m"
echo -e "\033[0;32m  - Status: Dropping banned IPs natively    \033[0m"
echo -e "\033[0;32m============================================\033[0m"
