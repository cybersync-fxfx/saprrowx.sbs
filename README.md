# Sparrowx

Sparrowx is a full-stack infrastructure security platform designed for DDoS protection management. Users can register, download a unique agent installer, run it on their Ubuntu server, and manage their server security from a web dashboard.

## Tech Stack
- **Backend**: Node.js + Express
- **Auth**: Supabase Auth
- **Real-time**: WebSocket
- **Database**: Supabase PostgreSQL
- **Frontend**: React + Vite + Chart.js

## Quick Start (Local)

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Environment Variables:**
   Create a `.env` file in the root directory:
   ```env
   PORT=3001
   SUPABASE_URL="your-supabase-url"
   SUPABASE_ANON_KEY="your-supabase-anon-key"
   SUPABASE_SERVICE_KEY="your-supabase-service-role-key"
   GUARD_PUBLIC_IP="43.228.212.54"
   SPARROWX_TUNNEL_POOL="10.200.0.0/16"
   ```
   `SUPABASE_SERVICE_KEY` is required for admin approval, admin user listing, agent authentication, and tunnel/profile updates. The server also accepts `SUPABASE_SERVICE_ROLE_KEY` as an alias.
   Keep `SUPABASE_SERVICE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` only on the central Sparrowx panel/guard server. Do not put it in frontend builds, customer VPS env files, agent installers, logs, or support messages. Client servers should only receive the generated agent credentials (`SPARROWX_AGENT_ID` and `SPARROWX_API_KEY`). If a customer needs to operate their own panel, give them a separate Supabase project or separate database credentials, not your shared production service key.
   `GUARD_PUBLIC_IP` should be the real public WireGuard endpoint for the guard server. `SPARROWX_TUNNEL_POOL` controls the per-agent `/30` pool used for tunnel addressing.
   `SPARROWX_RADAR_*` controls the active guard-side scan engine and auto-ban thresholds. If your panel stays behind Cloudflare or another reverse proxy, add those proxy CIDRs to `SPARROWX_RADAR_TRUSTED_PROXY_CIDRS` so the scanner never auto-bans them.

3. **Database Setup:**
   Execute the contents of `supabase_setup.sql` and `supabase_threat_radar.sql` in your Supabase project's SQL Editor to create the required tables, triggers, and security policies.

4. **Build the Frontend:**
   ```bash
   npm run build
   ```

5. **Start the Server:**
   ```bash
   npm start
   ```

6. **Login:**
   Open `http://localhost:3001` in your browser and register a new account.

## Deployment Guide (Production)

### 1. Prerequisites
You need a server (e.g., Ubuntu 22.04) with Node.js 20.x, NPM, and Nginx installed.

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx certbot python3-certbot-nginx
sudo npm install -g pm2
```

### 2. Setup Project
Clone the repository and install dependencies.
```bash
git clone <your-repo-url> /opt/sbs
cd /opt/sbs
npm install
npm run build
```

### 3. Start with PM2
Create your `.env` file in `/opt/sbs/.env` with your Supabase credentials, then start the server.
```bash
pm2 start server.js --name "sparrowx-panel"
pm2 save
pm2 startup
```

Recommended `.env`:
```env
PORT=3001
SUPABASE_URL="your-supabase-url"
SUPABASE_ANON_KEY="your-supabase-anon-key"
SUPABASE_SERVICE_KEY="your-supabase-service-role-key"
GUARD_PUBLIC_IP="43.228.212.54"
SPARROWX_TUNNEL_POOL="10.200.0.0/16"
SPARROWX_RADAR_ENABLED="1"
SPARROWX_RADAR_AUTO_BAN="1"
SPARROWX_RADAR_BAN_THRESHOLD="90"
SPARROWX_RADAR_WATCH_THRESHOLD="55"
SPARROWX_RADAR_SCAN_INTERVAL_MS="10000"
SPARROWX_RADAR_WHITELIST_CIDRS="127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,35.235.240.0/20"
SPARROWX_RADAR_TRUSTED_PROXY_CIDRS=""
```

`SUPABASE_ANON_KEY` may be a publishable key (`sb_publishable_...`) or the legacy anon key. It is low privilege and still depends on RLS. The service role/secret key is high privilege, bypasses RLS, and must stay on the server you control.

### 4. Nginx Reverse Proxy Config (with WebSocket Support)
Create an Nginx configuration file (`/etc/nginx/sites-available/sparrowx`):

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400; # Keep WS connections alive
    }
}
```

Enable the site and restart Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/sparrowx /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 5. SSL / HTTPS (Certbot)
Run Certbot to automatically configure SSL for your domain:
```bash
sudo certbot --nginx -d yourdomain.com
```

### 6. Guard Tunnel Runtime
Run the guard bootstrap after deployment so WireGuard state, nftables auto-ban, and tunnel restore services are installed:

```bash
cd /opt/sbs
chmod +x setup-guard.sh tunnel-manager.sh restore-tunnels.sh
sudo bash ./setup-guard.sh
```

This installs:
- `/opt/sparrowx/tunnel-manager.sh`
- `/opt/sparrowx/restore-tunnels.sh`
- `sparrowx-tunnel-restore.service` to recreate saved WireGuard tunnels after reboot

### 6.1 Threat Radar / Strict Auto-Ban
Threat Radar now performs active guard-side scans and can automatically ban suspicious IPs before connection floods overwhelm protected services. The safest production defaults are already built in, but you should still tune the whitelist and trusted proxy ranges:

- `SPARROWX_RADAR_WHITELIST_CIDRS`
  Use for management and private ranges that should never be banned.
- `SPARROWX_RADAR_TRUSTED_PROXY_CIDRS`
  Add Cloudflare or any reverse-proxy CIDRs here if your panel stays proxied.
- `SPARROWX_RADAR_BAN_THRESHOLD`
  Default `90` for strict but conservative autobans.

The dashboard `Threat Radar` page now exposes:
- real scan status
- live watch/ban counts
- auto-ban on/off
- threshold tuning
- manual `Scan Now`

### 7. Cloudflare / Reverse Proxy
If you place the panel behind Cloudflare, do not leave `Under Attack Mode` or managed browser challenges enabled for machine-to-machine agent routes. The agent must be able to reach:

- `/api/agent/*`
- `/api/health`

Create a bypass/skip rule for those paths or move the agent API to a separate hostname without browser challenges.

---

## API Examples

### Authenticate
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin@example.com", "password": "admin123"}'
# Returns: {"token": "eyJ...", "user": {...}}
```

### Send Command to Agent
```bash
curl -X POST http://localhost:3000/api/command \
  -H "Authorization: Bearer <YOUR_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"cmd": "nft list ruleset"}'
```

---

## Troubleshooting

- **Agent shows "NO AGENT"**: Ensure the agent is running on the target server. Check logs using `journalctl -u sbs-agent -f`.
- **WebSocket disconnects frequently**: Ensure your Nginx configuration includes the `proxy_read_timeout` and `Upgrade` headers.
- **Admin shows inactive / approval fails**: Make sure `.env` includes `SUPABASE_SERVICE_KEY` or `SUPABASE_SERVICE_ROLE_KEY`, then restart PM2.
- **Supabase Authentication Issues**: Make sure the `supabase_setup.sql` script was run successfully and `.env` has the correct `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and service-role key.
- **Agent fails to download**: Verify that you are logged in and your session is active.

> Note: legacy SBS_* environment names, /opt/sbs-agent, and sbs-agent service names remain supported for compatibility with already-installed agents.
