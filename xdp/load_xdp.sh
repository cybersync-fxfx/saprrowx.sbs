#!/bin/bash

# =================================================================
#  SPARROWX — XDP Loader
#  Compiles & Attaches the eBPF Program
# =================================================================

IFACE=$(ip route | grep default | awk '{print $5}' | head -1)
OBJ="sparrowx_xdp.o"
SEC="xdp_prog"

# Ensure we are in the right dir
cd "$(dirname "$0")"

# 1. Compile
echo "[→] Compiling XDP program..."
clang -O2 -target bpf -c sparrowx_xdp.c -o $OBJ

if [ ! -f "$OBJ" ]; then
    echo "[✗] Compilation failed!"
    exit 1
fi

# 2. Detach old (if any)
echo "[→] Detaching old XDP program from $IFACE..."
ip link set dev $IFACE xdp off 2>/dev/null

# 3. Attach new
echo "[→] Attaching XDP program to $IFACE..."
ip link set dev $IFACE xdp obj $OBJ sec $SEC

if [ $? -eq 0 ]; then
    echo "[✓] XDP attached successfully!"
    ip link show dev $IFACE | grep xdp
else
    echo "[✗] Failed to attach XDP. Check kernel support (dmesg)."
fi

# 4. Pin map (optional, for persistent access)
# bpftool map pin name sparrowx_blacklist /sys/fs/bpf/sparrowx_blacklist
