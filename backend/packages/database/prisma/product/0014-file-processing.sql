GRANT CREATE ON SCHEMA public TO dw2_dispatch_owner;
CREATE TABLE public.file_job (
 id uuid PRIMARY KEY REFERENCES public.project_upload(id), organization_id uuid NOT NULL, project_id uuid NOT NULL,
 lease uuid, lease_until timestamptz, started_lease uuid, attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 FOREIGN KEY(organization_id,project_id,id) REFERENCES public.project_upload(organization_id,project_id,id)
);
ALTER TABLE public.file_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_job FORCE ROW LEVEL SECURITY;
CREATE POLICY file_job_tenant ON public.file_job USING(organization_id=public.tenant_id()) WITH CHECK(organization_id=public.tenant_id());
GRANT INSERT,SELECT,UPDATE ON public.file_job TO dw2_api;
GRANT SELECT,UPDATE ON public.file_job,public.project_upload TO dw2_dispatch_owner;
GRANT SELECT,INSERT ON public.file_asset,public.file_access,public.file_preview,public.project_file,public.audit_event,public.tenant_event TO dw2_dispatch_owner;
GRANT EXECUTE ON FUNCTION public.tenant_id() TO dw2_dispatch_owner;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['file_job','project_upload','file_asset','file_access','file_preview','project_file'] LOOP
  EXECUTE format('CREATE POLICY file_processor ON public.%I TO dw2_dispatch_owner USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
CREATE POLICY file_processor_audit ON public.audit_event TO dw2_dispatch_owner WITH CHECK(true);
CREATE POLICY file_processor_event ON public.tenant_event TO dw2_dispatch_owner WITH CHECK(true);
CREATE FUNCTION public.claim_file_jobs() RETURNS TABLE(id uuid,lease uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH candidates AS (SELECT j.id FROM public.file_job j WHERE j.completed_at IS NULL AND j.attempts<5 AND j.available_at<=now() AND (j.lease_until IS NULL OR j.lease_until<now()) ORDER BY j.available_at LIMIT 5 FOR UPDATE SKIP LOCKED)
 UPDATE public.file_job j SET lease=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=j.attempts+1 FROM candidates c WHERE j.id=c.id RETURNING j.id,j.lease
$$;
CREATE FUNCTION public.load_file_job(job uuid,proof uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u public.project_upload;
BEGIN
 PERFORM 1 FROM public.file_job WHERE id=job AND lease=proof AND lease_until>now() AND completed_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid processing lease' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.file_job WHERE id=job AND started_lease=proof) THEN SELECT * INTO u FROM public.project_upload WHERE id=job; RETURN to_jsonb(u); END IF;
 UPDATE public.file_job SET started_lease=proof WHERE id=job;
 UPDATE public.project_upload SET status='PROCESSING',attempts=attempts+1,revision=revision+1,updated_at=now() WHERE id=job AND status IN ('UPLOADED','PROCESSING','FAILED') RETURNING * INTO u;
 IF NOT FOUND THEN RAISE EXCEPTION 'upload unavailable' USING ERRCODE='23514'; END IF;
 RETURN to_jsonb(u);
END $$;
CREATE FUNCTION public.finish_file_job(job uuid,proof uuid,outcome text,meta jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE u public.project_upload; p jsonb;
BEGIN
 PERFORM 1 FROM public.file_job WHERE id=job AND lease=proof AND lease_until>now() AND completed_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO u FROM public.project_upload WHERE id=job FOR UPDATE;
 IF outcome NOT IN ('READY','FAILED','REJECTED') OR u.status<>'PROCESSING' THEN RAISE EXCEPTION 'invalid processing result' USING ERRCODE='23514'; END IF;
 IF outcome='READY' THEN
  IF meta->>'digest'<>u.expected_digest OR (meta->>'size')::integer<>u.expected_size OR meta->>'mime'<>u.mime OR meta->>'canonical_key'<>'original/'||u.id::text OR jsonb_array_length(meta->'previews') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid verified identity' USING ERRCODE='23514'; END IF;
  INSERT INTO public.file_asset(id,organization_id,project_id,upload_id,canonical_key,storage_version,digest,byte_size,mime,width,height,pages,tool_version) VALUES(u.id,u.organization_id,u.project_id,u.id,meta->>'canonical_key',meta->>'storage_version',u.expected_digest,u.expected_size,u.mime,(meta->>'width')::integer,(meta->>'height')::integer,(meta->>'pages')::integer,meta->>'tool_version');
  INSERT INTO public.file_access(organization_id,project_id,asset_id) VALUES(u.organization_id,u.project_id,u.id);
  FOR p IN SELECT value FROM jsonb_array_elements(meta->'previews') LOOP
   IF p->>'key'<>'preview/'||u.id::text||'/'||(p->>'page') THEN RAISE EXCEPTION 'invalid preview identity' USING ERRCODE='23514'; END IF;
   INSERT INTO public.file_preview(organization_id,project_id,asset_id,page,object_key,storage_version,digest,width,height) VALUES(u.organization_id,u.project_id,u.id,(p->>'page')::integer,p->>'key',p->>'storage_version',p->>'digest',(p->>'width')::integer,(p->>'height')::integer);
  END LOOP;
  IF u.purpose='PROJECT_FILE' THEN INSERT INTO public.project_file(organization_id,project_id,asset_id,folder_id,title) VALUES(u.organization_id,u.project_id,u.id,u.folder_id,u.name); END IF;
 END IF;
 UPDATE public.project_upload SET status=outcome,error_code=CASE WHEN outcome='READY' THEN NULL ELSE meta->>'error_code' END,revision=revision+1,updated_at=now() WHERE id=job;
 UPDATE public.file_job SET completed_at=CASE WHEN outcome IN ('READY','REJECTED') OR attempts>=5 THEN now() ELSE NULL END,lease_until=NULL,available_at=now()+interval '30 seconds' WHERE id=job;
 INSERT INTO public.audit_event(organization_id,actor_id,action,target_id,request_id,metadata) VALUES(u.organization_id,u.initiator_id,'file.processed',u.id::text,gen_random_uuid(),jsonb_build_object('outcome',outcome));
 INSERT INTO public.tenant_event(organization_id,kind,target_id) VALUES(u.organization_id,'core.changed',u.id::text);
 RETURN true;
END $$;
ALTER FUNCTION public.claim_file_jobs() OWNER TO dw2_dispatch_owner;
ALTER FUNCTION public.load_file_job(uuid,uuid) OWNER TO dw2_dispatch_owner;
ALTER FUNCTION public.finish_file_job(uuid,uuid,text,jsonb) OWNER TO dw2_dispatch_owner;
REVOKE ALL ON FUNCTION public.claim_file_jobs(),public.load_file_job(uuid,uuid),public.finish_file_job(uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_file_jobs() TO dw2_dispatch;
GRANT EXECUTE ON FUNCTION public.load_file_job(uuid,uuid),public.finish_file_job(uuid,uuid,text,jsonb) TO dw2_worker;
CREATE FUNCTION public.version_asset_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.file_asset a JOIN public.file_access x ON x.asset_id=a.id WHERE a.organization_id=NEW.organization_id AND a.project_id=NEW.project_id AND a.id=NEW.asset_id AND a.digest=NEW.digest AND a.byte_size=NEW.byte_size AND a.mime=NEW.mime AND x.status='AVAILABLE') THEN RAISE EXCEPTION 'version asset unavailable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER version_asset_guard BEFORE INSERT ON public.deliverable_version FOR EACH ROW EXECUTE FUNCTION public.version_asset_guard();
REVOKE ALL ON FUNCTION public.version_asset_guard() FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM dw2_dispatch_owner;
