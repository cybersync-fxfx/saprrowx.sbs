-- Update Threat Radar to support multi-tenancy
alter table public.threat_radar add column if not exists target_agent_id text;
alter table public.threat_radar add column if not exists target_ip text;

create index if not exists idx_threat_radar_agent on public.threat_radar(target_agent_id);
