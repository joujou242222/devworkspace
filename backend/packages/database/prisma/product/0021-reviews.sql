-- Additive exact-version review domain. Existing canonical bytes and migrations are retained.
ALTER TABLE public.deliverable_version ADD UNIQUE(organization_id,project_id,id);
ALTER TABLE public.client_project_access ADD UNIQUE(organization_id,project_id,contact_id,id);
CREATE TABLE public.version_share (
 organization_id uuid NOT NULL, project_id uuid NOT NULL, version_id uuid PRIMARY KEY,
 status text NOT NULL CHECK(status IN ('ACTIVE','REVOKED')), revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 actor_id text NOT NULL REFERENCES public.identity_user(id), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id,version_id) REFERENCES public.deliverable_version(organization_id,project_id,id)
);
CREATE TABLE public.review_cycle (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, deliverable_id uuid NOT NULL, version_id uuid NOT NULL,
 cycle_number integer NOT NULL CHECK(cycle_number>0), policy text NOT NULL DEFAULT 'ANY_ONE' CHECK(policy='ANY_ONE'),
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','APPROVED','CHANGES_REQUESTED','CANCELLED','SUPERSEDED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), opener_id text NOT NULL REFERENCES public.identity_user(id),
 created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz, due_at timestamptz, replaces_cycle_id uuid,
 CHECK((status='OPEN')=(closed_at IS NULL)),
 UNIQUE(organization_id,project_id,id), UNIQUE(organization_id,project_id,id,version_id), UNIQUE(organization_id,project_id,deliverable_id,id),
 UNIQUE(organization_id,version_id,cycle_number), UNIQUE(replaces_cycle_id),
 FOREIGN KEY(organization_id,project_id,deliverable_id,version_id) REFERENCES public.deliverable_version(organization_id,project_id,deliverable_id,id),
 FOREIGN KEY(organization_id,project_id,deliverable_id,replaces_cycle_id) REFERENCES public.review_cycle(organization_id,project_id,deliverable_id,id)
);
CREATE UNIQUE INDEX review_one_open ON public.review_cycle(organization_id,deliverable_id) WHERE status='OPEN';
CREATE INDEX review_project_list ON public.review_cycle(organization_id,project_id,status,id);
CREATE TABLE public.review_participant (
 organization_id uuid NOT NULL, project_id uuid NOT NULL, cycle_id uuid NOT NULL, contact_id uuid NOT NULL, grant_id uuid NOT NULL,
 role text NOT NULL CHECK(role='APPROVER'), PRIMARY KEY(cycle_id,contact_id), UNIQUE(organization_id,project_id,cycle_id,contact_id,grant_id),
 FOREIGN KEY(organization_id,project_id,cycle_id) REFERENCES public.review_cycle(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id,contact_id,grant_id) REFERENCES public.client_project_access(organization_id,project_id,contact_id,id)
);
CREATE TABLE public.review_decision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, cycle_id uuid UNIQUE NOT NULL, version_id uuid NOT NULL,
 contact_id uuid NOT NULL, grant_id uuid NOT NULL, actor_id text NOT NULL REFERENCES public.identity_user(id),
 decision text NOT NULL CHECK(decision IN ('APPROVED','CHANGES_REQUESTED')), reason text NOT NULL CHECK(length(reason)<=10000),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(decision<>'CHANGES_REQUESTED' OR length(btrim(reason))>0),
 UNIQUE(organization_id,project_id,cycle_id,version_id,id),
 FOREIGN KEY(organization_id,project_id,cycle_id,version_id) REFERENCES public.review_cycle(organization_id,project_id,id,version_id),
 FOREIGN KEY(organization_id,project_id,cycle_id,contact_id,grant_id) REFERENCES public.review_participant(organization_id,project_id,cycle_id,contact_id,grant_id)
);
CREATE TABLE public.approval (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, cycle_id uuid UNIQUE NOT NULL, version_id uuid UNIQUE NOT NULL,
 decision_id uuid UNIQUE NOT NULL, digest text NOT NULL, actor_id text NOT NULL REFERENCES public.identity_user(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id,cycle_id,version_id,decision_id) REFERENCES public.review_decision(organization_id,project_id,cycle_id,version_id,id)
);
CREATE TABLE public.feedback_thread (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, cycle_id uuid NOT NULL, version_id uuid NOT NULL,
 actor_id text NOT NULL REFERENCES public.identity_user(id), principal_id uuid NOT NULL, capacity text NOT NULL CHECK(capacity IN ('INTERNAL','CLIENT')),
 visibility text NOT NULL CHECK(visibility IN ('INTERNAL','CLIENT')), body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 10000),
 annotation jsonb, digest text NOT NULL, source_width integer, source_height integer, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,project_id,id), FOREIGN KEY(organization_id,project_id,cycle_id,version_id) REFERENCES public.review_cycle(organization_id,project_id,id,version_id)
);
CREATE TABLE public.feedback_reply (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, thread_id uuid NOT NULL,
 actor_id text NOT NULL REFERENCES public.identity_user(id), principal_id uuid NOT NULL, capacity text NOT NULL CHECK(capacity IN ('INTERNAL','CLIENT')),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 10000), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id,thread_id) REFERENCES public.feedback_thread(organization_id,project_id,id)
);
CREATE TABLE public.feedback_resolution (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, thread_id uuid NOT NULL,
 actor_id text NOT NULL REFERENCES public.identity_user(id), state text NOT NULL CHECK(state IN ('RESOLVED','REOPENED')), note text NOT NULL CHECK(length(note)<=2000), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id,thread_id) REFERENCES public.feedback_thread(organization_id,project_id,id)
);
ALTER TABLE public.task ADD COLUMN source_feedback_thread_id uuid,
 ADD FOREIGN KEY(organization_id,project_id,source_feedback_thread_id) REFERENCES public.feedback_thread(organization_id,project_id,id);
