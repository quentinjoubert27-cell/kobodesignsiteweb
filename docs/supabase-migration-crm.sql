-- ============================================================
-- KOBO DESIGN — Migration : suivi client (CRM) dans l'admin
-- À exécuter dans Supabase SQL Editor (re-lançable sans risque)
-- ============================================================

-- Fiche client : source du contact, température du lead, étiquettes
alter table clients add column if not exists source text;
alter table clients add column if not exists temperature text;   -- 'chaud' | 'tiede' | 'froid'
alter table clients add column if not exists tags text[] not null default '{}';

-- Historique : notes, appels, emails, rendez-vous, visites + événements automatiques
create table if not exists crm_activites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  projet_id uuid references projets(id) on delete set null,
  type text not null default 'note',     -- note | appel | email | rdv | visite | statut | rappel
  contenu text not null,
  auteur text,                           -- email de l'admin
  auto boolean not null default false,   -- true = généré automatiquement
  epingle boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists crm_activites_client_idx on crm_activites (client_id, created_at desc);

-- Rappels : « à rappeler le … »
create table if not exists crm_rappels (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  projet_id uuid references projets(id) on delete set null,
  date_rappel date not null,
  motif text,
  fait boolean not null default false,
  fait_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists crm_rappels_pending_idx on crm_rappels (fait, date_rappel);

alter table crm_activites enable row level security;
alter table crm_rappels enable row level security;

drop policy if exists "Admin crm_activites" on crm_activites;
create policy "Admin crm_activites" on crm_activites for all
  using (auth.jwt()->>'email' in ('quentin.joubert@icloud.com','pascal@symetry.fr','lena@symetry.fr','mathilde@symetry.fr','armelle@symetry.fr'))
  with check (auth.jwt()->>'email' in ('quentin.joubert@icloud.com','pascal@symetry.fr','lena@symetry.fr','mathilde@symetry.fr','armelle@symetry.fr'));

drop policy if exists "Admin crm_rappels" on crm_rappels;
create policy "Admin crm_rappels" on crm_rappels for all
  using (auth.jwt()->>'email' in ('quentin.joubert@icloud.com','pascal@symetry.fr','lena@symetry.fr','mathilde@symetry.fr','armelle@symetry.fr'))
  with check (auth.jwt()->>'email' in ('quentin.joubert@icloud.com','pascal@symetry.fr','lena@symetry.fr','mathilde@symetry.fr','armelle@symetry.fr'));
