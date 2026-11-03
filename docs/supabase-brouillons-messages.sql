-- ============================================================
-- KOBO DESIGN — Messages client à faire relire par l'équipe avant envoi
-- À exécuter une fois dans Supabase SQL Editor
-- ============================================================

create table if not exists messages_brouillons (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references auth.users(id) on delete cascade,
  projet_id   uuid,
  auteur      text not null,                          -- e-mail de la personne qui prépare le message
  contenu     text not null,
  relecteurs  text[] not null default '{}',           -- e-mails des personnes tagguées
  statut      text not null default 'a_relire' check (statut in ('a_relire','envoye')),
  envoye_par  text,
  envoye_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Un avis par relecteur (table séparée : deux relecteurs peuvent répondre en même temps sans s'écraser)
create table if not exists messages_brouillons_avis (
  brouillon_id uuid not null references messages_brouillons(id) on delete cascade,
  relecteur    text not null,
  avis         text not null check (avis in ('ok','modif')),
  commentaire  text,
  created_at   timestamptz not null default now(),
  primary key (brouillon_id, relecteur)
);

create index if not exists idx_messages_brouillons_client on messages_brouillons(client_id, statut);

alter table messages_brouillons enable row level security;
alter table messages_brouillons_avis enable row level security;

do $$
declare admins text[] := array['quentin.joubert@icloud.com','pascal@symetry.fr','lena@symetry.fr','mathilde@symetry.fr','armelle@symetry.fr'];
begin
  execute 'drop policy if exists "Admins accès total brouillons" on messages_brouillons';
  execute format('create policy "Admins accès total brouillons" on messages_brouillons for all using ((auth.jwt()->>''email'') = any (%L)) with check ((auth.jwt()->>''email'') = any (%L))', admins, admins);
  execute 'drop policy if exists "Admins accès total avis brouillons" on messages_brouillons_avis';
  execute format('create policy "Admins accès total avis brouillons" on messages_brouillons_avis for all using ((auth.jwt()->>''email'') = any (%L)) with check ((auth.jwt()->>''email'') = any (%L))', admins, admins);
end $$;
