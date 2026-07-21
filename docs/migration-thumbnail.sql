-- Ajouter colonne thumbnail (data URL base64 JPEG) aux deux tables de config
alter table configs_sdb     add column if not exists thumbnail text;
alter table configs_biblio  add column if not exists thumbnail text;

-- Sauvegarder la config brute pour pouvoir reconstruire le lien configurateur
alter table configs_sdb add column if not exists raw_config jsonb;
