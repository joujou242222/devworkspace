-- Resource withdrawal owns cancellation, never supersession or a fabricated decision.
CREATE FUNCTION public.review_resource_lifecycle() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p uuid; target uuid; why text; c record; who text; request uuid; principal text;
BEGIN
 PERFORM 1 FROM public.organization WHERE id=NEW.organization_id FOR UPDATE;
 p:=(CASE WHEN TG_TABLE_NAME='project' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'project_id' END)::uuid;
 IF TG_TABLE_NAME='project' THEN
  IF NEW.status='COMPLETED' AND OLD.status<>'COMPLETED' AND EXISTS(SELECT 1 FROM public.review_cycle WHERE organization_id=NEW.organization_id AND project_id=p AND status='OPEN') THEN
   RAISE EXCEPTION 'project has open reviews' USING ERRCODE='23514';
  END IF;
  IF NEW.status='ARCHIVED' AND OLD.status<>'ARCHIVED' THEN why:='project.archived';
  ELSIF NOT NEW.portal_enabled AND OLD.portal_enabled THEN why:='portal.disabled'; END IF;
 ELSIF TG_TABLE_NAME='deliverable' THEN
  target:=NEW.id;
  IF NEW.status='ARCHIVED' AND OLD.status<>'ARCHIVED' THEN why:='deliverable.archived'; END IF;
 ELSIF TG_TABLE_NAME='version_share' THEN
  target:=NEW.version_id;
  IF NEW.status='REVOKED' AND OLD.status<>'REVOKED' THEN why:='share.revoked'; END IF;
 END IF;
 IF why IS NULL THEN RETURN NEW; END IF;
 FOR c IN SELECT r.id,r.version_id FROM public.review_cycle r WHERE r.organization_id=NEW.organization_id AND r.project_id=p AND r.status='OPEN'
  AND (TG_TABLE_NAME='project' OR (TG_TABLE_NAME='deliverable' AND r.deliverable_id=target) OR (TG_TABLE_NAME='version_share' AND r.version_id=target)) FOR UPDATE LOOP
  who:=nullif(current_setting('app.actor_id',true),''); principal:=nullif(current_setting('app.principal_id',true),'');
  request:=nullif(current_setting('app.request_id',true),'')::uuid;
  IF who IS NULL OR principal IS NULL OR request IS NULL THEN RAISE EXCEPTION 'audited lifecycle context required' USING ERRCODE='42501'; END IF;
  UPDATE public.review_cycle SET status='CANCELLED',revision=revision+1,closed_at=now() WHERE organization_id=NEW.organization_id AND id=c.id;
  INSERT INTO public.audit_event(organization_id,actor_id,action,target_id,request_id,metadata)
   VALUES(NEW.organization_id,who,'review.changed',c.id::text,request,jsonb_build_object('action','review.cancelled','reason',why,'version_id',c.version_id,'principal_id',principal,'capacity','INTERNAL'));
  INSERT INTO public.tenant_event(organization_id,kind,target_id) VALUES(NEW.organization_id,'review.changed',c.id::text);
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER review_resource_lifecycle AFTER UPDATE ON public.project FOR EACH ROW EXECUTE FUNCTION public.review_resource_lifecycle();
CREATE TRIGGER review_resource_lifecycle AFTER UPDATE ON public.deliverable FOR EACH ROW EXECUTE FUNCTION public.review_resource_lifecycle();
CREATE TRIGGER review_resource_lifecycle AFTER UPDATE ON public.version_share FOR EACH ROW EXECUTE FUNCTION public.review_resource_lifecycle();
CREATE FUNCTION public.review_open_eligibility() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.project p JOIN public.client x ON x.organization_id=p.organization_id AND x.id=p.client_id
  JOIN public.deliverable d ON d.organization_id=p.organization_id AND d.project_id=p.id AND d.id=NEW.deliverable_id
  JOIN public.deliverable_version v ON v.organization_id=d.organization_id AND v.project_id=d.project_id AND v.deliverable_id=d.id AND v.id=NEW.version_id
  JOIN public.file_access a ON a.organization_id=v.organization_id AND a.project_id=v.project_id AND a.asset_id=v.asset_id
  WHERE p.organization_id=NEW.organization_id AND p.id=NEW.project_id AND p.status='ACTIVE' AND p.portal_enabled AND x.status='ACTIVE' AND d.status='ACTIVE' AND a.status='AVAILABLE') THEN
  RAISE EXCEPTION 'review requires active project, portal and available target' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_open_eligibility BEFORE INSERT ON public.review_cycle FOR EACH ROW EXECUTE FUNCTION public.review_open_eligibility();
REVOKE ALL ON FUNCTION public.review_resource_lifecycle(),public.review_open_eligibility() FROM PUBLIC;
