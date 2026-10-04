-- Renomme les anciens projets "Meuble TV sur mesure, ..." en "Meuble sur mesure, ..."
update projets
set nom = replace(nom, 'Meuble TV sur mesure', 'Meuble sur mesure')
where nom like '%Meuble TV sur mesure%';

-- Vérification : doit retourner 0 ligne
select id, nom from projets where nom ilike '%meuble tv%';
