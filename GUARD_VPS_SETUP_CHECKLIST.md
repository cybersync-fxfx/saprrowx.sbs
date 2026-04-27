# Sparrowx Guard VPS Setup Checklist

This is the one-time setup checklist for a fresh Sparrowx guard VPS.

Current known values:

- Panel domain: `sbs.detriot.host`
- Guard public IP: `43.228.212.54`
- App path: `/opt/sbs`
- Backend port: `3001`
- PM2 app name: `sparrowx-panel`

Important reality for the current build:

- Phase 1 is the working target for this checklist:
  - panel
  - auth
  - installer generation
  - agent registration
  - live stats
  - terminal
- WireGuard tunnel orchestration is enabled by default.
- Client IP hiding and public service exposure strategy still need production validation per customer/service.

## 1. What You Need

Minimum infrastructure:

1. `1` guard VPS
2. `1` Supabase project
3. Your domain `sbs.detriot.host` pointed to `43.228.212.54`
4. Client servers connect later by running their generated installer

For the current build, it is fine that:

- the website
- the dashboard
- the backend API
- the guard role

all live on the same VPS.

## 2. DNS

Make sure your DNS A record is:

```text
sbs.detriot.host -> 43.228.212.54
```

Wait until this resolves correctly:

```bash
ping sbs.detriot.host
```

Expected target: `43.228.212.54`

## 3. SSH Into the Guard VPS

```bash
ssh root@43.228.212.54
```

## 4. Base Server Packages

Run these on the guard VPS:

```bash
apt-get update
apt-get upgrade -y
apt-get install -y git curl nginx certbot python3-certbot-nginx nftables iproute2 net-tools jq
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pm2
```

Check versions:

```bash
node -v
npm -v
pm2 -v
nginx -v
```

## 5. Clone the Project

```bash
git clone https://github.com/cybersync-fxfx/sbs.detriot /opt/sbs
cd /opt/sbs
npm install
```

## 6. Frontend Build

The server uses `frontend/dist`, so this build is required.

```bash
cd /opt/sbs/frontend
npm install
npm run build
```

## 7. Supabase Setup

In Supabase, run the SQL from:

```text
/opt/sbs/supabase_setup.sql
```

This must be done before expecting the panel to work properly.

You need these values from Supabase:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` or publishable key
- `SUPABASE_SERVICE_KEY` / `SUPABASE_SERVICE_ROLE_KEY`

Keep the Supabase service role/secret key only on the central Sparrowx panel/guard server. Do not give it to customer/client servers. Agents and protected VPS machines should only receive their generated `SPARROWX_AGENT_ID` and `SPARROWX_API_KEY`.

## 8. Create the Server .env

Create:

```text
/opt/sbs/.env
```

Use:

```env
PORT=3001
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_publishable_or_anon_key
SUPABASE_SERVICE_KEY=your_supabase_service_role_key
```

Do not use `localhost` or private IPs for the public panel when generating installers.

The correct public panel URL is:

```text
https://sbs.detriot.host
```

## 9. Start the Backend With PM2

```bash
cd /opt/sbs
pm2 start server.js --name sparrowx-panel
pm2 save
pm2 startup
```

Check:

```bash
pm2 list
pm2 logs sparrowx-panel --lines 50
```

Healthy log should show:

- `Server HTTP: http://localhost:3001`
- `WebSocket: ws://localhost:3001`
- `Database: Connected`
- `Admin Status: Active`

## 10. Nginx Reverse Proxy

Create:

```text
/etc/nginx/sites-available/sbs
```

Use this config:

