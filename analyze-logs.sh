#!/bin/bash
# Sparrowx Daily Attack Log Analyzer
# Parses automated threat signatures, provides interactive replay, and AI insights.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STORAGE_ATTACK_DIR="$SCRIPT_DIR/storage/attack"
LIVE_LOG="/var/log/sbs/attacks.log"

# Ensure storage/attack directory exists
mkdir -p "$STORAGE_ATTACK_DIR"

run_analysis() {
  local LOG_FILE="$1"
  local TARGET_DATE="$2"
  
  if [ ! -f "$LOG_FILE" ]; then
    echo "Log file not found: $LOG_FILE"
    return 1
  fi

  echo "================================================================="
  echo "  SPARROWX ATTACK LOG ANALYSIS"
  echo "  FILE: $LOG_FILE"
  [ -n "$TARGET_DATE" ] && echo "  DATE FILTER: $TARGET_DATE"
  echo "================================================================="
  echo ""

  # Extract logs
  if [ -n "$TARGET_DATE" ]; then
    TODAY_LOGS=$(grep "$TARGET_DATE" "$LOG_FILE" || true)
  else
    TODAY_LOGS=$(cat "$LOG_FILE")
  fi

  if [ -z "$TODAY_LOGS" ]; then
    echo "No security events recorded."
    return 0
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
    if [ -n "$TARGET_DATE" ]; then
      COUNT=$(echo "$TODAY_LOGS" | grep -c "\[$TARGET_DATE"T"$hour:" || true)
    else
      COUNT=$(echo "$TODAY_LOGS" | grep -c -E "\[[0-9]{4}-[0-9]{2}-[0-9]{2}T$hour:" || true)
    fi
    
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
}

