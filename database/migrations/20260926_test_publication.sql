BEGIN;
ALTER TABLE tests ADD COLUMN IF NOT EXISTS publication_status VARCHAR(20);
UPDATE tests SET publication_status=CASE WHEN is_active THEN 'published' ELSE 'draft' END WHERE publication_status IS NULL;
ALTER TABLE tests ALTER COLUMN publication_status SET NOT NULL;
CREATE OR REPLACE FUNCTION sync_test_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.publication_status := COALESCE(NEW.publication_status,CASE WHEN NEW.is_active THEN 'published' ELSE 'draft' END);
  ELSIF NEW.publication_status IS NOT DISTINCT FROM OLD.publication_status AND NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    NEW.publication_status := CASE WHEN NEW.is_active THEN 'published' ELSE 'draft' END;
  END IF;
  IF NEW.publication_status IS NULL OR NEW.publication_status NOT IN ('draft','published','unpublished') THEN
    RAISE EXCEPTION 'Invalid publication status' USING ERRCODE='23514';
  END IF;
  NEW.is_active := NEW.publication_status='published';
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tests_publication_sync ON tests;
CREATE TRIGGER tests_publication_sync BEFORE INSERT OR UPDATE ON tests FOR EACH ROW EXECUTE FUNCTION sync_test_publication();
COMMIT;
