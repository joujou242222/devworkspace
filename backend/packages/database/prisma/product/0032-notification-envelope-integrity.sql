-- Typed assignment/version events and relational notification-envelope binding.
GRANT CREATE ON SCHEMA public TO dw2_communications;
SET LOCAL ROLE dw2_communications;
CREATE OR REPLACE FUNCTION public.capture_communication_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE x uuid; f public.feedback_thread;
BEGIN
 NEW.schema_version:=6; NEW.action:=coalesce(NEW.action,NEW.kind);
 IF NEW.kind='core.changed' AND (NEW.action LIKE 'tasks.%' OR NEW.action LIKE 'comment.%' OR NEW.action LIKE 'checklist.%') THEN
  SELECT project_id,id,revision,assignee_id INTO NEW.project_id,NEW.resource_id,NEW.resource_revision,NEW.assignment_id FROM public.task WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id;
  IF NEW.resource_id IS NULL THEN
   SELECT t.project_id,t.id,t.revision,t.assignee_id INTO NEW.project_id,NEW.resource_id,NEW.resource_revision,NEW.assignment_id FROM public.task_checklist c JOIN public.task t ON t.organization_id=c.organization_id AND t.project_id=c.project_id AND t.id=c.task_id WHERE c.organization_id=NEW.organization_id AND c.id::text=NEW.target_id;
  END IF;
  IF NEW.resource_id IS NOT NULL THEN NEW.resource_kind:='TASK'; END IF;
 ELSIF NEW.kind='review.changed' THEN
  SELECT project_id,id,revision INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.review_cycle WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id;
  IF NEW.resource_id IS NULL THEN
   SELECT * INTO f FROM public.feedback_thread WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id;
   IF f.id IS NOT NULL THEN
    SELECT project_id,id,revision INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.review_cycle WHERE organization_id=f.organization_id AND id=f.cycle_id;
    IF f.visibility='INTERNAL' THEN NEW.action:='internal.'||NEW.action; END IF;
   END IF;
  END IF;
  IF NEW.resource_id IS NOT NULL THEN NEW.resource_kind:='REVIEW';
  ELSE
   SELECT project_id,id,version_number INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.deliverable_version WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id;
   IF NEW.resource_id IS NOT NULL THEN NEW.resource_kind:='VERSION'; END IF;
  END IF;
 END IF;
 IF NEW.resource_id IS NULL AND NEW.action='version.created' THEN
  SELECT project_id,id,version_number INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.deliverable_version WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id;
  IF NEW.resource_id IS NOT NULL THEN NEW.resource_kind:='VERSION'; END IF;
 END IF;
 -- Other lifecycle events produce only scoped invalidation hints.
 IF NEW.resource_id IS NULL THEN
  SELECT id,id,revision INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.project WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id;
  IF NEW.resource_id IS NULL THEN
   SELECT project_id,project_id,revision INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.milestone WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id;
  END IF;
  IF NEW.resource_id IS NOT NULL THEN NEW.resource_kind:='PROJECT'; END IF;
 END IF;
 RETURN NEW;
END $$;
SET LOCAL ROLE dw2_owner;
REVOKE CREATE ON SCHEMA public FROM dw2_communications;
ALTER TABLE public.notification ADD CHECK((category='assignments')=(resource_kind='TASK'));
CREATE FUNCTION public.notification_envelope_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tenant_event e WHERE e.organization_id=NEW.organization_id AND e.id=NEW.event_id AND e.project_id=NEW.project_id AND e.resource_kind=NEW.resource_kind AND e.resource_id=NEW.resource_id AND e.action=NEW.action AND e.created_at=NEW.occurred_at) THEN
 RAISE EXCEPTION 'notification envelope ancestry mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_envelope_guard BEFORE INSERT ON public.notification FOR EACH ROW EXECUTE FUNCTION public.notification_envelope_guard();
GRANT CREATE ON SCHEMA public TO dw2_communications;
ALTER FUNCTION public.notification_envelope_guard() OWNER TO dw2_communications;
REVOKE CREATE ON SCHEMA public FROM dw2_communications;
REVOKE ALL ON FUNCTION public.notification_envelope_guard() FROM PUBLIC;