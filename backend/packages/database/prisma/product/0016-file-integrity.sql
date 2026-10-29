-- Forward hardening; applied migrations 0013-0015 remain unchanged.
ALTER TABLE public.project_upload DROP CONSTRAINT project_upload_organization_id_project_id_folder_id_fkey;
ALTER TABLE public.project_upload ADD CONSTRAINT project_upload_folder_scope
 FOREIGN KEY(organization_id,project_id,folder_id) REFERENCES public.project_folder(organization_id,project_id,id) ON DELETE SET NULL(folder_id);
CREATE OR REPLACE FUNCTION public.upload_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 -- Clear a historical grouping hint only; canonical identity remains fixed.
 IF TG_TABLE_NAME='project_upload' AND to_jsonb(NEW)->>'folder_id' IS NULL AND to_jsonb(OLD)->>'folder_id' IS NOT NULL
 AND (to_jsonb(NEW)-'folder_id')=(to_jsonb(OLD)-'folder_id') THEN RETURN NEW; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','error_code','attempts','revision','updated_at'])<>(to_jsonb(OLD)-ARRAY['status','error_code','attempts','revision','updated_at']) THEN RAISE EXCEPTION 'immutable upload identity' USING ERRCODE='23514'; END IF;
 IF OLD.status IN ('READY','REJECTED','EXPIRED') THEN RAISE EXCEPTION 'terminal upload' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.project_file_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.asset_id<>OLD.asset_id THEN RAISE EXCEPTION 'immutable listing source' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_file_identity BEFORE UPDATE ON public.project_file FOR EACH ROW EXECUTE FUNCTION public.project_file_identity_guard();
REVOKE ALL ON FUNCTION public.project_file_identity_guard() FROM PUBLIC;
CREATE INDEX project_file_scope ON public.project_file(organization_id,project_id,folder_id,status,id);
CREATE INDEX project_upload_scope ON public.project_upload(organization_id,project_id,id);
CREATE INDEX deliverable_scope ON public.deliverable(organization_id,project_id,id);
