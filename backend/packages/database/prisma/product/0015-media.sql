-- Phase 4 separate owner-scoped branding/profile media. No nullable-tenant project assets.
GRANT CREATE ON SCHEMA public TO dw2_dispatch_owner;
CREATE FUNCTION public.profile_user_id() RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ SELECT nullif(current_setting('app.profile_user_id',true),'') $$;
REVOKE ALL ON FUNCTION public.profile_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_user_id() TO dw2_identity,dw2_dispatch_owner;
CREATE TABLE public.logo_upload (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organization(id), initiator_id text NOT NULL REFERENCES public.identity_user(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200), staging_key text UNIQUE NOT NULL,
 expected_size integer NOT NULL CHECK(expected_size BETWEEN 1 AND 2097152), expected_digest text NOT NULL CHECK(expected_digest ~ '^[a-f0-9]{64}$'), mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg')),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',status text NOT NULL DEFAULT 'ISSUED' CHECK(status IN ('ISSUED','UPLOADED','PROCESSING','READY','EXPIRED','REJECTED','FAILED')),
 error_code text,attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,id)
);
CREATE TABLE public.logo_asset (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,upload_id uuid UNIQUE NOT NULL,canonical_key text UNIQUE NOT NULL,storage_version text NOT NULL CHECK(length(storage_version)>0),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 2097152),mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg')),
 preview_key text UNIQUE NOT NULL,preview_version text NOT NULL CHECK(length(preview_version)>0),preview_digest text NOT NULL CHECK(preview_digest ~ '^[a-f0-9]{64}$'),width integer NOT NULL CHECK(width>0),height integer NOT NULL CHECK(height>0),tool_version text NOT NULL,ready_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,upload_id) REFERENCES public.logo_upload(organization_id,id)
);
CREATE TABLE public.logo_access (
 organization_id uuid NOT NULL,asset_id uuid PRIMARY KEY,status text NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE','BLOCKED')),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 FOREIGN KEY(organization_id,asset_id) REFERENCES public.logo_asset(organization_id,id)
);
CREATE TABLE public.logo_reference (
 organization_id uuid PRIMARY KEY REFERENCES public.organization(id),asset_id uuid,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 FOREIGN KEY(organization_id,asset_id) REFERENCES public.logo_asset(organization_id,id)
);
ALTER TABLE public.logo_upload ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logo_upload FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON public.logo_upload USING(organization_id=public.tenant_id()) WITH CHECK(organization_id=public.tenant_id());
CREATE POLICY media_processor ON public.logo_upload TO dw2_dispatch_owner USING(true) WITH CHECK(true);
GRANT SELECT ON public.logo_upload TO dw2_api;
GRANT SELECT,INSERT ON public.logo_upload TO dw2_dispatch_owner;
GRANT INSERT,UPDATE ON public.logo_upload TO dw2_api;
GRANT UPDATE ON public.logo_upload TO dw2_dispatch_owner;
ALTER TABLE public.logo_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logo_asset FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON public.logo_asset USING(organization_id=public.tenant_id()) WITH CHECK(organization_id=public.tenant_id());
CREATE POLICY media_processor ON public.logo_asset TO dw2_dispatch_owner USING(true) WITH CHECK(true);
GRANT SELECT ON public.logo_asset TO dw2_api;
GRANT SELECT,INSERT ON public.logo_asset TO dw2_dispatch_owner;
CREATE TRIGGER immutable_media BEFORE UPDATE OR DELETE ON public.logo_asset FOR EACH ROW EXECUTE FUNCTION public.file_immutable_guard();
ALTER TABLE public.logo_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logo_access FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON public.logo_access USING(organization_id=public.tenant_id()) WITH CHECK(organization_id=public.tenant_id());
CREATE POLICY media_processor ON public.logo_access TO dw2_dispatch_owner USING(true) WITH CHECK(true);
GRANT SELECT ON public.logo_access TO dw2_api;
GRANT SELECT,INSERT ON public.logo_access TO dw2_dispatch_owner;
ALTER TABLE public.logo_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logo_reference FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON public.logo_reference USING(organization_id=public.tenant_id()) WITH CHECK(organization_id=public.tenant_id());
CREATE POLICY media_processor ON public.logo_reference TO dw2_dispatch_owner USING(true) WITH CHECK(true);
GRANT SELECT ON public.logo_reference TO dw2_api;
GRANT SELECT,INSERT ON public.logo_reference TO dw2_dispatch_owner;
GRANT INSERT,UPDATE ON public.logo_reference TO dw2_api;
CREATE TABLE public.profile_upload (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES public.identity_user(id), initiator_id text NOT NULL REFERENCES public.identity_user(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200), staging_key text UNIQUE NOT NULL,
 expected_size integer NOT NULL CHECK(expected_size BETWEEN 1 AND 2097152), expected_digest text NOT NULL CHECK(expected_digest ~ '^[a-f0-9]{64}$'), mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg')),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',status text NOT NULL DEFAULT 'ISSUED' CHECK(status IN ('ISSUED','UPLOADED','PROCESSING','READY','EXPIRED','REJECTED','FAILED')),
 error_code text,attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,id)
);
CREATE TABLE public.profile_asset (
 id uuid PRIMARY KEY,user_id text NOT NULL,upload_id uuid UNIQUE NOT NULL,canonical_key text UNIQUE NOT NULL,storage_version text NOT NULL CHECK(length(storage_version)>0),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 2097152),mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg')),
 preview_key text UNIQUE NOT NULL,preview_version text NOT NULL CHECK(length(preview_version)>0),preview_digest text NOT NULL CHECK(preview_digest ~ '^[a-f0-9]{64}$'),width integer NOT NULL CHECK(width>0),height integer NOT NULL CHECK(height>0),tool_version text NOT NULL,ready_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,id),
 FOREIGN KEY(user_id,upload_id) REFERENCES public.profile_upload(user_id,id)
);
CREATE TABLE public.profile_access (
 user_id text NOT NULL,asset_id uuid PRIMARY KEY,status text NOT NULL DEFAULT 'AVAILABLE' CHECK(status IN ('AVAILABLE','BLOCKED')),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 FOREIGN KEY(user_id,asset_id) REFERENCES public.profile_asset(user_id,id)
);
CREATE TABLE public.profile_reference (
 user_id text PRIMARY KEY REFERENCES public.identity_user(id),asset_id uuid,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 FOREIGN KEY(user_id,asset_id) REFERENCES public.profile_asset(user_id,id)
);
ALTER TABLE public.profile_upload ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_upload FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON public.profile_upload USING(user_id=public.profile_user_id()) WITH CHECK(user_id=public.profile_user_id());
CREATE POLICY media_processor ON public.profile_upload TO dw2_dispatch_owner USING(true) WITH CHECK(true);
GRANT SELECT ON public.profile_upload TO dw2_identity;
GRANT SELECT,INSERT ON public.profile_upload TO dw2_dispatch_owner;
GRANT INSERT,UPDATE ON public.profile_upload TO dw2_identity;
GRANT UPDATE ON public.profile_upload TO dw2_dispatch_owner;
ALTER TABLE public.profile_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_asset FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON public.profile_asset USING(user_id=public.profile_user_id()) WITH CHECK(user_id=public.profile_user_id());
CREATE POLICY media_processor ON public.profile_asset TO dw2_dispatch_owner USING(true) WITH CHECK(true);
GRANT SELECT ON public.profile_asset TO dw2_identity;
GRANT SELECT,INSERT ON public.profile_asset TO dw2_dispatch_owner;
CREATE TRIGGER immutable_media BEFORE UPDATE OR DELETE ON public.profile_asset FOR EACH ROW EXECUTE FUNCTION public.file_immutable_guard();
ALTER TABLE public.profile_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_access FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON public.profile_access USING(user_id=public.profile_user_id()) WITH CHECK(user_id=public.profile_user_id());
CREATE POLICY media_processor ON public.profile_access TO dw2_dispatch_owner USING(true) WITH CHECK(true);
GRANT SELECT ON public.profile_access TO dw2_identity;
GRANT SELECT,INSERT ON public.profile_access TO dw2_dispatch_owner;
ALTER TABLE public.profile_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_reference FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON public.profile_reference USING(user_id=public.profile_user_id()) WITH CHECK(user_id=public.profile_user_id());
CREATE POLICY media_processor ON public.profile_reference TO dw2_dispatch_owner USING(true) WITH CHECK(true);
GRANT SELECT ON public.profile_reference TO dw2_identity;
GRANT SELECT,INSERT ON public.profile_reference TO dw2_dispatch_owner;
GRANT INSERT,UPDATE ON public.profile_reference TO dw2_identity;
CREATE FUNCTION public.upload_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF (to_jsonb(NEW)-ARRAY['status','error_code','attempts','revision','updated_at'])<>(to_jsonb(OLD)-ARRAY['status','error_code','attempts','revision','updated_at']) THEN RAISE EXCEPTION 'immutable upload identity' USING ERRCODE='23514'; END IF;
 IF OLD.status IN ('READY','REJECTED','EXPIRED') THEN RAISE EXCEPTION 'terminal upload' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_upload BEFORE UPDATE ON public.project_upload FOR EACH ROW EXECUTE FUNCTION public.upload_identity_guard();
