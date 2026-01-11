-- vtc-app - Supabase schema (chauffeurs + multi-tenant Shopify + API publique)
-- À exécuter dans le SQL editor Supabase.
--
-- Astuce reset (si pas de données importantes) :
--   drop schema public cascade; create schema public; puis exécuter ce fichier.

create extension if not exists "pgcrypto";

-- -----------------
-- Helpers
-- -----------------

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Bonne pratique: figer le search_path (évite l'avertissement Security Advisor)
alter function public.set_updated_at() set search_path = public;

-- -----------------
-- Auth provisioning
-- -----------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  full_name text,
  phone text
);

create table if not exists public.driver_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  company_name text,
  booking_email_to text,
  -- secret (Slack webhook) stocké chiffré côté app
  slack_webhook_url text,
  theme_name text,
  primary_color text,
  logo_url text,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_driver_settings_updated_at on public.driver_settings;
create trigger trg_driver_settings_updated_at
before update on public.driver_settings
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', null),
    coalesce(new.raw_user_meta_data->>'phone', null)
  )
  on conflict (id) do nothing;

  insert into public.driver_settings (user_id, company_name, booking_email_to, slack_webhook_url, theme_name, primary_color, logo_url)
  values (new.id, null, null, null, null, null, null)
  on conflict (user_id) do nothing;

  return new;
end;
$$ language plpgsql security definer;

alter function public.handle_new_user() set search_path = public, auth;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- -----------------
-- Tenants (slug-based + Shopify shop-based)
-- -----------------

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Public booking flow (slug)
  slug text unique,
  name text,

  -- Shopify multi-boutiques (myshopify.com)
  tenant_key text unique,

  -- Per-tenant settings used by Shopify routes
  booking_email_to text
);

drop trigger if exists trg_tenants_updated_at on public.tenants;
create trigger trg_tenants_updated_at
before update on public.tenants
for each row execute function public.set_updated_at();

create table if not exists public.tenant_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  booking_email_to text,
  stop_fee numeric,
  quote_message text,
  pricing_behavior text,
  lead_time_threshold_minutes integer,
  immediate_surcharge_enabled boolean,
  immediate_base_delta_amount numeric,
  immediate_base_delta_percent numeric,
  immediate_total_delta_percent numeric,

  options jsonb
);

drop trigger if exists trg_tenant_settings_updated_at on public.tenant_settings;
create trigger trg_tenant_settings_updated_at
before update on public.tenant_settings
for each row execute function public.set_updated_at();

-- -----------------
-- Tenant integrations (server-only secrets)
-- -----------------

create table if not exists public.tenant_integrations (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  provider text not null default 'slack',

  slack_webhook_enc text,
  slack_webhook_encrypted text,
  slack_webhook_mask text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_tenant_integrations_updated_at on public.tenant_integrations;
create trigger trg_tenant_integrations_updated_at
before update on public.tenant_integrations
for each row execute function public.set_updated_at();

-- -----------------
-- Vehicles (2 usages : chauffeur dashboard ET pricing tenant)
-- -----------------

create table if not exists public.vehicles (
  -- text pour supporter aussi des ids stables type "autre"; défaut = UUID string
  id text primary key default gen_random_uuid()::text,
  created_at timestamptz not null default now(),

  -- chauffeur-owned vehicles
  user_id uuid references public.profiles(id) on delete cascade,
  name text,
  plate text,
  photo_url text,

  -- tenant pricing vehicles
  tenant_id uuid references public.tenants(id) on delete cascade,
  label text,
  base_fare numeric,
  price_per_km numeric,
  quote_only boolean,
  image_url text
);

-- -----------------
-- Bookings (2 usages : chauffeur dashboard ET API publique par tenant)
-- -----------------

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- chauffeur-owned
  user_id uuid references public.profiles(id) on delete set null,

  -- tenant/public
  tenant_id uuid references public.tenants(id) on delete cascade,
  slug text,

  status text not null default 'new',

  -- client identity (2 variantes compatibles)
  customer_name text,
  customer_phone text,
  customer_email text,

  contact_name text,
  contact_phone text,
  contact_email text,

  -- trip (2 variantes compatibles)
  pickup text,
  dropoff text,
  datetime timestamptz,
  price numeric,

  start text,
  "end" text,
  stops text[],
  pickup_date text,
  pickup_time text,

  vehicle_id text,
  vehicle_label text,
  is_quote boolean,
  price_total numeric,
  pricing_mode text,
  lead_time_threshold_minutes integer,
  surcharges_applied jsonb,
  distance_km numeric,
  duration_minutes numeric,
  applied_options jsonb,
  options_total_fee numeric,

  user_agent text,
  ip text,

  confirmed_at timestamptz,
  confirmed_by_user_id uuid references auth.users(id) on delete set null
);

