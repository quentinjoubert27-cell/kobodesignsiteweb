-- ============================================================
-- KOBO DESIGN — Migration : leads du jeu concours (popup site)
-- À exécuter dans Supabase SQL Editor
-- ============================================================

-- Le jeu concours se joue sur Instagram. Ce popup sur le site capte les visiteurs
-- qui viennent voir le site suite au concours : "inscris-toi ici pour une chance
-- supplémentaire de gagner" — nom + email, stockés ici.
create table if not exists concours_leads (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  email text not null,
  source_page text,             -- page sur laquelle le popup a été rempli
  newsletter_consent boolean not null default false, -- case à cocher explicite (RGPD)
  created_at timestamptz not null default now()
);

-- Si la table existait déjà sans cette colonne (migration lancée avant cet ajout) :
alter table concours_leads add column if not exists newsletter_consent boolean not null default false;

-- RLS : écriture ouverte à tous (visiteurs anonymes du site, c'est le but du
-- formulaire), lecture réservée aux 4 emails admin (mêmes que admin.html).
alter table concours_leads enable row level security;

create policy "Inscription publique concours_leads" on concours_leads for insert
  with check (true);

create policy "Lecture admin concours_leads" on concours_leads for select
  using (auth.jwt()->>'email' in (
    'quentin.joubert@icloud.com', 'pascal@symetry.fr', 'lena@symetry.fr', 'mathilde@symetry.fr'
  ));

-- ── Réglage : activer/désactiver le popup depuis l'admin, sans redéploiement ──
create table if not exists concours_settings (
  id smallint primary key default 1,
  popup_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint concours_settings_singleton check (id = 1)
);

insert into concours_settings (id, popup_enabled) values (1, false) on conflict (id) do nothing;

alter table concours_settings enable row level security;

-- Lecture publique (le site doit pouvoir savoir si le popup est actif, y compris
-- pour un visiteur anonyme), écriture réservée aux admins.
create policy "Lecture publique concours_settings" on concours_settings for select
  using (true);

create policy "Ecriture admin concours_settings" on concours_settings for update
  using (auth.jwt()->>'email' in (
    'quentin.joubert@icloud.com', 'pascal@symetry.fr', 'lena@symetry.fr', 'mathilde@symetry.fr'
  ))
  with check (auth.jwt()->>'email' in (
    'quentin.joubert@icloud.com', 'pascal@symetry.fr', 'lena@symetry.fr', 'mathilde@symetry.fr'
  ));
