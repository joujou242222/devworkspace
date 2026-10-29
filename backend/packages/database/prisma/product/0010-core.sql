-- Phase 3 additive core domain. Existing migration hashes remain untouched.
CREATE TABLE public.client (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organization(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100), description text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id)
);
CREATE TABLE public.client_contact (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, client_id uuid NOT NULL,
 email text NOT NULL CHECK(email=lower(email)), name text NOT NULL, user_id text REFERENCES public.identity_user(id),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')), revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(organization_id,id,client_id), UNIQUE(organization_id,client_id,email), UNIQUE(organization_id,client_id,user_id),
 FOREIGN KEY(organization_id,client_id) REFERENCES public.client(organization_id,id)
);
CREATE TABLE public.project (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, client_id uuid NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100), description text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','ACTIVE','COMPLETED','ARCHIVED')),
 portal_enabled boolean NOT NULL DEFAULT false, due_at timestamptz,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(organization_id,id,client_id), FOREIGN KEY(organization_id,client_id) REFERENCES public.client(organization_id,id)
);
CREATE TABLE public.project_membership (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, membership_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('MANAGER','CONTRIBUTOR','VIEWER')), status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(organization_id,project_id,id), UNIQUE(organization_id,project_id,membership_id),
 FOREIGN KEY(organization_id,project_id) REFERENCES public.project(organization_id,id), FOREIGN KEY(organization_id,membership_id) REFERENCES public.membership(organization_id,id)
);
CREATE TABLE public.client_project_access (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, client_id uuid NOT NULL, contact_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('VIEWER','REVIEWER','APPROVER')), status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(organization_id,project_id,contact_id),
 FOREIGN KEY(organization_id,project_id,client_id) REFERENCES public.project(organization_id,id,client_id),
 FOREIGN KEY(organization_id,contact_id,client_id) REFERENCES public.client_contact(organization_id,id,client_id)
);
CREATE TABLE public.milestone (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200), due_at timestamptz, position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','COMPLETED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(organization_id,project_id,id), FOREIGN KEY(organization_id,project_id) REFERENCES public.project(organization_id,id)
);
CREATE TABLE public.task (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, milestone_id uuid, assignee_id uuid,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200), description text NOT NULL DEFAULT '', due_at timestamptz,
 priority text NOT NULL DEFAULT 'NORMAL' CHECK(priority IN ('LOW','NORMAL','HIGH','URGENT')),
 status text NOT NULL DEFAULT 'TODO' CHECK(status IN ('TODO','IN_PROGRESS','BLOCKED','DONE','CANCELLED')),
 position integer NOT NULL DEFAULT 0 CHECK(position>=0), revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id), UNIQUE(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES public.project(organization_id,id),
 FOREIGN KEY(organization_id,project_id,milestone_id) REFERENCES public.milestone(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id,assignee_id) REFERENCES public.project_membership(organization_id,project_id,id)
);
CREATE TABLE public.task_checklist (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, task_id uuid NOT NULL,
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 500), position integer NOT NULL DEFAULT 0 CHECK(position>=0),
 completed boolean NOT NULL DEFAULT false, completed_by text REFERENCES public.identity_user(id), completed_at timestamptz,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((completed AND completed_by IS NOT NULL AND completed_at IS NOT NULL) OR (NOT completed AND completed_by IS NULL AND completed_at IS NULL)),
 FOREIGN KEY(organization_id,project_id,task_id) REFERENCES public.task(organization_id,project_id,id), UNIQUE(organization_id,project_id,task_id,id)
);
CREATE TABLE public.task_comment (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, task_id uuid NOT NULL, thread_id uuid,
 author_id text NOT NULL REFERENCES public.identity_user(id), body text NOT NULL CHECK(length(body) BETWEEN 1 AND 10000), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,project_id,task_id,id), FOREIGN KEY(organization_id,project_id,task_id) REFERENCES public.task(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id,task_id,thread_id) REFERENCES public.task_comment(organization_id,project_id,task_id,id)
);
CREATE TABLE public.task_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, task_id uuid NOT NULL,
 actor_id text NOT NULL REFERENCES public.identity_user(id), kind text NOT NULL, fields jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id,task_id) REFERENCES public.task(organization_id,project_id,id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['client','client_contact','project','project_membership','client_project_access','milestone','task','task_checklist','task_comment','task_history'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_scope ON public.%I USING(organization_id=public.tenant_id()) WITH CHECK(organization_id=public.tenant_id())',t);
 EXECUTE format('CREATE TRIGGER immutable_scope BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.immutable_scope()',t);
 EXECUTE format('GRANT SELECT,INSERT ON public.%I TO dw2_api',t);
 IF t NOT IN ('task_comment','task_history') THEN EXECUTE format('GRANT UPDATE ON public.%I TO dw2_api',t); END IF;
 END LOOP;
END $$;
GRANT DELETE ON public.task_checklist TO dw2_api;
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON public.task_comment FOR EACH ROW EXECUTE FUNCTION public.append_only();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON public.task_history FOR EACH ROW EXECUTE FUNCTION public.append_only();
ALTER TABLE public.tenant_event DROP CONSTRAINT tenant_event_kind_check;
ALTER TABLE public.tenant_event ADD CONSTRAINT tenant_event_kind_check CHECK(kind IN ('organization.created','organization.updated','membership.changed','invitation.created','invitation.revoked','invitation.accepted','ownership.transferred','core.changed'));
CREATE INDEX task_discovery ON public.task(organization_id,project_id,status,priority,id);
CREATE INDEX task_assignment ON public.task(organization_id,assignee_id,id);
CREATE INDEX project_discovery ON public.project(organization_id,status,id);
CREATE INDEX task_history_page ON public.task_history(organization_id,project_id,task_id,created_at,id);
-- Reparenting is not an ordinary domain operation, even for direct runtime SQL.
CREATE FUNCTION public.core_immutable_parent() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF (to_jsonb(NEW)->'project_id') IS DISTINCT FROM (to_jsonb(OLD)->'project_id') OR
 (to_jsonb(NEW)->'client_id') IS DISTINCT FROM (to_jsonb(OLD)->'client_id') OR
 (to_jsonb(NEW)->'task_id') IS DISTINCT FROM (to_jsonb(OLD)->'task_id') THEN RAISE EXCEPTION 'immutable parent' USING ERRCODE='23514'; END IF;
 NEW.updated_at=now(); RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['client','client_contact','project','project_membership','client_project_access','milestone','task','task_checklist'] LOOP
 EXECUTE format('CREATE TRIGGER immutable_parent BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.core_immutable_parent()',t);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.core_immutable_parent() FROM PUBLIC;
-- Shared lock order and durable work invariants also protect permitted runtime SQL.
CREATE FUNCTION public.core_work_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p public.project; m public.project_membership; reopening uuid;
BEGIN
 PERFORM 1 FROM public.organization WHERE id=NEW.organization_id FOR UPDATE;
 SELECT * INTO p FROM public.project WHERE organization_id=NEW.organization_id AND id=NEW.project_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'project unavailable' USING ERRCODE='23503'; END IF;
 IF p.status IN ('ARCHIVED','COMPLETED') AND NOT(TG_OP='UPDATE' AND NEW.assignee_id IS NULL AND (to_jsonb(NEW)-ARRAY['assignee_id','revision','updated_at'])=(to_jsonb(OLD)-ARRAY['assignee_id','revision','updated_at'])) THEN
 RAISE EXCEPTION 'project read only' USING ERRCODE='23514'; END IF;
 IF NEW.assignee_id IS NOT NULL AND NEW.status NOT IN ('DONE','CANCELLED') THEN
 SELECT * INTO m FROM public.project_membership WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND id=NEW.assignee_id FOR UPDATE;
 IF NOT FOUND OR m.status<>'ACTIVE' OR m.role='VIEWER' OR NOT public.eligible_member((SELECT user_id FROM public.membership WHERE organization_id=NEW.organization_id AND id=m.membership_id)) THEN
 RAISE EXCEPTION 'ineligible assignee' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.milestone_id IS NOT NULL AND NEW.status NOT IN ('DONE','CANCELLED') THEN
 UPDATE public.milestone SET status='OPEN',revision=revision+1 WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND id=NEW.milestone_id AND status='COMPLETED' RETURNING id INTO reopening;
 IF reopening IS NOT NULL THEN
 INSERT INTO public.tenant_event(organization_id,kind,target_id) VALUES(NEW.organization_id,'core.changed',reopening::text);
 END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER core_work_guard BEFORE INSERT OR UPDATE ON public.task FOR EACH ROW EXECUTE FUNCTION public.core_work_guard();
CREATE FUNCTION public.core_assignment_revocation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE t public.task; who text;
BEGIN
 IF TG_TABLE_NAME='membership' AND NEW.status='ACTIVE' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='project_membership' AND NEW.status='ACTIVE' AND NEW.role IN ('MANAGER','CONTRIBUTOR') THEN RETURN NEW; END IF;
 PERFORM 1 FROM public.organization WHERE id=NEW.organization_id FOR UPDATE;
 who:=nullif(current_setting('app.actor_id',true),'');
 IF who IS NULL THEN SELECT user_id INTO who FROM public.membership WHERE organization_id=NEW.organization_id AND id=CASE WHEN TG_TABLE_NAME='membership' THEN NEW.id ELSE NEW.membership_id END; END IF;
 FOR t IN UPDATE public.task SET assignee_id=NULL,revision=revision+1 WHERE organization_id=NEW.organization_id AND status NOT IN ('DONE','CANCELLED') AND assignee_id IN (
 SELECT pm.id FROM public.project_membership pm WHERE pm.organization_id=NEW.organization_id AND CASE WHEN TG_TABLE_NAME='membership' THEN pm.membership_id=NEW.id ELSE pm.id=NEW.id END) RETURNING * LOOP
 INSERT INTO public.task_history(organization_id,project_id,task_id,actor_id,kind) VALUES(t.organization_id,t.project_id,t.id,who,'assignment.cleared');
 INSERT INTO public.audit_event(organization_id,actor_id,action,target_id,request_id) VALUES(t.organization_id,who,'assignment.cleared',t.id::text,gen_random_uuid());
 INSERT INTO public.tenant_event(organization_id,kind,target_id) VALUES(t.organization_id,'core.changed',t.id::text);
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER core_assignment_revocation AFTER UPDATE ON public.membership FOR EACH ROW EXECUTE FUNCTION public.core_assignment_revocation();
CREATE TRIGGER core_assignment_revocation AFTER UPDATE ON public.project_membership FOR EACH ROW EXECUTE FUNCTION public.core_assignment_revocation();
CREATE FUNCTION public.core_completion_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 PERFORM 1 FROM public.organization WHERE id=NEW.organization_id FOR UPDATE;
 IF TG_TABLE_NAME='milestone' AND NEW.status='COMPLETED' AND EXISTS(SELECT 1 FROM public.task WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND milestone_id=NEW.id AND status NOT IN ('DONE','CANCELLED')) THEN
 RAISE EXCEPTION 'unfinished milestone work' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='project' AND NEW.status='COMPLETED' AND EXISTS(SELECT 1 FROM public.task WHERE organization_id=NEW.organization_id AND project_id=NEW.id AND status NOT IN ('DONE','CANCELLED')) THEN
 RAISE EXCEPTION 'unfinished project work' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER core_completion_guard BEFORE UPDATE ON public.project FOR EACH ROW EXECUTE FUNCTION public.core_completion_guard();
CREATE TRIGGER core_completion_guard BEFORE UPDATE ON public.milestone FOR EACH ROW EXECUTE FUNCTION public.core_completion_guard();
REVOKE ALL ON FUNCTION public.core_work_guard(), public.core_assignment_revocation(), public.core_completion_guard() FROM PUBLIC;
