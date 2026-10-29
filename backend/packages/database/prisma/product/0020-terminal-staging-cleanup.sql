GRANT CREATE ON SCHEMA public TO dw2_dispatch_owner;
SET LOCAL ROLE dw2_dispatch_owner;
-- Extend grace-period cleanup to rejected/exhausted jobs; never active jobs or canonical assets.
CREATE OR REPLACE FUNCTION public.lock_staging_cleanup() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lane text; tab text; asset text; u record;
BEGIN
 FOREACH lane IN ARRAY ARRAY['project','logo','profile'] LOOP
  tab:=CASE lane WHEN 'project' THEN 'project_upload' WHEN 'logo' THEN 'logo_upload' ELSE 'profile_upload' END;
  asset:=CASE lane WHEN 'project' THEN 'file_asset' WHEN 'logo' THEN 'logo_asset' ELSE 'profile_asset' END;
  FOR u IN EXECUTE format('SELECT u.* FROM public.%I u WHERE u.status IN (''ISSUED'',''EXPIRED'',''REJECTED'',''FAILED'') AND (u.status<>''FAILED'' OR u.attempts>=5) AND u.expires_at+interval ''24 hours''<=now() AND NOT EXISTS(SELECT 1 FROM public.staging_cleanup c WHERE c.scope=$1 AND c.upload_id=u.id) ORDER BY u.expires_at LIMIT 10 FOR UPDATE SKIP LOCKED',tab) USING lane LOOP
   IF EXISTS(SELECT 1 FROM public.file_job WHERE id=u.id AND completed_at IS NULL) OR EXISTS(SELECT 1 FROM public.media_job WHERE id=u.id AND completed_at IS NULL) THEN CONTINUE; END IF;
   -- All canonical assets retain their original upload FK; references/versions require an asset.
   IF lane='project' AND EXISTS(SELECT 1 FROM public.file_asset WHERE upload_id=u.id) THEN CONTINUE; END IF;
   IF lane='logo' AND EXISTS(SELECT 1 FROM public.logo_asset WHERE upload_id=u.id) THEN CONTINUE; END IF;
   IF lane='profile' AND EXISTS(SELECT 1 FROM public.profile_asset WHERE upload_id=u.id) THEN CONTINUE; END IF;
   IF u.status='ISSUED' THEN EXECUTE format('UPDATE public.%I SET status=''EXPIRED'',revision=revision+1,updated_at=now() WHERE id=$1',tab) USING u.id; END IF;
   RETURN to_jsonb(u)||jsonb_build_object('scope',lane);
  END LOOP;
 END LOOP;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION public.finish_staging_cleanup(lane text,job uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE tab text; u record; inserted integer;
BEGIN
 IF lane NOT IN ('project','logo','profile') THEN RAISE EXCEPTION 'invalid cleanup scope'; END IF;
 tab:=CASE lane WHEN 'project' THEN 'project_upload' WHEN 'logo' THEN 'logo_upload' ELSE 'profile_upload' END;
 EXECUTE format('SELECT * FROM public.%I WHERE id=$1 AND status IN (''EXPIRED'',''REJECTED'',''FAILED'') AND (status<>''FAILED'' OR attempts>=5) AND expires_at+interval ''24 hours''<=now() FOR UPDATE',tab) INTO u USING job;
 IF u.id IS NULL OR EXISTS(SELECT 1 FROM public.file_job WHERE id=job AND completed_at IS NULL) OR EXISTS(SELECT 1 FROM public.media_job WHERE id=job AND completed_at IS NULL) THEN RAISE EXCEPTION 'cleanup unavailable'; END IF;
 INSERT INTO public.staging_cleanup(scope,upload_id,organization_id,user_id,staging_key) VALUES(lane,job,CASE WHEN lane='profile' THEN NULL ELSE (to_jsonb(u)->>'organization_id')::uuid END,CASE WHEN lane='profile' THEN to_jsonb(u)->>'user_id' ELSE NULL END,u.staging_key) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 IF inserted=0 THEN RETURN false; END IF;
 IF lane='profile' THEN
  INSERT INTO public.identity_audit(user_id,action) VALUES(u.user_id,'staging.purged');
  INSERT INTO public.identity_event(user_id,kind,target_id) VALUES(u.user_id,'security',job::text);
 ELSE
  INSERT INTO public.audit_event(organization_id,actor_id,action,target_id,request_id,metadata) VALUES(u.organization_id,u.initiator_id,'staging.purged',job::text,gen_random_uuid(),jsonb_build_object('scope',lane));
  INSERT INTO public.tenant_event(organization_id,kind,target_id) VALUES(u.organization_id,'core.changed',job::text);
 END IF;
 RETURN true;
END $$;

SET LOCAL ROLE dw2_owner;
REVOKE CREATE ON SCHEMA public FROM dw2_dispatch_owner;

