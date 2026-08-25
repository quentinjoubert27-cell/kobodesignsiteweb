-- ============================================================
-- KOBO DESIGN — Migration : distinction particulier / professionnel
-- À exécuter dans Supabase SQL Editor
-- ============================================================

-- Champs pro (optionnels — remplis uniquement si le client est une entreprise)
alter table clients add column if not exists siret text;
alter table clients add column if not exists societe text;

-- Type de client, déduit automatiquement de la présence d'un SIRET/société
alter table clients add column if not exists type_client text not null default 'particulier'
  check (type_client in ('particulier','professionnel'));

-- Index pour filtrer facilement dans l'admin
create index if not exists idx_clients_type_client on clients(type_client);
