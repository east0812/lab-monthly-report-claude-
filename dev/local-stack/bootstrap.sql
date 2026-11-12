-- 로컬 검증 스택 전용: Supabase 가 기본 제공하는 역할과 auth 스키마를 흉내 낸다.
-- 실제 Supabase 프로젝트에는 적용하지 않는다 (이미 존재함).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant anon, authenticated, service_role to current_user;
grant usage on schema public to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  encrypted_password text not null,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  banned_until timestamptz,
  email_confirmed_at timestamptz default now(),
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists auth.refresh_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists auth.one_time_tokens (
  token_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_type text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