CREATE UNIQUE INDEX task_feedback_source ON public.task(organization_id,project_id,source_feedback_thread_id) WHERE source_feedback_thread_id IS NOT NULL;
CREATE FUNCTION public.review_cycle_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF (to_jsonb(NEW)-ARRAY['status','revision','closed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','revision','closed_at']) OR OLD.status<>'OPEN' OR NEW.status='OPEN' OR NEW.revision<>OLD.revision+1 THEN
 RAISE EXCEPTION 'immutable review target or terminal state' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER review_cycle_guard BEFORE UPDATE ON public.review_cycle FOR EACH ROW EXECUTE FUNCTION public.review_cycle_guard();
CREATE FUNCTION public.feedback_source_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.source_feedback_thread_id IS DISTINCT FROM OLD.source_feedback_thread_id THEN RAISE EXCEPTION 'immutable feedback source' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER feedback_source_guard BEFORE UPDATE ON public.task FOR EACH ROW EXECUTE FUNCTION public.feedback_source_guard();
CREATE FUNCTION public.review_fact_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c public.review_cycle; v public.deliverable_version; d public.review_decision; a public.approval;
BEGIN
 SELECT * INTO c FROM public.review_cycle WHERE organization_id=NEW.organization_id AND id=CASE WHEN TG_TABLE_NAME='review_cycle' THEN NEW.id ELSE NEW.cycle_id END;
 SELECT * INTO v FROM public.deliverable_version WHERE organization_id=c.organization_id AND id=c.version_id;
 SELECT * INTO d FROM public.review_decision WHERE organization_id=c.organization_id AND cycle_id=c.id;
 SELECT * INTO a FROM public.approval WHERE organization_id=c.organization_id AND cycle_id=c.id;
 IF (c.status IN ('APPROVED','CHANGES_REQUESTED')) IS DISTINCT FROM (d.id IS NOT NULL) OR (d.id IS NOT NULL AND (d.decision<>c.status OR d.digest<>v.digest)) OR (c.status='APPROVED') IS DISTINCT FROM (a.id IS NOT NULL) OR (a.id IS NOT NULL AND (a.digest<>v.digest OR a.actor_id<>d.actor_id)) THEN
 RAISE EXCEPTION 'inconsistent decision facts' USING ERRCODE='23514'; END IF; RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['version_share','review_cycle','review_participant','review_decision','approval','feedback_thread','feedback_reply','feedback_resolution'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_scope ON public.%I USING(organization_id=public.tenant_id()) WITH CHECK(organization_id=public.tenant_id())',t);
 EXECUTE format('GRANT SELECT,INSERT ON public.%I TO dw2_api',t);
 IF t NOT IN ('version_share','review_cycle') THEN EXECUTE format('CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.append_only()',t); END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['review_cycle','review_decision','approval'] LOOP
 EXECUTE format('CREATE CONSTRAINT TRIGGER review_fact_guard AFTER INSERT OR UPDATE ON public.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.review_fact_guard()',t);
 END LOOP;
END $$;
GRANT UPDATE ON public.version_share,public.review_cycle TO dw2_api;
REVOKE ALL ON FUNCTION public.review_cycle_guard(),public.feedback_source_guard(),public.review_fact_guard() FROM PUBLIC;
