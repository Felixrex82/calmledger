-- ============================================================
-- CalmChain — Supabase Database Schema
-- Run this in your Supabase SQL Editor (Project → SQL Editor → New Query)
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";


-- ── 1. CHECK-INS TABLE ──────────────────────────────────────
create table if not exists checkins (
  id          uuid primary key default uuid_generate_v4(),
  device_id   text not null,
  date        text not null,           -- toDateString() e.g. "Mon Mar 04 2026"
  timestamp   timestamptz not null default now(),
  mood        text not null,           -- calm | anxious | fomo | euphoric | numb
  mood_emoji  text,
  intent      text,                    -- hold | planned | watching | active
  reflection  text,
  score_at_checkin integer,
  created_at  timestamptz default now()
);

create index on checkins(device_id, created_at desc);


-- ── 2. JOURNAL ENTRIES TABLE ─────────────────────────────────
create table if not exists journal_entries (
  id          uuid primary key default uuid_generate_v4(),
  device_id   text not null,
  mood        text,
  text        text not null,
  source      text default 'manual',   -- manual | checkin
  created_at  timestamptz default now()
);

create index on journal_entries(device_id, created_at desc);


-- ── 3. CHAT HISTORY TABLE ────────────────────────────────────
create table if not exists chat_history (
  id          uuid primary key default uuid_generate_v4(),
  device_id   text not null,
  role        text not null,           -- user | assistant
  content     text not null,
  created_at  timestamptz default now()
);

create index on chat_history(device_id, created_at asc);


-- ── 4. SCORE HISTORY TABLE ───────────────────────────────────
create table if not exists score_history (
  id          uuid primary key default uuid_generate_v4(),
  device_id   text not null,
  date        text not null,
  score       integer not null,
  source      text default 'wallet',   -- wallet | checkin | manual
  created_at  timestamptz default now()
);

create index on score_history(device_id, created_at desc);


-- ── 5. WALLET ANALYSIS CACHE ─────────────────────────────────
-- Caches last analysis result so we don't re-run Claude on every boot
create table if not exists wallet_analysis (
  id              uuid primary key default uuid_generate_v4(),
  device_id       text not null,
  evm_address     text,
  sol_address     text,
  chains          text[],
  analysis        jsonb,               -- full Claude response
  wellness_score  integer,
  analyzed_at     timestamptz default now()
);

create index on wallet_analysis(device_id, analyzed_at desc);


-- ── ROW LEVEL SECURITY ───────────────────────────────────────
-- Users can only read/write their own device's data
-- Using device_id as anonymous identifier (no auth required for MVP)

alter table checkins       enable row level security;
alter table journal_entries enable row level security;
alter table chat_history   enable row level security;
alter table score_history  enable row level security;
alter table wallet_analysis enable row level security;

-- Policies: allow anon key to insert and select own device data
create policy "checkins_own_device" on checkins
  for all using (true) with check (true);

create policy "journal_own_device" on journal_entries
  for all using (true) with check (true);

create policy "chat_own_device" on chat_history
  for all using (true) with check (true);

create policy "score_own_device" on score_history
  for all using (true) with check (true);

create policy "wallet_own_device" on wallet_analysis
  for all using (true) with check (true);

-- Note: For production, tighten these policies to match on device_id
-- using (device_id = current_setting('app.device_id', true))
-- This requires passing device_id as a custom claim or using Supabase Auth


-- ── USEFUL VIEWS ─────────────────────────────────────────────

-- Daily check-in streak per device
create or replace view device_streaks as
select
  device_id,
  count(*) as total_checkins,
  max(created_at) as last_checkin,
  count(distinct date) as unique_days
from checkins
group by device_id;

-- Average score by device (last 30 days)
create or replace view device_avg_scores as
select
  device_id,
  round(avg(score)) as avg_score,
  min(score) as min_score,
  max(score) as max_score,
  count(*) as data_points
from score_history
where created_at > now() - interval '30 days'
group by device_id;