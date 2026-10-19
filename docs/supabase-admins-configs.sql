-- Tous les administrateurs voient et modifient les configurations de meubles (donc les prix et le tableau de calcul),
-- les sauvegardes, les réglages concours et les statistiques. Les règles s'ajoutent aux anciennes : rien n'est supprimé.
do $$
declare admins text[] := array['quentin.joubert@icloud.com','pascal@symetry.fr','lena@symetry.fr','mathilde@symetry.fr','armelle@symetry.fr'];
        t text;
begin
  foreach t in array array['configs_sdb','configs_biblio','configs_sdb_sauvegardes','concours_settings','concours_leads','page_views','audit_logs'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table %I enable row level security', t);
      execute format('drop policy if exists "Admins accès total %s" on %I', t, t);
      execute format('create policy "Admins accès total %s" on %I for all using ((auth.jwt()->>''email'') = any (%L)) with check ((auth.jwt()->>''email'') = any (%L))', t, t, admins, admins);
    end if;
  end loop;
end $$;
