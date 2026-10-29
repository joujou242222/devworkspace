-- Phase 4: private project file ancestry; no existing rows are rewritten.
CREATE TABLE public.project_folder (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100), position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,project_id,id), FOREIGN KEY(organization_id,project_id) REFERENCES public.project(organization_id,id)
);
CREATE UNIQUE INDEX project_folder_name ON public.project_folder(organization_id,project_id,lower(btrim(name)));
CREATE TABLE public.project_upload (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL,
 initiator_id text NOT NULL REFERENCES public.identity_user(id), purpose text NOT NULL CHECK(purpose IN ('PROJECT_FILE','DELIVERABLE')),
 folder_id uuid, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200), staging_key text UNIQUE NOT NULL,
 expected_size integer NOT NULL CHECK(expected_size BETWEEN 1 AND 26214400), expected_digest text NOT NULL CHECK(expected_digest ~ '^[a-f0-9]{64}$'),
 mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg','application/pdf')), expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
 status text NOT NULL DEFAULT 'ISSUED' CHECK(status IN ('ISSUED','UPLOADED','PROCESSING','READY','EXPIRED','REJECTED','FAILED')),
 error_code text, attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5), revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES public.project(organization_id,id),
 FOREIGN KEY(organization_id,project_id,folder_id) REFERENCES public.project_folder(organization_id,project_id,id)
);
CREATE TABLE public.file_asset (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL, upload_id uuid UNIQUE NOT NULL,
 canonical_key text UNIQUE NOT NULL, storage_version text NOT NULL CHECK(length(storage_version)>0), digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'), byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 26214400),
 mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg','application/pdf')), width integer, height integer, pages integer CHECK(pages BETWEEN 1 AND 100),
 tool_version text NOT NULL, ready_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id,upload_id) REFERENCES public.project_upload(organization_id,project_id,id)
);
CREATE TABLE public.file_access (
 organization_id uuid NOT NULL, project_id uuid NOT NULL, asset_id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE','BLOCKED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), FOREIGN KEY(organization_id,project_id,asset_id) REFERENCES public.file_asset(organization_id,project_id,id)
);
CREATE TABLE public.file_preview (
 organization_id uuid NOT NULL, project_id uuid NOT NULL, asset_id uuid NOT NULL, page integer NOT NULL CHECK(page BETWEEN 1 AND 100),
 object_key text UNIQUE NOT NULL, storage_version text NOT NULL CHECK(length(storage_version)>0), digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'), width integer NOT NULL CHECK(width>0), height integer NOT NULL CHECK(height>0),
 PRIMARY KEY(asset_id,page), FOREIGN KEY(organization_id,project_id,asset_id) REFERENCES public.file_asset(organization_id,project_id,id)
);
CREATE TABLE public.project_file (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, asset_id uuid NOT NULL UNIQUE, folder_id uuid,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200), status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,project_id,id), FOREIGN KEY(organization_id,project_id,asset_id) REFERENCES public.file_asset(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id,folder_id) REFERENCES public.project_folder(organization_id,project_id,id)
);
CREATE TABLE public.deliverable (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, task_id uuid,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200), description text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
 latest_version_id uuid, next_version integer NOT NULL DEFAULT 1 CHECK(next_version>0), revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES public.project(organization_id,id),
 FOREIGN KEY(organization_id,project_id,task_id) REFERENCES public.task(organization_id,project_id,id)
);
CREATE TABLE public.deliverable_version (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, deliverable_id uuid NOT NULL,
 version_number integer NOT NULL CHECK(version_number>0), asset_id uuid NOT NULL UNIQUE, digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 byte_size integer NOT NULL CHECK(byte_size>0), mime text NOT NULL, creator_id text NOT NULL REFERENCES public.identity_user(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,project_id,deliverable_id,id), UNIQUE(organization_id,deliverable_id,version_number),
 FOREIGN KEY(organization_id,project_id,deliverable_id) REFERENCES public.deliverable(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id,asset_id) REFERENCES public.file_asset(organization_id,project_id,id)
);
ALTER TABLE public.deliverable ADD FOREIGN KEY(organization_id,project_id,id,latest_version_id) REFERENCES public.deliverable_version(organization_id,project_id,deliverable_id,id);

CREATE FUNCTION public.file_parent_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.organization_id<>OLD.organization_id OR NEW.project_id<>OLD.project_id OR NEW.id<>OLD.id THEN RAISE EXCEPTION 'immutable ancestry' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION public.file_immutable_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 RAISE EXCEPTION 'immutable file identity' USING ERRCODE='23514';
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['project_folder','project_upload','file_asset','file_access','file_preview','project_file','deliverable','deliverable_version'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON public.%I USING(organization_id=public.tenant_id()) WITH CHECK(organization_id=public.tenant_id())',t);
  EXECUTE format('GRANT SELECT ON public.%I TO dw2_api',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['project_folder','project_upload','project_file','deliverable'] LOOP
  EXECUTE format('GRANT INSERT,UPDATE ON public.%I TO dw2_api',t);
  EXECUTE format('CREATE TRIGGER file_parent_guard BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.file_parent_guard()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['file_asset','file_preview','deliverable_version'] LOOP
  EXECUTE format('CREATE TRIGGER file_immutable_guard BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.file_immutable_guard()',t);
 END LOOP;
END $$;
GRANT DELETE ON public.project_folder TO dw2_api;
GRANT INSERT ON public.deliverable_version TO dw2_api;
REVOKE ALL ON FUNCTION public.file_parent_guard(),public.file_immutable_guard() FROM PUBLIC;
