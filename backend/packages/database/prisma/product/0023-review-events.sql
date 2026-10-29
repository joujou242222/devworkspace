ALTER TABLE public.tenant_event DROP CONSTRAINT tenant_event_kind_check;
ALTER TABLE public.tenant_event ADD CONSTRAINT tenant_event_kind_check CHECK(kind IN ('organization.created','organization.updated','membership.changed','invitation.created','invitation.revoked','invitation.accepted','ownership.transferred','core.changed','review.changed'));
-- Resolve heterogeneous trigger rows through JSON rather than nonexistent record fields.
CREATE OR REPLACE FUNCTION public.review_fact_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c public.review_cycle; v public.deliverable_version; d public.review_decision; a public.approval;
BEGIN
 SELECT * INTO c FROM public.review_cycle WHERE organization_id=NEW.organization_id AND id=(CASE WHEN TG_TABLE_NAME='review_cycle' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'cycle_id' END)::uuid;
 SELECT * INTO v FROM public.deliverable_version WHERE organization_id=c.organization_id AND id=c.version_id;
 SELECT * INTO d FROM public.review_decision WHERE organization_id=c.organization_id AND cycle_id=c.id;
 SELECT * INTO a FROM public.approval WHERE organization_id=c.organization_id AND cycle_id=c.id;
 IF (c.status IN ('APPROVED','CHANGES_REQUESTED')) IS DISTINCT FROM (d.id IS NOT NULL) OR (d.id IS NOT NULL AND (d.decision<>c.status OR d.digest<>v.digest)) OR (c.status='APPROVED') IS DISTINCT FROM (a.id IS NOT NULL) OR (a.id IS NOT NULL AND (a.digest<>v.digest OR a.actor_id<>d.actor_id)) THEN
 RAISE EXCEPTION 'inconsistent decision facts' USING ERRCODE='23514'; END IF; RETURN NULL;
END $$;
