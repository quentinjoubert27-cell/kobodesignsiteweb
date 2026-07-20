-- ============================================================
-- KOBO DESIGN — Migration : type + projet_id sur configs
-- À exécuter dans Supabase SQL Editor
-- ============================================================

-- Colonne type sur configs_sdb (biblio, tv, dressing, sdb)
alter table configs_sdb add column if not exists type text not null default 'sdb';

-- Lien vers le projet créé automatiquement
alter table configs_sdb    add column if not exists projet_id uuid references projets(id) on delete set null;
alter table configs_biblio add column if not exists projet_id uuid references projets(id) on delete set null;

-- Index
create index if not exists idx_configs_sdb_type      on configs_sdb(type);
create index if not exists idx_configs_sdb_projet_id  on configs_sdb(projet_id);
create index if not exists idx_configs_biblio_projet_id on configs_biblio(projet_id);