CREATE TRIGGER immutable_upload BEFORE UPDATE ON public.logo_upload FOR EACH ROW EXECUTE FUNCTION public.upload_identity_guard();
CREATE TRIGGER immutable_upload BEFORE UPDATE ON public.profile_upload FOR EACH ROW EXECUTE FUNCTION public.upload_identity_guard();
REVOKE ALL ON FUNCTION public.upload_identity_guard() FROM PUBLIC;
CREATE TABLE public.media_job (
 id uuid PRIMARY KEY,scope text NOT NULL CHECK(scope IN ('logo','profile')),organization_id uuid,user_id text,lease uuid,lease_until timestamptz,started_lease uuid,attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 CHECK((scope='logo' AND organization_id IS NOT NULL AND user_id IS NULL) OR (scope='profile' AND user_id IS NOT NULL AND organization_id IS NULL)),
 FOREIGN KEY(organization_id,id) REFERENCES public.logo_upload(organization_id,id),FOREIGN KEY(user_id,id) REFERENCES public.profile_upload(user_id,id)
);
REVOKE ALL ON public.media_job FROM PUBLIC;
ALTER TABLE public.media_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_job FORCE ROW LEVEL SECURITY;
CREATE POLICY logo_job ON public.media_job TO dw2_api USING(scope='logo' AND organization_id=public.tenant_id()) WITH CHECK(scope='logo' AND organization_id=public.tenant_id());
CREATE POLICY profile_job ON public.media_job TO dw2_identity USING(scope='profile' AND user_id=public.profile_user_id()) WITH CHECK(scope='profile' AND user_id=public.profile_user_id());
CREATE POLICY media_job_processor ON public.media_job TO dw2_dispatch_owner USING(true) WITH CHECK(true);
GRANT INSERT,SELECT ON public.media_job TO dw2_api,dw2_identity;
GRANT UPDATE(completed_at,available_at) ON public.media_job TO dw2_api,dw2_identity;
GRANT INSERT,SELECT,UPDATE ON public.media_job TO dw2_dispatch_owner;
GRANT INSERT ON public.identity_audit,public.identity_event TO dw2_dispatch_owner;
CREATE FUNCTION public.media_job_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.scope='logo' AND NOT EXISTS(SELECT 1 FROM public.logo_upload WHERE id=NEW.id AND organization_id=public.tenant_id() AND status='UPLOADED') THEN RAISE EXCEPTION 'media scope unavailable' USING ERRCODE='42501'; END IF;
 IF NEW.scope='profile' AND NOT EXISTS(SELECT 1 FROM public.profile_upload WHERE id=NEW.id AND user_id=public.profile_user_id() AND status='UPLOADED') THEN RAISE EXCEPTION 'media scope unavailable' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.scope<>OLD.scope) THEN RAISE EXCEPTION 'immutable processing identity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION public.media_job_guard() OWNER TO dw2_dispatch_owner;
