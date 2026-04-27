# Sparrowx Upgrade Roadmap

These are the highest-impact upgrades to make Sparrowx feel stronger, more trustworthy, and more production-grade for customers.

## 1. Packet Truth Layer

- Add a privileged agent collector using eBPF or `tcpdump -l -nn` parsing for real per-flow packet samples.
- Send source IP, destination IP, ports, protocol, bytes, packets, flags, direction, interface, and timestamp.
- Keep `/proc/net/dev` counters as the low-cost fallback.

## 2. Signed Agent Updates

- Sign agent bundles with an offline Ed25519 key.
- Have agents verify the signature before applying a self-update.
- Show update status and build signature status in the dashboard.

## 3. Clear Defense Modes

- Make `Normal`, `Strict`, and `Shield` full policy profiles with visible thresholds.
- Show exactly which mode is active on Threat Radar.
- Record every automatic mode change in the security log.

## 4. Fleet Controls

- Support multiple agents per account.
- Add per-agent labels, groups, environment tags, and policy assignment.
- Show fleet health, offline agents, outdated builds, tunnel state, and threat volume.

## 5. Audit And Access Control

- Add admin/operator/read-only roles.
- Require confirmation and audit records for terminal commands, bans, unbans, and policy changes.
- Add optional MFA before destructive commands.

## 6. IP Intelligence

- Enrich live IP rows with ASN, country, reverse DNS, reputation source, and first-seen/last-seen.
- Cache lookups locally to avoid slow dashboard updates.
- Add customer-safe allowlist recommendations.

## 7. Incident Timeline

- Build a single incident view that joins live packets, SSH/firewall logs, radar scores, bans, and tunnel health.
- Export a clean report for customers after an attack.

## 8. Safer Remote Terminal

- Add command allowlists and approval mode.
- Store command history with user, timestamp, exit code, and duration.
- Add session playback for terminal output.

## 9. Tunnel Reliability

- Add tunnel latency, handshake age, packet counters, MTU status, and route checks.
- Auto-repair bad tunnel service files and stale WireGuard interfaces.
- Display the exact repair action taken.

## 10. Professional Onboarding

- Add one-click fresh installer, update status, and copyable runbook.
- Make the first connected agent automatically verify firewall, nftables, WireGuard, packet capture, and telemetry.
- Show a final "protected and monitored" checklist only after all checks pass.
