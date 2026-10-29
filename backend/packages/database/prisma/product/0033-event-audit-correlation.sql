-- Link future envelopes to their exact transaction-local sensitive audit evidence.
ALTER TABLE public.audit_event ADD UNIQUE(organization_id,id);
ALTER TABLE public.tenant_event ADD COLUMN audit_id uuid, ADD COLUMN actor_id text REFERENCES public.identity_user(id), ADD COLUMN request_id uuid,
 ADD FOREIGN KEY(organization_id,audit_id) REFERENCES public.audit_event(organization_id,id);
GRANT SELECT ON public.audit_event TO dw2_communications;
CREATE FUNCTION public.capture_pending_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 PERFORM set_config('app.pending_audit_id',NEW.id::text,true); RETURN NEW;
END $$;
CREATE TRIGGER capture_pending_audit AFTER INSERT ON public.audit_event FOR EACH ROW EXECUTE FUNCTION public.capture_pending_audit();
REVOKE ALL ON FUNCTION public.capture_pending_audit() FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO dw2_communications;
SET LOCAL ROLE dw2_communications;
CREATE OR REPLACE FUNCTION public.capture_communication_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE x uuid; f public.feedback_thread; a public.audit_event;
BEGIN
 SELECT * INTO a FROM public.audit_event WHERE organization_id=NEW.organization_id AND target_id=NEW.target_id AND id=nullif(current_setting('app.pending_audit_id',true),'')::uuid;
 IF a.id IS NOT NULL THEN NEW.audit_id:=a.id;NEW.actor_id:=a.actor_id;NEW.request_id:=a.request_id; END IF;
 NEW.schema_version:=6; NEW.action:=coalesce(NEW.action,a.metadata->>'action',NEW.kind);
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