-- -----------------
-- Notifications in-app (chauffeur + client)
-- -----------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  read_at timestamptz,

  recipient_user_id uuid references auth.users(id) on delete cascade,
  recipient_email text,

  booking_id uuid,

  title text not null,
  body text not null
);

-- -----------------
-- RLS
-- -----------------

alter table public.profiles enable row level security;
alter table public.driver_settings enable row level security;
alter table public.vehicles enable row level security;
alter table public.bookings enable row level security;
alter table public.notifications enable row level security;

-- Server-only tables: RLS enabled + no policies
alter table public.tenants enable row level security;
alter table public.tenant_settings enable row level security;
alter table public.tenant_integrations enable row level security;

-- profiles
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
for select using (id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
for insert with check (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update using (id = auth.uid()) with check (id = auth.uid());

-- driver_settings
drop policy if exists "driver_settings_select_own" on public.driver_settings;
create policy "driver_settings_select_own" on public.driver_settings
for select using (user_id = auth.uid());

drop policy if exists "driver_settings_insert_own" on public.driver_settings;
create policy "driver_settings_insert_own" on public.driver_settings
for insert with check (user_id = auth.uid());

drop policy if exists "driver_settings_update_own" on public.driver_settings;
create policy "driver_settings_update_own" on public.driver_settings
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "driver_settings_delete_own" on public.driver_settings;
create policy "driver_settings_delete_own" on public.driver_settings
for delete using (user_id = auth.uid());

-- vehicles (chauffeur uniquement côté client; tenant vehicles = service role)
drop policy if exists "vehicles_select_own" on public.vehicles;
create policy "vehicles_select_own" on public.vehicles
for select using (user_id = auth.uid());

drop policy if exists "vehicles_insert_own" on public.vehicles;
create policy "vehicles_insert_own" on public.vehicles
for insert with check (user_id = auth.uid());

drop policy if exists "vehicles_update_own" on public.vehicles;
create policy "vehicles_update_own" on public.vehicles
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "vehicles_delete_own" on public.vehicles;
create policy "vehicles_delete_own" on public.vehicles
for delete using (user_id = auth.uid());

-- bookings
drop policy if exists "bookings_select_own_user" on public.bookings;
create policy "bookings_select_own_user" on public.bookings
for select using (user_id = auth.uid());

drop policy if exists "bookings_insert_own_user" on public.bookings;
create policy "bookings_insert_own_user" on public.bookings
for insert with check (user_id = auth.uid());

drop policy if exists "bookings_update_own_user" on public.bookings;
create policy "bookings_update_own_user" on public.bookings
for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "bookings_delete_own_user" on public.bookings;
create policy "bookings_delete_own_user" on public.bookings
for delete using (user_id = auth.uid());

-- client portal (lecture par email; pas d'update)
drop policy if exists "bookings_select_own_email" on public.bookings;
create policy "bookings_select_own_email" on public.bookings
for select
to authenticated
using (
  lower(customer_email) = lower((auth.jwt() ->> 'email'))
  or lower(contact_email) = lower((auth.jwt() ->> 'email'))
);

-- notifications
drop policy if exists "notifications_select_own_user" on public.notifications;
create policy "notifications_select_own_user" on public.notifications
for select
to authenticated
using (recipient_user_id = auth.uid());

drop policy if exists "notifications_update_own_user" on public.notifications;
create policy "notifications_update_own_user" on public.notifications
for update
to authenticated
using (recipient_user_id = auth.uid())
with check (recipient_user_id = auth.uid());

drop policy if exists "notifications_select_own_email" on public.notifications;
create policy "notifications_select_own_email" on public.notifications
for select
to authenticated
using (lower(recipient_email) = lower((auth.jwt() ->> 'email')));

drop policy if exists "notifications_update_own_email" on public.notifications;
create policy "notifications_update_own_email" on public.notifications
for update
to authenticated
using (lower(recipient_email) = lower((auth.jwt() ->> 'email')))
with check (lower(recipient_email) = lower((auth.jwt() ->> 'email')));
