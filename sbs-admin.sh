#!/bin/bash
# SBS Admin Panel - Manage Access and Subscriptions

clear

CYAN="\e[1;36m"
GREEN="\e[1;32m"
YELLOW="\e[1;33m"
RED="\e[1;31m"
WHITE="\e[1;37m"
DIM="\e[0;90m"
RESET="\e[0m"

echo -e "${CYAN}=================================================${RESET}"
echo -e "${CYAN}          SBS - ADMIN ACCESS PANEL               ${RESET}"
echo -e "${CYAN}=================================================${RESET}"
echo ""

list_users() {
  echo -e "${WHITE}[*] Fetching users from server...${RESET}"
  echo ""
  
  USERS_JSON=$(curl -s http://127.0.0.1:3001/api/internal/users)
  
  if [ -z "$USERS_JSON" ] || [[ "$USERS_JSON" == *"error"* ]]; then
    echo -e "${RED}[x] Failed to fetch users.${RESET}"
    echo -e "${DIM}$USERS_JSON${RESET}"
    return
  fi

  echo -e "${GREEN}[+] Users List:${RESET}"
  echo ""
  
  printf "${WHITE}%-20s | %-10s | %-12s | %-20s${RESET}\n" "USERNAME" "ROLE" "STATUS" "AGENT ID"
  printf "%-20s | %-10s | %-12s | %-20s\n" "--------------------" "----------" "------------" "--------------------"

  # Parse JSON using Node.js (guaranteed to be there)
  echo "$USERS_JSON" | node -e "
  const fs = require('fs');
  const data = fs.readFileSync(0, 'utf-8');
  if (!data) process.exit(0);
  try {
    const users = JSON.parse(data);
    if (users.error) { console.error('Error:', users.error); process.exit(1); }
    users.forEach(u => {
      const user = (u.username || 'N/A').substring(0, 20);
      const role = (u.role || 'N/A').substring(0, 10);
      const status = (u.status || 'N/A').substring(0, 12);
      const agent = (u.agent_id || 'N/A').substring(0, 20);
      console.log(user.padEnd(20) + ' | ' + role.padEnd(10) + ' | ' + status.padEnd(12) + ' | ' + agent.padEnd(20));
    });
  } catch(e) { console.error('Failed to parse user data.'); }
  "
  echo ""
}

update_status() {
  local username=$1
  local status=$2
  
  echo -e "${YELLOW}[->] Updating ${username} status to ${status}...${RESET}"
  
  RESPONSE=$(curl -s -X POST http://127.0.0.1:3001/api/internal/users/status \
    -H "Content-Type: application/json" \
    -d "{\"username\": \"${username}\", \"status\": \"${status}\"}")
    
  if [[ "$RESPONSE" == *"success\":true"* ]]; then
    echo -e "${GREEN}[ok] User ${username} access updated to ${status}.${RESET}"
  else
    echo -e "${RED}[x] Failed to update user.${RESET}"
    echo -e "${DIM}$RESPONSE${RESET}"
  fi
  echo ""
}

# Main Menu
while true; do
  echo -e "${WHITE}Options:${RESET}"
  echo -e "  ${GREEN}1${RESET}. List Users"
  echo -e "  ${GREEN}2${RESET}. Approve/Renew Access"
  echo -e "  ${GREEN}3${RESET}. Suspend Access"
  echo -e "  ${GREEN}4${RESET}. Exit"
  echo ""
  read -p "Select option (1-4): " OPT
  echo ""

  case $OPT in
    1)
      list_users
      ;;
    2)
      read -p "Enter username to approve/renew: " UNAME
      if [ -n "$UNAME" ]; then
        update_status "$UNAME" "approved"
      fi
      ;;
    3)
      read -p "Enter username to suspend: " UNAME
      if [ -n "$UNAME" ]; then
        update_status "$UNAME" "rejected"
      fi
      ;;
    4)
      echo -e "${CYAN}Goodbye.${RESET}"
      exit 0
      ;;
    *)
      echo -e "${RED}Invalid option.${RESET}"
      echo ""
      ;;
  esac
done
