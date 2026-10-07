-- Sauvegarde des configurations avant tout nettoyage automatique (outil « Contrôler les doublons »)
create table if not exists configs_sdb_sauvegardes (
  id uuid primary key default gen_random_uuid(),
  config_id uuid not null,
  raw_config jsonb,
  elements jsonb,
  nb_tablettes int, nb_separateurs int, nb_portes int, nb_tiroirs int,
  motif text,
  saved_by text,
  saved_at timestamptz not null default now()
);
create index if not exists configs_sdb_sauvegardes_cfg_idx on configs_sdb_sauvegardes (config_id, saved_at desc);
alter table configs_sdb_sauvegardes enable row level security;
drop policy if exists "Admin sauvegardes" on configs_sdb_sauvegardes;
create policy "Admin sauvegardes" on configs_sdb_sauvegardes for all
  using (auth.jwt()->>'email' in ('quentin.joubert@icloud.com','pascal@symetry.fr','lena@symetry.fr','mathilde@symetry.fr','armelle@symetry.fr'))
  with check (auth.jwt()->>'email' in ('quentin.joubert@icloud.com','pascal@symetry.fr','lena@symetry.fr','mathilde@symetry.fr','armelle@symetry.fr'));
