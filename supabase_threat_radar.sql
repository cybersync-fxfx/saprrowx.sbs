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

-- Index for performance
create index if not exists idx_threat_radar_ip on public.threat_radar(ip);
create index if not exists idx_threat_radar_detected_at on public.threat_radar(detected_at);
