-- Sparrowx Phase 3: Threat Radar Table
create table if not exists public.threat_radar (
  id uuid default gen_random_uuid() primary key,
  ip text not null,
  score integer,
  reason text,
  country text,
  abuseipdb_score integer,
  action text, -- 'banned', 'watched', 'clean'
  detected_at timestamptz default now()
);

-- Threat Radar events are written/read through the server service role.
-- Keep direct Data API access closed for anon/authenticated clients.
alter table public.threat_radar enable row level security;
revoke all on public.threat_radar from anon, authenticated;

-- Index for performance
create index if not exists idx_threat_radar_ip on public.threat_radar(ip);
create index if not exists idx_threat_radar_detected_at on public.threat_radar(detected_at);
