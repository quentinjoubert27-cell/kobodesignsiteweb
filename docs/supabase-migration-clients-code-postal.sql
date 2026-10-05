-- Code postal sur la fiche client (affiché dans l'admin)
alter table clients add column if not exists code_postal text;

-- Récupère les codes postaux déjà saisis par les clients (configurateur puis formulaire de contact)
do $$ begin
  update clients c set code_postal = x.cp
  from (select distinct on (lower(email)) lower(email) as e, code_postal as cp
        from configs_sdb where code_postal is not null and code_postal <> ''
        order by lower(email), created_at desc) x
  where lower(c.email) = x.e and c.code_postal is null;
exception when others then raise notice 'configs_sdb ignoré: %', sqlerrm; end $$;

do $$ begin
  update clients c set code_postal = x.cp
  from (select distinct on (lower(email)) lower(email) as e, code_postal as cp
        from demandes where code_postal is not null and code_postal <> ''
        order by lower(email), created_at desc) x
  where lower(c.email) = x.e and c.code_postal is null;
exception when others then raise notice 'demandes ignoré: %', sqlerrm; end $$;
