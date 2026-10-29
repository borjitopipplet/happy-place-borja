-- ============================================================
-- V2 : une idée peut aussi avoir une image (PNG ou JPG) en pièce jointe
-- ============================================================
-- Toujours une seule pièce jointe par idée, 20 Mo maximum.

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['application/pdf', 'image/png', 'image/jpeg']
 WHERE id = 'submission-attachments';

DROP POLICY IF EXISTS "Allowed users upload own submission PDF" ON storage.objects;
DROP POLICY IF EXISTS "Allowed users upload own submission file" ON storage.objects;
CREATE POLICY "Allowed users upload own submission file"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'submission-attachments'
    AND private.is_allowed()
    AND (storage.foldername(name))[1] = (auth.uid())::text
    AND lower(storage.extension(name)) = ANY (ARRAY['pdf', 'png', 'jpg', 'jpeg'])
  );
