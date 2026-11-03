-- ============================================================
-- KOBO DESIGN — Campagnes d'e-mails (groupes ciblés, historique, désinscription)
-- À exécuter une fois dans Supabase SQL Editor (re-lançable sans risque)
-- ============================================================

-- Adresses qui ne veulent plus recevoir de campagnes (lien « Se désinscrire » des mails)
create table if not exists newsletter_desinscrits (
  email      text primary key,
  created_at timestamptz not null default now()
);

-- Groupes enregistrés (« Prix envoyé il y a plus de 15 jours », etc.)
create table if not exists newsletter_segments (
  id         uuid primary key default gen_random_uuid(),
  nom        text not null,
  filtres    jsonb not null default '{}',
  created_by text,
  created_at timestamptz not null default now()
);

-- Une ligne par campagne envoyée
create table if not exists newsletter_campagnes (
  id               uuid primary key default gen_random_uuid(),
  sujet            text not null,
  message          text not null,
  filtres          jsonb not null default '{}',
  nb_destinataires int not null default 0,
  nb_envoyes       int not null default 0,
  envoye_par       text,
  created_at       timestamptz not null default now()
);

-- Une ligne par destinataire et par campagne (« déjà reçu le … » dans les listes)
create table if not exists newsletter_envois (
  id          uuid primary key default gen_random_uuid(),
  campagne_id uuid not null references newsletter_campagnes(id) on delete cascade,
  email       text not null,
  client_id   uuid,
  statut      text not null default 'envoye',   -- envoye | echec
  created_at  timestamptz not null default now()
);
create index if not exists idx_newsletter_envois_email on newsletter_envois(email, created_at desc);

alter table newsletter_desinscrits enable row level security;
alter table newsletter_segments enable row level security;
alter table newsletter_campagnes enable row level security;
alter table newsletter_envois enable row level security;

do $$
declare
  admins text[] := array['quentin.joubert@icloud.com','pascal@symetry.fr','lena@symetry.fr','mathilde@symetry.fr','armelle@symetry.fr'];
  t text;
begin
  foreach t in array array['newsletter_desinscrits','newsletter_segments','newsletter_campagnes','newsletter_envois'] loop
    execute format('drop policy if exists "Admins accès total" on %I', t);
    execute format('create policy "Admins accès total" on %I for all using ((auth.jwt()->>''email'') = any (%L)) with check ((auth.jwt()->>''email'') = any (%L))', t, admins, admins);
  end loop;
end $$;
