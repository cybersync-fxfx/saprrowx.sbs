#!/bin/bash
# Sparrowx Daily Attack Log Analyzer
# Parses automated threat signatures natively at standard run levels.

LOG_FILE="/var/log/sbs/attacks.log"
TARGET_DATE="${1:-$(date +%Y-%m-%d)}"

if [ ! -f "$LOG_FILE" ]; then
  echo "Log file not found: $LOG_FILE"
  exit 1
fi

echo "================================================================="
echo "  SPARROWX ATTACK LOG ANALYSIS FOR: $TARGET_DATE"
echo "================================================================="
echo ""

# Extract today's logs
TODAY_LOGS=$(grep "$TARGET_DATE" "$LOG_FILE" || true)

if [ -z "$TODAY_LOGS" ]; then
  echo "No security events recorded on this date."
  exit 0
fi

# 1. Overall Stats
TOTAL_EVENTS=$(echo "$TODAY_LOGS" | wc -l)
AUTO_BANS=$(echo "$TODAY_LOGS" | grep -c "\[auto-ban\]" || true)
MANUAL_BANS=$(echo "$TODAY_LOGS" | grep -c "\[manual-ban\]" || true)

echo "Summary Statistics:"
echo "  - Total Security Events: $TOTAL_EVENTS"
echo "  - Automated Defenses Triggered: $AUTO_BANS"
echo "  - Manual Interventions: $MANUAL_BANS"
echo ""

# 2. Top Attacking IPs
echo "Top 5 Offending IP Addresses:"
echo "$TODAY_LOGS" | grep -oE "\b([0-9]{1,3}\.){3}[0-9]{1,3}\b" | sort | uniq -c | sort -nr | head -n 5 | awk '{print "  - "$2" ("$1" events)"}'
echo ""

# 3. Top Attack Vectors / Reasons
echo "Top Attack Vectors (Reasons):"
echo "$TODAY_LOGS" | grep -oP "(?:Threat Radar: |auto-ban\] |manual-ban\] )\K[^|]+" | sort | uniq -c | sort -nr | head -n 5 | awk '{print "  - "$2" ("$1" hits)"}'
echo ""

# 4. Hourly Timeline (UTC)
echo "Hourly Distribution of Attacks:"
for hour in $(seq -w 0 23); do
  COUNT=$(echo "$TODAY_LOGS" | grep -c "\[$TARGET_DATE"T"$hour:" || true)
  if [ "$COUNT" -gt 0 ]; then
    BAR=""
    BAR_COUNT=$(( COUNT > 50 ? 50 : COUNT ))
    for ((i=0; i<BAR_COUNT; i++)); do BAR="${BAR}#"; done
    if [ "$COUNT" -gt 50 ]; then BAR="${BAR}+"; fi
    echo -e "  $hour:00 UTC | $COUNT events \t$BAR"
  fi
done

echo ""
echo "================================================================="