replay_traffic() {
  local LOG_FILE="$1"
  if [ ! -f "$LOG_FILE" ]; then
    echo "Log file not found: $LOG_FILE"
    return 1
  fi

  echo "================================================================="
  echo "  REPLAYING ATTACK TRAFFIC: $(basename "$LOG_FILE")"
  echo "  Press Ctrl+C to stop"
  echo "================================================================="
  echo ""

  echo "Select playback speed:"
  echo "1) Real-time simulation (capped at 2s delay)"
  echo "2) Fast playback (0.2s delay per event)"
  echo "3) Instant (no delay)"
  read -p "Choice [1-3, default 2]: " SPEED_CHOICE

  local DELAY=0
  local PARSE_TIME=false
  case $SPEED_CHOICE in
    1) PARSE_TIME=true ;;
    2) DELAY=0.2 ;;
    3) DELAY=0 ;;
    *) DELAY=0.2 ;;
  esac

  local PREV_TS=""
  
  echo ""
  echo "--- START OF REPLAY ---"
  
  while IFS= read -r line; do
    if [ "$PARSE_TIME" = true ]; then
      TS=$(echo "$line" | grep -oP "^\[\K[^\]]+")
      if [ -n "$TS" ] && [ -n "$PREV_TS" ]; then
        T1=$(date -d "$PREV_TS" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$PREV_TS" +%s 2>/dev/null)
        T2=$(date -d "$TS" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$TS" +%s 2>/dev/null)
        
        if [ -n "$T1" ] && [ -n "$T2" ]; then
          DIFF=$((T2 - T1))
          if [ $DIFF -gt 0 ]; then
            [ $DIFF -gt 2 ] && DIFF=2
            sleep $DIFF
          fi
        else
          sleep 0.5
        fi
      fi
      PREV_TS="$TS"
    elif [ "$(echo "$DELAY > 0" | bc 2>/dev/null)" = "1" ] || [ "$DELAY" != "0" ]; then
      sleep $DELAY
    fi
    
    echo "$line"
  done < "$LOG_FILE"
  
  echo "--- END OF REPLAY ---"
  echo ""
}

run_ai_analysis() {
  local LOG_FILE="$1"
  if [ ! -f "$LOG_FILE" ]; then
    echo "Log file not found: $LOG_FILE"
    return 1
  fi

  if ! command -v node &> /dev/null; then
    echo "Error: Node.js is required to run AI analysis."
    return 1
  fi

  node "$SCRIPT_DIR/ai-analyze.js" "$LOG_FILE"
}

show_menu() {
  while true; do
    echo "================================================================="
    echo "  SPARROWX ATTACK HISTORY, TRAFFIC & AI ANALYZER"
    echo "================================================================="
    echo "1) Analyze Live Logs ($LIVE_LOG)"
    echo "2) Analyze Historical Attack Log (from storage/attack/)"
    echo "3) Replay Attack Traffic Timeline (Simulation)"
    echo "4) AI Threat Intelligence Report (LLM Insights)"
    echo "5) Exit"
    echo "================================================================="
    read -p "Enter choice [1-5]: " CHOICE

    case $CHOICE in
      1)
        if [ ! -f "$LIVE_LOG" ]; then
          echo "Live log file not found at $LIVE_LOG"
          read -p "Press Enter to continue..."
          continue
        fi
        read -p "Enter target date (YYYY-MM-DD, default today): " T_DATE
        [ -z "$T_DATE" ] && T_DATE=$(date +%Y-%m-%d)
        run_analysis "$LIVE_LOG" "$T_DATE"
        ;;
      2)
        echo "Available Historical Logs:"
        FILES=("$STORAGE_ATTACK_DIR"/*)
        VALID_FILES=()
        for f in "${FILES[@]}"; do
          if [ -f "$f" ] && [[ "$(basename "$f")" != "README.md" ]]; then
            VALID_FILES+=("$f")
          fi
        done

        if [ ${#VALID_FILES[@]} -eq 0 ]; then
          echo "No historical logs found in $STORAGE_ATTACK_DIR"
          read -p "Press Enter to continue..."
          continue
        fi
        
        PS3="Select file to analyze: "
        select FILE in "${VALID_FILES[@]}"; do
          if [ -n "$FILE" ]; then
            read -p "Enter target date (YYYY-MM-DD, or leave empty for all): " T_DATE
            run_analysis "$FILE" "$T_DATE"
            break
          else
            echo "Invalid selection."
          fi
        done
        ;;
      3)
        echo "Select Log to Replay:"
        FILES=("$STORAGE_ATTACK_DIR"/*)
        VALID_FILES=()
        for f in "${FILES[@]}"; do
          if [ -f "$f" ] && [[ "$(basename "$f")" != "README.md" ]]; then
            VALID_FILES+=("$f")
          fi
        done

        if [ ${#VALID_FILES[@]} -eq 0 ]; then
          echo "No logs found in $STORAGE_ATTACK_DIR"
          read -p "Press Enter to continue..."
          continue
        fi
        
        PS3="Select file to replay: "
        select FILE in "${VALID_FILES[@]}"; do
          if [ -n "$FILE" ]; then
            replay_traffic "$FILE"
            break
          else
            echo "Invalid selection."
          fi
        done
        ;;
      4)
        echo "Select Log for AI Analysis:"
        echo "a) Live Log ($LIVE_LOG)"
        echo "b) Historical Log (from storage/attack/)"
        read -p "Choice [a/b]: " AI_FILE_CHOICE
        
        local FILE_TO_AI=""
        if [ "$AI_FILE_CHOICE" = "a" ]; then
          if [ ! -f "$LIVE_LOG" ]; then
            echo "Live log file not found at $LIVE_LOG"
            read -p "Press Enter to continue..."
            continue
          fi
          FILE_TO_AI="$LIVE_LOG"
        elif [ "$AI_FILE_CHOICE" = "b" ]; then
          FILES=("$STORAGE_ATTACK_DIR"/*)
          VALID_FILES=()
          for f in "${FILES[@]}"; do
            if [ -f "$f" ] && [[ "$(basename "$f")" != "README.md" ]]; then
              VALID_FILES+=("$f")
            fi
          done

          if [ ${#VALID_FILES[@]} -eq 0 ]; then
            echo "No logs found in $STORAGE_ATTACK_DIR"
            read -p "Press Enter to continue..."
            continue
          fi
          
          PS3="Select file for AI analysis: "
          select FILE in "${VALID_FILES[@]}"; do
            if [ -n "$FILE" ]; then
              FILE_TO_AI="$FILE"
              break
            else
              echo "Invalid selection."
            fi
          done
        else
          echo "Invalid choice."
          continue
        fi
        
        if [ -n "$FILE_TO_AI" ]; then
          run_ai_analysis "$FILE_TO_AI"
        fi
        ;;
      5)
        exit 0
        ;;
      *)
        echo "Invalid choice."
        ;;
    esac
    echo ""
  done
}

# If arguments provided, run non-interactively
if [ $# -gt 0 ]; then
  run_analysis "$LIVE_LOG" "$1"
else
  show_menu
fi
