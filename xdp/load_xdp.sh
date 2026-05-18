#!/bin/bash

# =================================================================
#  SPARROWX - XDP Loader
#  Compiles and attaches the eBPF program.
# =================================================================

set -u

IFACE=$(ip -4 route show default 2>/dev/null | awk '{print $5}' | head -1)
if [ -z "$IFACE" ]; then
    IFACE=$(ip -6 route show default 2>/dev/null | awk '{print $5}' | head -1)
fi
OBJ="sparrowx_xdp.o"
SEC="xdp_prog"

cd "$(dirname "$0")"

if [ -z "$IFACE" ]; then
    echo "[x] Could not detect the default network interface."
    exit 1
fi

if ! command -v clang >/dev/null 2>&1; then
    echo "[x] clang is required to compile the XDP program."
    exit 1
fi

echo "[->] Compiling XDP program..."
rm -f "$OBJ"
clang -O2 -g -target bpf \
      -D__TARGET_ARCH_$(uname -m | sed 's/x86_64/x86/') \
      -I/usr/include/$(uname -m)-linux-gnu \
      -c sparrowx_xdp.c -o "$OBJ"

if [ ! -f "$OBJ" ]; then
    echo "[x] Compilation failed."
    exit 1
fi

echo "[->] Detaching old XDP program from $IFACE..."
ip link set dev "$IFACE" xdp off 2>/dev/null || true

echo "[->] Attaching XDP program to $IFACE..."
if ip link set dev "$IFACE" xdp obj "$OBJ" sec "$SEC"; then
    echo "[ok] XDP attached successfully."
    ip link show dev "$IFACE" | grep xdp || true
else
    echo "[x] Failed to attach XDP. Check kernel support with dmesg."
    exit 1
fi

# Optional persistent map pinning can be added after load verification.
