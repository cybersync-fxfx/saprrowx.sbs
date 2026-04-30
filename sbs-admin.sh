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

# Detect installation directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
INSTALL_DIR="$SCRIPT_DIR"

# Load environment variables from .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
elif [ -f "$INSTALL_DIR/.env" ]; then
  export $(grep -v '^#' "$INSTALL_DIR/.env" | xargs)
elif [ -f /opt/sbs/.env ]; then
  export $(grep -v '^#' /opt/sbs/.env | xargs)
fi

SUPABASE_KEY="${SUPABASE_SERVICE_KEY:-$SUPABASE_SERVICE_ROLE_KEY}"

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_KEY" ]; then
  echo -e "${RED}[x] Error: SUPABASE_URL or SUPABASE_SERVICE_KEY not found in .env${RESET}"
  echo -e "${YELLOW}Please ensure you are running this in the project root with a valid .env file.${RESET}"
  exit 1
fi

list_users() {
  echo -e "${WHITE}[*] Fetching users from Supabase...${RESET}"
  echo ""
  
  USERS_JSON=$(curl -s -X GET "${SUPABASE_URL}/rest/v1/user_profiles?select=id,username,role,status,agent_id" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}")
  
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
  
  RESPONSE=$(curl -s -X PATCH "${SUPABASE_URL}/rest/v1/user_profiles?username=eq.${username}" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"status\": \"${status}\"}")
    
  if [ -z "$RESPONSE" ] || [[ "$RESPONSE" != *"error"* ]]; then
    echo -e "${GREEN}[ok] User ${username} access updated to ${status}.${RESET}"
  else
    echo -e "${RED}[x] Failed to update user.${RESET}"
    echo -e "${DIM}$RESPONSE${RESET}"
  fi
  echo ""
}

reset_password() {
  local username=$1
  
  # 1. Fetch the user ID from user_profiles
  USER_DATA=$(curl -s -X GET "${SUPABASE_URL}/rest/v1/user_profiles?username=eq.${username}&select=id" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}")
  
  USER_ID=$(echo "$USER_DATA" | node -e "
    const fs = require('fs');
    const data = JSON.parse(fs.readFileSync(0, 'utf-8'));
    console.log(data?.[0]?.id || '');
  ")

  if [ -z "$USER_ID" ]; then
    echo -e "${RED}[x] Error: User '${username}' not found or has no ID.${RESET}"
    return
  fi

  echo -e "${YELLOW}[->] Resetting password for ${username} (ID: ${USER_ID})...${RESET}"
  read -s -p "Enter new password: " PASS
  echo ""
  
  if [ -z "$PASS" ]; then
    echo -e "${RED}[x] Password cannot be empty.${RESET}"
    return
  fi

  # 2. Update password in auth.users using Admin API
  # Note: The auth admin endpoint is /auth/v1/admin/users/{id}
  RESPONSE=$(curl -s -X PUT "${SUPABASE_URL}/auth/v1/admin/users/${USER_ID}" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"password\": \"${PASS}\"}")

  if [[ "$RESPONSE" == *"\"id\":"* ]]; then
    echo -e "${GREEN}[ok] Password for ${username} has been reset successfully.${RESET}"
  else
    echo -e "${RED}[x] Failed to reset password.${RESET}"
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
  echo -e "  ${GREEN}4${RESET}. Reset User Password"
  echo -e "  ${GREEN}5${RESET}. Exit"
  echo ""
  read -p "Select option (1-5): " OPT
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
      read -p "Enter username to reset password: " UNAME
      if [ -n "$UNAME" ]; then
        reset_password "$UNAME"
      fi
      ;;
    5)
      echo -e "${CYAN}Goodbye.${RESET}"
      exit 0
      ;;
    *)
      echo -e "${RED}Invalid option.${RESET}"
      echo ""
      ;;
  esac
done
