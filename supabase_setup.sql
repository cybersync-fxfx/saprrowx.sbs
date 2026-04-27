-- 1. Create the user_profiles table
create table public.user_profiles (
  id uuid references auth.users not null primary key,
  username text unique not null,
  api_key text unique not null,
  agent_id text unique not null,
  role text not null default 'user',
  status text not null default 'pending',
  tunnel_status text default 'inactive',
  client_ip text,
  tunnel_created_at timestamptz
);

-- 2. Enable RLS
alter table public.user_profiles enable row level security;

-- 3. Policy: Users can only read their own profile.
-- Profile writes are performed by the backend service role so users cannot
-- self-promote role/status or overwrite agent credentials directly.
drop policy if exists "Users can read own profile" on public.user_profiles;
drop policy if exists "Users can update own profile" on public.user_profiles;

create policy "Users can read own profile" 
on public.user_profiles 
for select 
using (auth.uid() = id);

revoke update on public.user_profiles from anon, authenticated;

-- 4. Trigger to automatically create a profile when a user registers
create schema if not exists private;
revoke all on schema private from anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.verify_agent(text, text);
drop function if exists public.handle_new_user();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  is_first_user boolean;
begin
  select not exists(select 1 from public.user_profiles) into is_first_user;
  insert into public.user_profiles (id, username, api_key, agent_id, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8)),
    'spx_' || md5(random()::text || clock_timestamp()::text),
    'agent_' || substring(md5(random()::text) from 1 for 12),
    case when is_first_user then 'admin' else 'user' end,
    case when is_first_user then 'approved' else 'pending' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure private.handle_new_user();
