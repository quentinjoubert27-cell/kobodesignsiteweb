-- ============================================================
-- KOBO DESIGN — Migration : commandes + notices
-- À exécuter dans Supabase SQL Editor
-- ============================================================

-- Colonnes commandes sur projets
alter table projets add column if not exists montant numeric(10,2);
alter table projets add column if not exists date_livraison date;

-- Colonne categorie sur documents ('document' par défaut, 'notice' pour les notices de montage)
alter table documents add column if not exists categorie text not null default 'document'
  check (categorie in ('document','notice'));
