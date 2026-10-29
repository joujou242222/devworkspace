-- Client eligibility never requires or confers internal membership.
CREATE FUNCTION public.eligible_contact(cid uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.client_contact c JOIN public.identity_user u ON u.id=c.user_id WHERE c.organization_id=public.tenant_id() AND c.id=cid AND c.status='ACTIVE' AND u.active AND u."emailVerified")
$$;
REVOKE ALL ON FUNCTION public.eligible_contact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eligible_contact(uuid) TO dw2_api;
CREATE OR REPLACE FUNCTION public.review_insert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c public.review_cycle; v public.deliverable_version; p public.file_preview; prior public.review_cycle;
BEGIN
 IF TG_TABLE_NAME='review_cycle' THEN
  IF NEW.status<>'OPEN' OR EXISTS(SELECT 1 FROM public.approval WHERE organization_id=NEW.organization_id AND version_id=NEW.version_id) OR NOT EXISTS(SELECT 1 FROM public.version_share WHERE organization_id=NEW.organization_id AND version_id=NEW.version_id AND status='ACTIVE') THEN RAISE EXCEPTION 'ineligible review target' USING ERRCODE='23514'; END IF;
  IF NEW.replaces_cycle_id IS NOT NULL THEN
   SELECT * INTO prior FROM public.review_cycle WHERE organization_id=NEW.organization_id AND id=NEW.replaces_cycle_id;
   IF prior.status<>'SUPERSEDED' OR NOT EXISTS(SELECT 1 FROM public.deliverable_version n JOIN public.deliverable_version o ON o.organization_id=n.organization_id AND o.deliverable_id=n.deliverable_id WHERE n.organization_id=NEW.organization_id AND n.id=NEW.version_id AND o.id=prior.version_id AND n.version_number>o.version_number) THEN RAISE EXCEPTION 'invalid replacement' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO c FROM public.review_cycle WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND id=NEW.cycle_id;
 IF c.status<>'OPEN' THEN RAISE EXCEPTION 'review is closed' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='review_participant' THEN
  IF NOT EXISTS(SELECT 1 FROM public.client_project_access g JOIN public.client_contact x ON x.organization_id=g.organization_id AND x.id=g.contact_id WHERE g.organization_id=NEW.organization_id AND g.project_id=NEW.project_id AND g.id=NEW.grant_id AND g.contact_id=NEW.contact_id AND g.status='ACTIVE' AND g.role='APPROVER' AND x.status='ACTIVE' AND public.eligible_contact(x.id)) THEN RAISE EXCEPTION 'invalid participant' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='review_decision' THEN
  SELECT * INTO v FROM public.deliverable_version WHERE organization_id=c.organization_id AND id=c.version_id;
  IF NEW.digest<>v.digest OR NOT EXISTS(SELECT 1 FROM public.client_project_access g JOIN public.client_contact x ON x.organization_id=g.organization_id AND x.id=g.contact_id JOIN public.project pr ON pr.organization_id=g.organization_id AND pr.id=g.project_id WHERE g.organization_id=NEW.organization_id AND g.id=NEW.grant_id AND g.contact_id=NEW.contact_id AND g.status='ACTIVE' AND g.role='APPROVER' AND x.status='ACTIVE' AND x.user_id=NEW.actor_id AND public.eligible_contact(x.id) AND pr.portal_enabled AND pr.status IN ('PLANNED','ACTIVE')) THEN RAISE EXCEPTION 'invalid decision authority' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='feedback_thread' THEN
  SELECT * INTO v FROM public.deliverable_version WHERE organization_id=c.organization_id AND id=c.version_id;
  IF NEW.digest<>v.digest OR (NEW.capacity='CLIENT' AND NEW.visibility<>'CLIENT') THEN RAISE EXCEPTION 'invalid feedback source' USING ERRCODE='23514'; END IF;
  IF NEW.annotation IS NOT NULL THEN
   IF jsonb_typeof(NEW.annotation)<>'object' OR NOT NEW.annotation ?& ARRAY['type','x','y'] OR jsonb_typeof(NEW.annotation->'x')<>'number' OR jsonb_typeof(NEW.annotation->'y')<>'number' OR (NEW.annotation->>'x')::numeric NOT BETWEEN 0 AND 1 OR (NEW.annotation->>'y')::numeric NOT BETWEEN 0 AND 1 THEN RAISE EXCEPTION 'invalid normalized geometry' USING ERRCODE='23514'; END IF;
   IF v.mime='application/pdf' THEN
    IF NEW.annotation->>'type'<>'PDF_POINT' OR NOT NEW.annotation ? 'page' OR (NEW.annotation->>'page') !~ '^[1-9][0-9]*$' OR NEW.annotation-ARRAY['type','x','y','page']<>'{}'::jsonb THEN RAISE EXCEPTION 'invalid PDF geometry' USING ERRCODE='23514'; END IF;
   ELSE
    IF NEW.annotation->>'type'<>'IMAGE_PIN' OR NEW.annotation-ARRAY['type','x','y']<>'{}'::jsonb THEN RAISE EXCEPTION 'invalid image geometry' USING ERRCODE='23514'; END IF;
   END IF;
   SELECT * INTO p FROM public.file_preview WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND asset_id=v.asset_id AND page=CASE WHEN v.mime='application/pdf' THEN (NEW.annotation->>'page')::integer ELSE 1 END;
   IF p.asset_id IS NULL OR NEW.source_width IS DISTINCT FROM p.width OR NEW.source_height IS DISTINCT FROM p.height THEN RAISE EXCEPTION 'invalid preview dimensions' USING ERRCODE='23514'; END IF;
  ELSIF NEW.source_width IS NOT NULL OR NEW.source_height IS NOT NULL THEN RAISE EXCEPTION 'unexpected geometry dimensions' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

