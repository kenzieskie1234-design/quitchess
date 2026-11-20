-- Quiet Move Chess profile-photo Storage repair.
-- Run this complete file in Supabase SQL Editor, then press Run.
-- Current app uses browser-generated player IDs, so upload access is permissive for prototype use.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('profile-photos','profile-photos',true,2097152,
        ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Profile photos are publicly viewable" ON storage.objects;
DROP POLICY IF EXISTS "Players can upload own profile photo" ON storage.objects;
DROP POLICY IF EXISTS "Players can update profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Players can delete profile photos" ON storage.objects;

CREATE POLICY "Profile photos are publicly viewable"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'profile-photos');

CREATE POLICY "Players can upload own profile photo"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (bucket_id = 'profile-photos');

CREATE POLICY "Players can update profile photos"
ON storage.objects FOR UPDATE TO anon, authenticated
USING (bucket_id = 'profile-photos')
WITH CHECK (bucket_id = 'profile-photos');

CREATE POLICY "Players can delete profile photos"
ON storage.objects FOR DELETE TO anon, authenticated
USING (bucket_id = 'profile-photos');

GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated;

SELECT id, name, public, file_size_limit
FROM storage.buckets WHERE id = 'profile-photos';
