-- Undate schema. Paste into Supabase dashboard -> SQL Editor -> Run.

create extension if not exists pgcrypto;

create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  name text,
  headline text,
  photo_url text,
  linkedin_url text not null,
  instagram_url text not null,
  verification text,
  pool text not null default 'visitor' check (pool in ('demo', 'visitor')),
  status text not null default 'queued',   -- queued | scraping | reading | ready | dating | done | error
  error text,
  log jsonb not null default '[]'::jsonb,  -- [{t, step, msg}] drives the live progress UI
  created_at timestamptz not null default now()
);

create table if not exists sources (
  person_id uuid references people(id) on delete cascade,
  kind text not null check (kind in ('linkedin', 'instagram')),
  raw jsonb not null,
  normalized jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (person_id, kind)
);

create table if not exists profiles (
  person_id uuid primary key references people(id) on delete cascade,
  image_notes jsonb,
  observations jsonb not null,
  profile jsonb not null,
  models jsonb,
  created_at timestamptz not null default now()
);

create table if not exists dates (
  id uuid primary key default gen_random_uuid(),
  a_id uuid not null references people(id) on delete cascade,
  b_id uuid not null references people(id) on delete cascade,
  round int not null default 1,
  status text not null default 'running',  -- running | done | error
  venue jsonb,
  scene text,
  transcript jsonb not null default '[]'::jsonb,  -- [{speaker:'a'|'b'|'scene', text}]
  debrief_a jsonb,   -- A's agent about B
  debrief_b jsonb,   -- B's agent about A
  score_ab real,
  score_ba real,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists dates_a on dates(a_id);
create index if not exists dates_b on dates(b_id);

-- Everything is read and written from the server with the service role key; lock direct public access.
alter table people enable row level security;
alter table sources enable row level security;
alter table profiles enable row level security;
alter table dates enable row level security;
