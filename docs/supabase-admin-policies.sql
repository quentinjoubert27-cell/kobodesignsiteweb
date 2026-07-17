-- ============================================================
-- KOBO DESIGN — Policies admin (à exécuter après supabase-setup.sql)
-- Remplace 'quentin.joubert@icloud.com' si besoin
-- ============================================================

-- Clients
create policy "Admin accès total clients" on clients for all
  using ((auth.jwt() ->> 'email') = 'quentin.joubert@icloud.com')
  with check ((auth.jwt() ->> 'email') = 'quentin.joubert@icloud.com');

-- Projets
create policy "Admin accès total projets" on projets for all
  using ((auth.jwt() ->> 'email') = 'quentin.joubert@icloud.com')
  with check ((auth.jwt() ->> 'email') = 'quentin.joubert@icloud.com');

-- Messages
create policy "Admin accès total messages" on messages for all
  using ((auth.jwt() ->> 'email') = 'quentin.joubert@icloud.com')
  with check ((auth.jwt() ->> 'email') = 'quentin.joubert@icloud.com');

-- Documents
create policy "Admin accès total documents" on documents for all
  using ((auth.jwt() ->> 'email') = 'quentin.joubert@icloud.com')
  with check ((auth.jwt() ->> 'email') = 'quentin.joubert@icloud.com');

-- Storage bucket policies (à créer dans Storage > Policies)
-- Bucket : documents-client
-- Policy 1 — Admin peut tout faire :
--   (auth.jwt() ->> 'email') = 'quentin.joubert@icloud.com'
-- Policy 2 — Client voit son dossier :
--   auth.uid()::text = (storage.foldername(name))[1]
