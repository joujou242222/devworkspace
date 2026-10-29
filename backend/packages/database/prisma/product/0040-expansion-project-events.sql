-- Resolve content-free file/access lifecycle invalidations through actual project ancestry.
GRANT CREATE ON SCHEMA public TO dw2_communications;
SET LOCAL ROLE dw2_communications;
CREATE OR REPLACE FUNCTION public.capture_expansion_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.resource_id IS NULL THEN
  SELECT project_id,id,revision INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.discussion WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id;
  IF NEW.resource_id IS NOT NULL THEN NEW.resource_kind:='DISCUSSION'; END IF;
 END IF;
 IF NEW.resource_id IS NULL THEN
  SELECT project_id,id,revision INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.document WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id;
  IF NEW.resource_id IS NOT NULL THEN NEW.resource_kind:='DOCUMENT'; END IF;
 END IF;
 IF NEW.resource_id IS NULL THEN
  SELECT project_id,id,revision INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.client_update WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id;
  IF NEW.resource_id IS NOT NULL THEN NEW.resource_kind:='UPDATE'; END IF;
 END IF;
 IF NEW.resource_id IS NULL THEN
  SELECT project_id,project_id,revision INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.deliverable WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id;
  IF NEW.resource_id IS NULL THEN SELECT project_id,project_id,revision INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.project_file WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id; END IF;
  IF NEW.resource_id IS NULL THEN SELECT project_id,project_id,revision INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.project_folder WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id; END IF;
  IF NEW.resource_id IS NOT NULL THEN NEW.resource_kind:='PROJECT'; END IF;
 END IF;
 IF NEW.resource_id IS NULL THEN
  SELECT project_id,project_id,1 INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.project_upload WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id;
  IF NEW.resource_id IS NULL THEN SELECT project_id,project_id,revision INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.project_membership WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id; END IF;
  IF NEW.resource_id IS NULL THEN SELECT project_id,project_id,revision INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.client_project_access WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id; END IF;
  IF NEW.resource_id IS NOT NULL THEN NEW.resource_kind:='PROJECT'; END IF;
 END IF;
 RETURN NEW;
END $$;

SET LOCAL ROLE dw2_owner;
REVOKE CREATE ON SCHEMA public FROM dw2_communications;
