-- ============================================================
-- KOBO DESIGN — Migration : tarifs matériaux globaux (base de prix)
-- À exécuter dans Supabase SQL Editor
-- ============================================================

-- Une seule ligne (id=1) contenant tous les prix par défaut, réutilisés
-- automatiquement sur chaque nouveau devis. Chaque projet peut toujours
-- surcharger un prix ponctuellement (stocké dans projets.devis_prices).
create table if not exists tarifs_globaux (
  id smallint primary key default 1,
  prices jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint tarifs_globaux_singleton check (id = 1)
);

insert into tarifs_globaux (id, prices)
values (1, '{}'::jsonb)
on conflict (id) do nothing;

-- RLS : sans policy, Supabase bloque silencieusement l'écriture (pas d'erreur JS levée,
-- juste rien d'enregistré) — même pattern que les autres tables admin.
alter table tarifs_globaux enable row level security;

create policy "Admin accès total tarifs_globaux" on tarifs_globaux for all
  using ((auth.jwt() ->> 'email') = 'quentin.joubert@icloud.com')
  with check ((auth.jwt() ->> 'email') = 'quentin.joubert@icloud.com');
