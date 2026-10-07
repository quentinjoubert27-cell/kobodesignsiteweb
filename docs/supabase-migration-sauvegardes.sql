-- Sauvegarde des configurations avant tout nettoyage/correction automatique (admin)
-- Script RE-LANÇABLE : crée la table si besoin ET complète les colonnes manquantes si elle existait déjà.
create table if not exists configs_sdb_sauvegardes (
  id uuid primary key default gen_random_uuid(),
  config_id text
);
-- l'identifiant d'une configuration est un nombre (ex. 56) : on le stocke en texte, valable pour tout type d'identifiant
alter table configs_sdb_sauvegardes add column if not exists config_id text;
alter table configs_sdb_sauvegardes alter column config_id type text using config_id::text;
alter table configs_sdb_sauvegardes add column if not exists raw_config jsonb;
alter table configs_sdb_sauvegardes add column if not exists elements jsonb;
alter table configs_sdb_sauvegardes add column if not exists nb_tablettes int;
alter table configs_sdb_sauvegardes add column if not exists nb_separateurs int;
alter table configs_sdb_sauvegardes add column if not exists nb_portes int;
alter table configs_sdb_sauvegardes add column if not exists nb_tiroirs int;
alter table configs_sdb_sauvegardes add column if not exists motif text;
alter table configs_sdb_sauvegardes add column if not exists saved_by text;
alter table configs_sdb_sauvegardes add column if not exists saved_at timestamptz not null default now();
create index if not exists configs_sdb_sauvegardes_cfg_idx on configs_sdb_sauvegardes (config_id, saved_at desc);

alter table configs_sdb_sauvegardes enable row level security;
drop policy if exists "Admin sauvegardes" on configs_sdb_sauvegardes;
create policy "Admin sauvegardes" on configs_sdb_sauvegardes for all
  using (auth.jwt()->>'email' in ('quentin.joubert@icloud.com','pascal@symetry.fr','lena@symetry.fr','mathilde@symetry.fr','armelle@symetry.fr'))
  with check (auth.jwt()->>'email' in ('quentin.joubert@icloud.com','pascal@symetry.fr','lena@symetry.fr','mathilde@symetry.fr','armelle@symetry.fr'));

-- force Supabase à relire la structure des tables (évite les erreurs 400 « colonne introuvable »)
notify pgrst, 'reload schema';
