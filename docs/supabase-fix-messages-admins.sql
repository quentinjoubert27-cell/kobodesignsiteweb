-- Messagerie admin : autorise tous les administrateurs (pas seulement quentin.joubert@icloud.com)
drop policy if exists "Admin accès total messages_general" on messages_general;
create policy "Admin accès total messages_general" on messages_general for all
  using (auth.jwt()->>'email' in ('quentin.joubert@icloud.com','pascal@symetry.fr','lena@symetry.fr','mathilde@symetry.fr','armelle@symetry.fr'))
  with check (auth.jwt()->>'email' in ('quentin.joubert@icloud.com','pascal@symetry.fr','lena@symetry.fr','mathilde@symetry.fr','armelle@symetry.fr'));