CREATE TRIGGER media_scope BEFORE INSERT ON public.media_job FOR EACH ROW EXECUTE FUNCTION public.media_job_guard();
REVOKE ALL ON FUNCTION public.media_job_guard() FROM PUBLIC;
CREATE FUNCTION public.media_job_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF (to_jsonb(NEW)-ARRAY['lease','lease_until','started_lease','attempts','available_at','completed_at'])<>(to_jsonb(OLD)-ARRAY['lease','lease_until','started_lease','attempts','available_at','completed_at']) THEN RAISE EXCEPTION 'immutable processing identity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER media_job_identity BEFORE UPDATE ON public.media_job FOR EACH ROW EXECUTE FUNCTION public.media_job_identity_guard();
REVOKE ALL ON FUNCTION public.media_job_identity_guard() FROM PUBLIC;
CREATE FUNCTION public.claim_media_jobs() RETURNS TABLE(id uuid,lease uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH candidates AS (SELECT j.id FROM public.media_job j WHERE j.completed_at IS NULL AND j.attempts<5 AND j.available_at<=now() AND (j.lease_until IS NULL OR j.lease_until<now()) ORDER BY j.available_at LIMIT 5 FOR UPDATE SKIP LOCKED)
 UPDATE public.media_job j SET lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=j.attempts+1 FROM candidates c WHERE j.id=c.id RETURNING j.id,j.lease
$$;
CREATE FUNCTION public.load_media_job(job uuid,proof uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.media_job;u jsonb;
BEGIN
 SELECT * INTO j FROM public.media_job WHERE id=job AND lease=proof AND lease_until>now() AND completed_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid media lease' USING ERRCODE='42501'; END IF;
 IF j.started_lease IS DISTINCT FROM proof THEN
  IF j.scope='logo' THEN UPDATE public.logo_upload SET status='PROCESSING',attempts=attempts+1,revision=revision+1,updated_at=now() WHERE id=job AND status IN ('UPLOADED','PROCESSING','FAILED');
  ELSE UPDATE public.profile_upload SET status='PROCESSING',attempts=attempts+1,revision=revision+1,updated_at=now() WHERE id=job AND status IN ('UPLOADED','PROCESSING','FAILED'); END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'media unavailable' USING ERRCODE='23514'; END IF;
  UPDATE public.media_job SET started_lease=proof WHERE id=job;
 END IF;
 IF j.scope='logo' THEN SELECT to_jsonb(x) INTO u FROM public.logo_upload x WHERE id=job;
 ELSE SELECT to_jsonb(x) INTO u FROM public.profile_upload x WHERE id=job; END IF;
 RETURN u||jsonb_build_object('media',true,'canonical_prefix',j.scope||'/');
END $$;
CREATE FUNCTION public.finish_media_job(job uuid,proof uuid,outcome text,meta jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j public.media_job;u jsonb;p jsonb;who text;
BEGIN
 SELECT * INTO j FROM public.media_job WHERE id=job AND lease=proof AND lease_until>now() AND completed_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF j.scope='logo' THEN SELECT to_jsonb(x) INTO u FROM public.logo_upload x WHERE id=job FOR UPDATE;
 ELSE SELECT to_jsonb(x) INTO u FROM public.profile_upload x WHERE id=job FOR UPDATE; END IF;
 IF outcome NOT IN ('READY','FAILED','REJECTED') OR u->>'status'<>'PROCESSING' THEN RAISE EXCEPTION 'invalid media outcome' USING ERRCODE='23514'; END IF;
 IF outcome='READY' THEN
  p:=meta->'previews'->0;
  IF meta->>'digest'<>u->>'expected_digest' OR meta->>'size'<>u->>'expected_size' OR meta->>'mime'<>u->>'mime' OR meta->>'canonical_key'<>j.scope||'/original/'||job::text OR jsonb_array_length(meta->'previews')<>1 OR p->>'key'<>j.scope||'/preview/'||job::text||'/1' THEN RAISE EXCEPTION 'invalid media identity' USING ERRCODE='23514'; END IF;
  IF j.scope='logo' THEN
   INSERT INTO public.logo_asset(id,organization_id,upload_id,canonical_key,storage_version,digest,byte_size,mime,preview_key,preview_version,preview_digest,width,height,tool_version) VALUES(job,(u->>'organization_id')::uuid,job,meta->>'canonical_key',meta->>'storage_version',meta->>'digest',(meta->>'size')::integer,meta->>'mime',p->>'key',p->>'storage_version',p->>'digest',(p->>'width')::integer,(p->>'height')::integer,meta->>'tool_version');
   INSERT INTO public.logo_access(organization_id,asset_id) VALUES((u->>'organization_id')::uuid,job);
  ELSE
   INSERT INTO public.profile_asset(id,user_id,upload_id,canonical_key,storage_version,digest,byte_size,mime,preview_key,preview_version,preview_digest,width,height,tool_version) VALUES(job,u->>'user_id',job,meta->>'canonical_key',meta->>'storage_version',meta->>'digest',(meta->>'size')::integer,meta->>'mime',p->>'key',p->>'storage_version',p->>'digest',(p->>'width')::integer,(p->>'height')::integer,meta->>'tool_version');
   INSERT INTO public.profile_access(user_id,asset_id) VALUES(u->>'user_id',job);
  END IF;
 END IF;
 IF j.scope='logo' THEN
  UPDATE public.logo_upload SET status=outcome,error_code=CASE WHEN outcome='READY' THEN NULL ELSE meta->>'error_code' END,revision=revision+1,updated_at=now() WHERE id=job;
  INSERT INTO public.audit_event(organization_id,actor_id,action,target_id,request_id,metadata) VALUES((u->>'organization_id')::uuid,u->>'initiator_id','logo.processed',job::text,gen_random_uuid(),jsonb_build_object('outcome',outcome));
  INSERT INTO public.tenant_event(organization_id,kind,target_id) VALUES((u->>'organization_id')::uuid,'core.changed',job::text);
 ELSE
  UPDATE public.profile_upload SET status=outcome,error_code=CASE WHEN outcome='READY' THEN NULL ELSE meta->>'error_code' END,revision=revision+1,updated_at=now() WHERE id=job;
  INSERT INTO public.identity_audit(user_id,action) VALUES(u->>'user_id','profile.processed');
  INSERT INTO public.identity_event(user_id,kind,target_id) VALUES(u->>'user_id','security',job::text);
 END IF;
 UPDATE public.media_job SET completed_at=CASE WHEN outcome IN ('READY','REJECTED') OR attempts>=5 THEN now() ELSE NULL END,lease_until=NULL,available_at=now()+interval '30 seconds' WHERE id=job;
 RETURN true;
END $$;
ALTER FUNCTION public.claim_media_jobs() OWNER TO dw2_dispatch_owner;
ALTER FUNCTION public.load_media_job(uuid,uuid) OWNER TO dw2_dispatch_owner;
ALTER FUNCTION public.finish_media_job(uuid,uuid,text,jsonb) OWNER TO dw2_dispatch_owner;
REVOKE ALL ON FUNCTION public.claim_media_jobs(),public.load_media_job(uuid,uuid),public.finish_media_job(uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_media_jobs() TO dw2_dispatch;
GRANT EXECUTE ON FUNCTION public.load_media_job(uuid,uuid),public.finish_media_job(uuid,uuid,text,jsonb) TO dw2_worker;
REVOKE CREATE ON SCHEMA public FROM dw2_dispatch_owner;
