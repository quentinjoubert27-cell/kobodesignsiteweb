-- ═══════════════════════════════════════════════════
-- STORAGE BUCKET + RLS POLICIES pour documents-client
-- À exécuter dans Supabase SQL Editor
-- ═══════════════════════════════════════════════════

-- 1. Créer le bucket s'il n'existe pas (privé)
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents-client', 'documents-client', false)
ON CONFLICT (id) DO NOTHING;

-- 2. Supprimer les anciennes policies si elles existent
DROP POLICY IF EXISTS "Admin full access storage" ON storage.objects;
DROP POLICY IF EXISTS "Clients can upload" ON storage.objects;
DROP POLICY IF EXISTS "Clients can read own docs" ON storage.objects;
DROP POLICY IF EXISTS "Clients can delete own docs" ON storage.objects;

-- 3. Admin : accès total au bucket
CREATE POLICY "Admin full access storage" ON storage.objects
  FOR ALL USING (
    bucket_id = 'documents-client' AND
    auth.jwt() ->> 'email' = 'quentin.joubert@icloud.com'
  );

-- 4. Clients authentifiés : peuvent uploader
CREATE POLICY "Clients can upload" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'documents-client' AND
    auth.role() = 'authenticated'
  );

-- 5. Clients authentifiés : peuvent lire (pour signed URLs)
CREATE POLICY "Clients can read own docs" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'documents-client' AND
    auth.role() = 'authenticated'
  );

-- ── TABLE DOCUMENTS ──────────────────────────────────
-- RLS pour que les clients voient seulement leurs docs
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin full access documents" ON documents;
DROP POLICY IF EXISTS "Clients read own documents" ON documents;
DROP POLICY IF EXISTS "Clients insert own documents" ON documents;

CREATE POLICY "Admin full access documents" ON documents
  FOR ALL USING (auth.jwt() ->> 'email' = 'quentin.joubert@icloud.com');

CREATE POLICY "Clients read own documents" ON documents
  FOR SELECT USING (
    projet_id IN (
      SELECT id FROM projets WHERE client_id = auth.uid()
    )
  );

CREATE POLICY "Clients insert own documents" ON documents
  FOR INSERT WITH CHECK (
    projet_id IN (
      SELECT id FROM projets WHERE client_id = auth.uid()
    )
  );
