-- ============================================================
-- KOBO DESIGN — Migration : prix du devis stockés par projet
-- À exécuter dans Supabase SQL Editor
-- ============================================================

-- Prix unitaires saisis manuellement pour CE projet (pas un tarif global)
alter table projets add column if not exists devis_prices jsonb;
