-- Preserve a display-name snapshot without copying private content or email into activity.
GRANT SELECT(name) ON public.identity_user TO dw2_communications;
GRANT CREATE ON SCHEMA public TO dw2_communications;
SET LOCAL ROLE dw2_communications;
CREATE OR REPLACE FUNCTION public.project_activity_materialize(eid uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE e public.tenant_event; p uuid; label text;
BEGIN
 SELECT * INTO e FROM public.tenant_event WHERE id=eid;
 IF e.id IS NULL THEN RETURN; END IF;
 PERFORM set_config('app.organization_id',e.organization_id::text,true);
 p:=e.project_id;
 IF p IS NULL THEN
  SELECT id INTO p FROM public.project WHERE organization_id=e.organization_id AND id::text=e.target_id;
  IF p IS NULL THEN SELECT project_id INTO p FROM public.task WHERE organization_id=e.organization_id AND id::text=e.target_id; END IF;
  IF p IS NULL THEN SELECT project_id INTO p FROM public.milestone WHERE organization_id=e.organization_id AND id::text=e.target_id; END IF;
  IF p IS NULL THEN SELECT project_id INTO p FROM public.deliverable WHERE organization_id=e.organization_id AND id::text=e.target_id; END IF;
  IF p IS NULL THEN SELECT project_id INTO p FROM public.deliverable_version WHERE organization_id=e.organization_id AND id::text=e.target_id; END IF;
  IF p IS NULL THEN SELECT project_id INTO p FROM public.review_cycle WHERE organization_id=e.organization_id AND id::text=e.target_id; END IF;
 END IF;
 IF p IS NULL THEN SELECT project_id INTO p FROM public.project_upload WHERE organization_id=e.organization_id AND id::text=e.target_id; END IF;
 IF p IS NULL THEN SELECT project_id INTO p FROM public.project_membership WHERE organization_id=e.organization_id AND id::text=e.target_id; END IF;
 IF p IS NULL THEN SELECT project_id INTO p FROM public.client_project_access WHERE organization_id=e.organization_id AND id::text=e.target_id; END IF;
 SELECT name INTO label FROM public.identity_user WHERE id=e.actor_id;
 IF p IS NOT NULL AND e.kind IN ('core.changed','review.changed','file.changed') THEN
  INSERT INTO public.project_activity(organization_id,project_id,event_id,action,summary,actor,created_at) VALUES(e.organization_id,p,e.id,coalesce(e.action,e.kind),'Project lifecycle activity',coalesce(label,'System'),e.created_at) ON CONFLICT DO NOTHING;
 END IF;
END $$;

SET LOCAL ROLE dw2_owner;
REVOKE CREATE ON SCHEMA public FROM dw2_communications;
