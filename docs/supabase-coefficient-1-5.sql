-- Coefficient de revente à 1,5 (prix de vente = coût de revient × 1,5)
-- À exécuter une fois dans Supabase SQL Editor. Équivalent : Admin → Matériaux & Prix → « Coefficient de vente ».
-- Tous les devis lisent ce réglage global : les projets existants se recalculent à l'ouverture.
insert into tarifs_globaux (id, prices) values (1, jsonb_build_object('coefficient_revente', 1.5))
on conflict (id) do update set prices = jsonb_set(coalesce(tarifs_globaux.prices, '{}'::jsonb), '{coefficient_revente}', '1.5'::jsonb), updated_at = now();
