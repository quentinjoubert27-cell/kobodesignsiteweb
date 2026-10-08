-- Tous les administrateurs peuvent lire/écrire les documents, projets, clients, messages et le stockage des documents.
-- (les règles existantes ne concernaient que quentin.joubert@icloud.com ; les règles s'additionnent, rien n'est supprimé)
do $$
declare admins text[] := array['quentin.joubert@icloud.com','pascal@symetry.fr','lena@symetry.fr','mathilde@symetry.fr','armelle@symetry.fr'];
begin
  execute 'drop policy if exists "Admins accès total documents" on documents';
  execute format('create policy "Admins accès total documents" on documents for all using ((auth.jwt()->>''email'') = any (%L)) with check ((auth.jwt()->>''email'') = any (%L))', admins, admins);
  execute 'drop policy if exists "Admins accès total projets" on projets';
  execute format('create policy "Admins accès total projets" on projets for all using ((auth.jwt()->>''email'') = any (%L)) with check ((auth.jwt()->>''email'') = any (%L))', admins, admins);
  execute 'drop policy if exists "Admins accès total clients" on clients';
  execute format('create policy "Admins accès total clients" on clients for all using ((auth.jwt()->>''email'') = any (%L)) with check ((auth.jwt()->>''email'') = any (%L))', admins, admins);
  execute 'drop policy if exists "Admins accès total messages" on messages';
  execute format('create policy "Admins accès total messages" on messages for all using ((auth.jwt()->>''email'') = any (%L)) with check ((auth.jwt()->>''email'') = any (%L))', admins, admins);
  execute 'drop policy if exists "Admins accès total stockage documents" on storage.objects';
  execute format('create policy "Admins accès total stockage documents" on storage.objects for all using (bucket_id = ''documents-client'' and (auth.jwt()->>''email'') = any (%L)) with check (bucket_id = ''documents-client'' and (auth.jwt()->>''email'') = any (%L))', admins, admins);
end $$;
