-- Forward extension; 0010 is applied and remains immutable.
CREATE OR REPLACE FUNCTION public.core_assignment_revocation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE t public.task; who text; membership uuid;
BEGIN
 IF TG_TABLE_NAME='membership' AND NEW.status='ACTIVE' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='project_membership' AND NEW.status='ACTIVE' AND to_jsonb(NEW)->>'role' IN ('MANAGER','CONTRIBUTOR') THEN RETURN NEW; END IF;
 PERFORM 1 FROM public.organization WHERE id=NEW.organization_id FOR UPDATE;
 membership:=CASE WHEN TG_TABLE_NAME='membership' THEN NEW.id ELSE (to_jsonb(NEW)->>'membership_id')::uuid END;
 who:=nullif(current_setting('app.actor_id',true),'');
 IF who IS NULL THEN SELECT user_id INTO who FROM public.membership WHERE organization_id=NEW.organization_id AND id=membership; END IF;
 FOR t IN UPDATE public.task SET assignee_id=NULL,revision=revision+1 WHERE organization_id=NEW.organization_id AND status NOT IN ('DONE','CANCELLED') AND assignee_id IN (
 SELECT pm.id FROM public.project_membership pm WHERE pm.organization_id=NEW.organization_id AND CASE WHEN TG_TABLE_NAME='membership' THEN pm.membership_id=NEW.id ELSE pm.id=NEW.id END) RETURNING * LOOP
 INSERT INTO public.task_history(organization_id,project_id,task_id,actor_id,kind) VALUES(t.organization_id,t.project_id,t.id,who,'assignment.cleared');
 INSERT INTO public.audit_event(organization_id,actor_id,action,target_id,request_id) VALUES(t.organization_id,who,'assignment.cleared',t.id::text,gen_random_uuid());
 INSERT INTO public.tenant_event(organization_id,kind,target_id) VALUES(t.organization_id,'core.changed',t.id::text);
 END LOOP;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.core_completion_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 PERFORM 1 FROM public.organization WHERE id=NEW.organization_id FOR UPDATE;
 IF TG_TABLE_NAME='milestone' THEN
 IF NEW.status='COMPLETED' AND EXISTS(SELECT 1 FROM public.task WHERE organization_id=NEW.organization_id AND project_id=(to_jsonb(NEW)->>'project_id')::uuid AND milestone_id=NEW.id AND status NOT IN ('DONE','CANCELLED')) THEN RAISE EXCEPTION 'unfinished milestone work' USING ERRCODE='23514'; END IF;
 ELSE
 IF NEW.status='COMPLETED' AND EXISTS(SELECT 1 FROM public.task WHERE organization_id=NEW.organization_id AND project_id=NEW.id AND status NOT IN ('DONE','CANCELLED')) THEN RAISE EXCEPTION 'unfinished project work' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER TABLE public.invitation ADD COLUMN purpose text NOT NULL DEFAULT 'INTERNAL' CHECK(purpose IN ('INTERNAL','CLIENT'));
ALTER TABLE public.invitation ADD COLUMN contact_id uuid;
ALTER TABLE public.invitation ADD COLUMN project_id uuid;
ALTER TABLE public.invitation ADD COLUMN project_role text;
ALTER TABLE public.invitation DROP CONSTRAINT invitation_role_check;
ALTER TABLE public.invitation ADD CONSTRAINT invitation_role_check CHECK(role IN ('ADMIN','MEMBER','CLIENT'));
ALTER TABLE public.invitation ADD CONSTRAINT invitation_target_shape CHECK((purpose='INTERNAL' AND role IN ('ADMIN','MEMBER') AND contact_id IS NULL AND project_id IS NULL AND project_role IS NULL) OR (purpose='CLIENT' AND role='CLIENT' AND contact_id IS NOT NULL AND project_id IS NOT NULL AND project_role IN ('VIEWER','REVIEWER','APPROVER')));
ALTER TABLE public.invitation ADD FOREIGN KEY(organization_id,contact_id) REFERENCES public.client_contact(organization_id,id);
ALTER TABLE public.invitation ADD FOREIGN KEY(organization_id,project_id) REFERENCES public.project(organization_id,id);
DROP INDEX public.invitation_pending;
CREATE UNIQUE INDEX invitation_pending ON public.invitation(organization_id,email) WHERE purpose='INTERNAL' AND accepted_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX client_invitation_pending ON public.invitation(organization_id,contact_id,project_id) WHERE purpose='CLIENT' AND accepted_at IS NULL AND revoked_at IS NULL;
GRANT SELECT ON public.client_contact,public.client_project_access,public.project TO dw2_resolver;
CREATE POLICY resolver_contact ON public.client_contact TO dw2_resolver USING(true);
CREATE POLICY resolver_access ON public.client_project_access TO dw2_resolver USING(true);
CREATE POLICY resolver_project ON public.project TO dw2_resolver USING(true);
GRANT CREATE ON SCHEMA public TO dw2_resolver;
CREATE FUNCTION public.client_principals_page(uid text,after_id uuid) RETURNS TABLE(id uuid,organization_id uuid,name text,role text,capacity text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT c.id,c.organization_id,c.name,'CLIENT'::text,'CLIENT'::text FROM public.client_contact c JOIN public.organization o ON o.id=c.organization_id
 WHERE c.user_id=uid AND c.status='ACTIVE' AND o.status='ACTIVE' AND (after_id IS NULL OR c.id>after_id) ORDER BY c.id LIMIT 51
$$;
ALTER FUNCTION public.client_principals_page(text,uuid) OWNER TO dw2_resolver;
REVOKE CREATE ON SCHEMA public FROM dw2_resolver;
REVOKE ALL ON FUNCTION public.client_principals_page(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_principals_page(text,uuid) TO dw2_api;
