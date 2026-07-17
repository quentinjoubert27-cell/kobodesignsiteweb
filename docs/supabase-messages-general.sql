-- ============================================================
-- KOBO DESIGN — Messagerie générale (client ↔ Kobo)
-- À exécuter dans Supabase SQL Editor
-- ============================================================

create table if not exists messages_general (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references auth.users(id) on delete cascade,
  expediteur  text not null check (expediteur in ('client','admin')),
  contenu     text not null,
  lu          boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table messages_general enable row level security;

-- Le client voit et envoie uniquement ses propres messages
create policy "Client lit ses messages" on messages_general for select
  using (auth.uid() = client_id);

create policy "Client envoie un message" on messages_general for insert
  with check (auth.uid() = client_id and expediteur = 'client');

create policy "Client marque comme lu" on messages_general for update
  using (auth.uid() = client_id);

-- Admin accès total
create policy "Admin accès total messages_general" on messages_general for all
  using ((auth.jwt() ->> 'email') = 'quentin.joubert@icloud.com')
  with check ((auth.jwt() ->> 'email') = 'quentin.joubert@icloud.com');

-- Index pour les performances
create index if not exists idx_messages_general_client_id on messages_general(client_id);
create index if not exists idx_messages_general_created_at on messages_general(created_at);
