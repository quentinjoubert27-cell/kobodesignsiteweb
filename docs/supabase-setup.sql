-- ============================================================
-- KOBO DESIGN — Espace client : setup Supabase
-- À exécuter dans l'éditeur SQL de Supabase
-- ============================================================

-- 1. TABLE CLIENTS (profils liés à auth.users)
create table if not exists clients (
  id uuid references auth.users(id) on delete cascade primary key,
  prenom text not null default '',
  nom text not null default '',
  email text,
  telephone text,
  created_at timestamptz default now()
);
alter table clients enable row level security;
create policy "Client voit son profil" on clients for select using (auth.uid() = id);
create policy "Client modifie son profil" on clients for update using (auth.uid() = id);
create policy "Client crée son profil" on clients for insert with check (auth.uid() = id);
-- Admin (service role) peut tout voir — géré côté API

-- 2. TABLE PROJETS
create table if not exists projets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade not null,
  nom text not null,
  description text,
  statut text not null default 'En étude',
  type text default 'mobilier',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table projets enable row level security;
create policy "Client voit ses projets" on projets for select using (
  auth.uid() = client_id
);
-- Seul l'admin (service role) peut insérer/modifier/supprimer

-- 3. TABLE MESSAGES
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  projet_id uuid references projets(id) on delete cascade not null,
  expediteur text not null check (expediteur in ('client','kobo')),
  contenu text not null,
  lu boolean default false,
  created_at timestamptz default now()
);
alter table messages enable row level security;
create policy "Client voit ses messages" on messages for select using (
  exists (select 1 from projets p where p.id = projet_id and p.client_id = auth.uid())
);
create policy "Client envoie un message" on messages for insert with check (
  expediteur = 'client' and
  exists (select 1 from projets p where p.id = projet_id and p.client_id = auth.uid())
);
create policy "Client marque lu" on messages for update using (
  exists (select 1 from projets p where p.id = projet_id and p.client_id = auth.uid())
);

-- 4. TABLE DOCUMENTS
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  projet_id uuid references projets(id) on delete cascade not null,
  nom text not null,
  type text default 'Document',  -- Devis, Plan, Facture, Document client…
  url text not null,
  taille_kb int,
  uploade_par text not null check (uploade_par in ('kobo','client')),
  created_at timestamptz default now()
);
alter table documents enable row level security;
create policy "Client voit ses documents" on documents for select using (
  exists (select 1 from projets p where p.id = projet_id and p.client_id = auth.uid())
);
create policy "Client upload un document" on documents for insert with check (
  uploade_par = 'client' and
  exists (select 1 from projets p where p.id = projet_id and p.client_id = auth.uid())
);

-- 5. STORAGE BUCKET (à créer dans Storage > New bucket)
-- Nom : "documents-client"
-- Public : NON (privé)
-- Policies à créer manuellement :
--   SELECT : (auth.uid()::text = (storage.foldername(name))[1])
--   INSERT : (auth.uid()::text = (storage.foldername(name))[1])

-- 6. FONCTION updated_at auto
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger projets_updated_at before update on projets
  for each row execute procedure update_updated_at();
