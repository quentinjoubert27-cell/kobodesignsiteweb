-- ============================================================
-- KOBO DESIGN — Migration : table des tarifs unitaires (devis)
-- À exécuter dans Supabase SQL Editor
-- ============================================================

create table if not exists tarifs (
  id int primary key default 1,
  panel_m2 jsonb not null default '{}'::jsonb,      -- { "Chêne": 45, "Noyer": 60, ... }
  edge_banding_ml numeric not null default 0,
  screw_unit numeric not null default 0,
  hinge_unit numeric not null default 0,
  drawer_mechanism_unit numeric not null default 0,
  corner_bracket_unit numeric not null default 0,
  coefficient_revente numeric not null default 2,
  updated_at timestamptz default now(),
  constraint single_row check (id = 1)
);

-- Ligne unique par défaut
insert into tarifs (id) values (1) on conflict (id) do nothing;

alter table tarifs enable row level security;
-- Lecture/écriture réservée au service role (admin) — aucune policy publique
