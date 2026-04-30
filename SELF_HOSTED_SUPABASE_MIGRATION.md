# Self-Hosted Supabase Migration Plan

Goal: install Supabase on the same guard/panel VPS, test it privately, move SparrowX to it only after verification, and keep the current cloud Supabase running until the local instance is proven stable.

Official reference: https://supabase.com/docs/guides/self-hosting/docker

## Target Layout

```text
/opt/sbs        SparrowX panel and guard app
/opt/supabase   self-hosted Supabase Docker project
/opt/backups    database and env backups
```

Public:

```text
80/443          Nginx for https://sparrowx.sbs
```

Private/local only:

```text
3001            SparrowX Node app
8000            Supabase API gateway
8443            Supabase HTTPS gateway, optional
5432            Supabase/Postgres session port
6543            Supavisor transaction pooler
```

Do not expose Postgres or the Supabase API publicly during migration. Use SSH tunneling for Studio if needed.

## Phase 0: Backup Current Running Panel

Run on the guard VPS:

```bash
mkdir -p /opt/backups/sparrowx
cp -a /opt/sbs/.env /opt/backups/sparrowx/sbs.env.cloud.$(date +%F-%H%M%S)
pm2 save
pm2 list
curl -I http://127.0.0.1:3001/api/health
```

Do not change `/opt/sbs/.env` yet.

## Phase 1: Install Docker

Run only if Docker is not already installed:

```bash
docker --version || curl -fsSL https://get.docker.com | sh
docker compose version
systemctl enable --now docker
```

## Phase 2: Install Supabase Beside SparrowX

```bash
cd /opt
git clone --depth 1 https://github.com/supabase/supabase supabase-source
mkdir -p /opt/supabase
cp -rf /opt/supabase-source/docker/* /opt/supabase/
cp /opt/supabase-source/docker/.env.example /opt/supabase/.env
cd /opt/supabase
```

Generate secrets:

```bash
sh ./utils/generate-keys.sh
```

Edit `/opt/supabase/.env`:

```bash
nano /opt/supabase/.env
```

Set these values carefully:

```env
SITE_URL=https://sparrowx.sbs
API_EXTERNAL_URL=http://127.0.0.1:8000
SUPABASE_PUBLIC_URL=http://127.0.0.1:8000

KONG_HTTP_PORT=127.0.0.1:8000
KONG_HTTPS_PORT=127.0.0.1:8443
POSTGRES_PORT=127.0.0.1:5432
POOLER_PROXY_PORT_TRANSACTION=127.0.0.1:6543
```

Also make sure passwords and keys are not defaults:

```env
POSTGRES_PASSWORD=long_random_value
JWT_SECRET=long_random_value
ANON_KEY=generated_value
SERVICE_ROLE_KEY=generated_value
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=long_random_value_with_letters
```

Start Supabase:

```bash
cd /opt/supabase
docker compose pull
docker compose up -d
docker compose ps
```

Wait until containers show healthy.

## Phase 3: Load SparrowX Schema Into Local Supabase

Run:

```bash
cd /opt/supabase
source .env
docker compose exec -T db psql -U postgres -d postgres < /opt/sbs/supabase_setup.sql
docker compose exec -T db psql -U postgres -d postgres < /opt/sbs/supabase_threat_radar.sql
```

Verify tables:

```bash
docker compose exec -T db psql -U postgres -d postgres -c "\dt public.*"
docker compose exec -T db psql -U postgres -d postgres -c "\df public.verify_agent"
```

## Phase 4: Private Test Without Touching Production

Create a temporary test env file:

```bash
cp /opt/sbs/.env /opt/sbs/.env.local-supabase-test
nano /opt/sbs/.env.local-supabase-test
```

In that test file set:

```env
SUPABASE_URL=http://127.0.0.1:8000
SUPABASE_ANON_KEY=<ANON_KEY from /opt/supabase/.env>
SUPABASE_SERVICE_KEY=<SERVICE_ROLE_KEY from /opt/supabase/.env>
```

Do not restart PM2 with this file yet. First test Supabase directly:

```bash
curl -s http://127.0.0.1:8000/auth/v1/settings \
  -H "apikey: <ANON_KEY>"
```

Expected: JSON response from GoTrue/Auth.

For Studio access from your computer, use SSH tunnel:

```bash
ssh -L 8000:127.0.0.1:8000 root@43.228.212.54
```

Then open:

```text
http://127.0.0.1:8000
```

## Phase 5: Migration Choice

Simple migration:

- Keep old cloud Supabase running.
- Create new admin user on local Supabase.
- Existing agents can be reinstalled with new local-backed panel credentials.
- This is easiest and lowest risk.

Full migration:

- Export/import `auth.users`, `auth.identities`, `public.user_profiles`, `public.threat_radar`, and future telemetry tables.
- Higher risk because Auth internals must match correctly.
- Do this only after the local Supabase stack is healthy.

## Phase 6: Cutover

Only after local Supabase is tested:

```bash
cp /opt/sbs/.env /opt/backups/sparrowx/sbs.env.before-local-supabase.$(date +%F-%H%M%S)
nano /opt/sbs/.env
```

Set:

```env
SUPABASE_URL=http://127.0.0.1:8000
SUPABASE_ANON_KEY=<local ANON_KEY>
SUPABASE_SERVICE_KEY=<local SERVICE_ROLE_KEY>
```

Restart:

```bash
cd /opt/sbs
pm2 restart sbs-panel --update-env
pm2 logs sbs-panel --lines 100 --nostream
curl -I http://127.0.0.1:3001/api/health
```

Then test in browser:

```text
https://sparrowx.sbs
```

## Phase 7: Keep Cloud Supabase Until Stable

Do not delete the cloud project immediately. Keep it for at least a few days while you confirm:

- login works
- admin approval works
- agent registration works
- radar stats work
- blocklist/tunnel actions work
- daily backups work

## Phase 8: Backups

Create backup folder:

```bash
mkdir -p /opt/backups/supabase
```

Manual backup:

```bash
cd /opt/supabase
docker compose exec -T db pg_dump -U postgres -d postgres > /opt/backups/supabase/postgres.$(date +%F-%H%M%S).sql
```

Add a daily cron after everything is stable.

## Rollback

If local Supabase fails after cutover:

```bash
cp /opt/backups/sparrowx/<cloud-env-backup-file> /opt/sbs/.env
pm2 restart sbs-panel --update-env
```

The old cloud Supabase should still work because we did not delete it.
