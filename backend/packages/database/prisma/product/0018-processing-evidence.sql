GRANT CREATE ON SCHEMA public TO dw2_dispatch_owner;
CREATE TABLE public.file_processing_step (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_job uuid REFERENCES public.file_job(id), media_job uuid REFERENCES public.media_job(id),
 organization_id uuid,user_id text,lease uuid NOT NULL,step text NOT NULL CHECK(step IN ('TOOLS','INTEGRITY','SCAN','RENDER','PUBLISH','RESULT')),
 outcome text NOT NULL CHECK(outcome IN ('STARTED','VERIFIED','READY','FAILED','REJECTED')),tool_identity text NOT NULL CHECK(length(tool_identity)<=200),
 recorded_at timestamptz NOT NULL DEFAULT now(), CHECK(num_nonnulls(project_job,media_job)=1),CHECK(num_nonnulls(organization_id,user_id)=1)
);
ALTER TABLE public.file_processing_step ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_processing_step FORCE ROW LEVEL SECURITY;
CREATE POLICY step_processor ON public.file_processing_step TO dw2_dispatch_owner USING(true) WITH CHECK(true);
CREATE POLICY step_tenant ON public.file_processing_step TO dw2_api USING(organization_id=public.tenant_id());
CREATE POLICY step_self ON public.file_processing_step TO dw2_identity USING(user_id=public.profile_user_id());
GRANT SELECT ON public.file_processing_step TO dw2_api,dw2_identity;
GRANT INSERT ON public.file_processing_step TO dw2_dispatch_owner;
CREATE TRIGGER immutable_processing BEFORE UPDATE OR DELETE ON public.file_processing_step FOR EACH ROW EXECUTE FUNCTION public.file_immutable_guard();
CREATE FUNCTION public.record_file_step(job uuid,proof uuid,lane text,stage text,result text,tool text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE org uuid; uid text;
BEGIN
 IF lane='project' THEN
  SELECT organization_id INTO org FROM public.file_job WHERE id=job AND lease=proof AND lease_until>now() AND completed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid processing lease' USING ERRCODE='42501'; END IF;
 ELSE
  IF lane<>'media' THEN RAISE EXCEPTION 'invalid processing scope'; END IF;
  SELECT organization_id,user_id INTO org,uid FROM public.media_job WHERE id=job AND lease=proof AND lease_until>now() AND completed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid processing lease' USING ERRCODE='42501'; END IF;
 END IF;
 INSERT INTO public.file_processing_step(project_job,media_job,organization_id,user_id,lease,step,outcome,tool_identity) VALUES(CASE WHEN lane='project' THEN job ELSE NULL END,CASE WHEN lane='media' THEN job ELSE NULL END,org,uid,proof,stage,result,tool);
END $$;
ALTER FUNCTION public.record_file_step(uuid,uuid,text,text,text,text) OWNER TO dw2_dispatch_owner;
REVOKE ALL ON FUNCTION public.record_file_step(uuid,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_file_step(uuid,uuid,text,text,text,text) TO dw2_worker;
REVOKE CREATE ON SCHEMA public FROM dw2_dispatch_owner;