```nginx
server {
    listen 80;
    server_name sbs.detriot.host;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

Enable it:

```bash
ln -sf /etc/nginx/sites-available/sbs /etc/nginx/sites-enabled/sbs
nginx -t
systemctl restart nginx
```

## 11. Enable SSL

```bash
certbot --nginx -d sbs.detriot.host
```

Then test:

```bash
curl -I https://sbs.detriot.host
curl -I https://sbs.detriot.host/api/health
```

Expected:

- login page loads in browser
- `/api/health` returns `200 OK`

## 12. Guard OS Networking Prep

Run the bundled guard setup script:

```bash
cd /opt/sbs
chmod +x setup-guard.sh
chmod +x tunnel-manager.sh
./setup-guard.sh
```

This prepares:

- IP forwarding
- relaxed `rp_filter`
- nftables
- `/opt/sparrowx/tunnel-manager.sh`

Then verify:

```bash
sysctl net.ipv4.ip_forward
sysctl net.ipv4.conf.all.rp_filter
nft list ruleset
ls -l /opt/sparrowx/tunnel-manager.sh
```

Expected:

- `net.ipv4.ip_forward = 1`
- `rp_filter = 0`
- nftables loads successfully

## 13. Provider Firewall / Cloud Firewall

On the VPS provider side, allow:

- `22/tcp`
- `80/tcp`
- `443/tcp`
- `51820-51900/udp` for WireGuard tunnels

Notes:

- Public users should hit `80/443`
- `3001` should stay behind Nginx and does not need public exposure unless you intentionally want it public
- WireGuard listens on UDP. Keep the allocated tunnel port range open on the guard VPS.

## 14. Dashboard Reachability Check

In browser:

```text
https://sbs.detriot.host
```

This should show the login page. That is correct.

The agent does not use the login page itself. It uses:

- `/api/agent/register`
- `/api/agent/stats`
- `/api/agent/commands`

So the public installer value must be:

```text
SPARROWX_SERVER=https://sbs.detriot.host
```

## 15. Download and Test a Fresh Installer

In the panel:

1. log in
2. go to `Install Agent`
3. make sure the panel URL is `https://sbs.detriot.host`
4. download a fresh installer

On the client server:

```bash
sudo bash sparrowx-agent-<agent-id>.sh
```

Then check the client:

```bash
sudo systemctl status sbs-agent --no-pager
sudo journalctl -u sbs-agent -n 100 --no-pager
sudo tail -n 100 /var/log/sbs/agent.log
sudo cat /opt/sbs-agent/.env
```

The client `.env` should show:

```env
SPARROWX_SERVER=https://sbs.detriot.host
SPARROWX_AGENT_ID=...
SPARROWX_API_KEY=...
SPARROWX_ENABLE_TUNNEL=1
```

The installer also writes legacy `SBS_*` aliases, and the systemd service still uses `sbs-agent` so existing installed clients can auto-update without a service migration.

## 16. Confirm the Panel Sees the Agent

On the guard VPS:

```bash
pm2 logs sparrowx-panel --lines 100
```

You want to see:

```text
[agent] Registered ...
```

If the dashboard still shows `NO AGENT`, the next checks are:

On guard:

```bash
curl -I https://sbs.detriot.host/api/health
pm2 logs sparrowx-panel --lines 100
```

On client:

```bash
sudo systemctl status sbs-agent --no-pager
sudo tail -n 100 /var/log/sbs/agent.log
sudo cat /opt/sbs-agent/.env
```

## 17. What Is Already Enough For Phase 1

If all steps above are done, your side is ready enough for:

- login/register
- admin approval
- installer download
- agent install
- dashboard connection
- stats
- terminal
- firewall inspection
- blocklist actions

## 18. What Still Belongs To Phase 2

These are not fully finished yet just by setting up the VPS:

- true client IP hiding
- full WireGuard routing through guard
- production tunnel orchestration
- per-customer public service exposure strategy

That means:

- your new guard VPS can host the panel now
- client agents can connect now
- full DDoS guard routing still needs additional Phase 2 work

## 19. Quick Re-Deploy Commands

Whenever you update code later:

```bash
cd /opt/sbs
git pull
cd /opt/sbs/frontend
npm install
npm run build
cd /opt/sbs
pm2 restart sparrowx-panel
pm2 logs sparrowx-panel --lines 50
```

## 20. One-Line Summary

For the current project, one guard VPS with `sbs.detriot.host` on `43.228.212.54`, plus Supabase, Nginx, SSL, PM2, frontend build, and guard OS prep is the correct one-time setup from your side.
