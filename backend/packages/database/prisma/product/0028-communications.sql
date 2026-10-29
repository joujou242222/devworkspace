-- Phase 6. No historical envelope rewriting or notification backfill.
GRANT USAGE ON SCHEMA public TO dw2_communications;
GRANT EXECUTE ON FUNCTION public.tenant_id(),public.assert_session(text,text) TO dw2_communications;
GRANT SELECT ON public.organization,public.membership,public.project,public.project_membership,public.client,public.client_contact,public.client_project_access,public.task,public.task_checklist,public.milestone,public.deliverable,public.deliverable_version,public.review_cycle,public.feedback_thread,public.version_share,public.file_access TO dw2_communications;
GRANT UPDATE ON public.organization TO dw2_communications;
GRANT SELECT(id,active,"emailVerified") ON public.identity_user TO dw2_communications;
GRANT SELECT ON public.delivery,public.tenant_event,public.consumer_receipt TO dw2_communications;
GRANT INSERT ON public.consumer_receipt,public.identity_audit TO dw2_communications;
CREATE POLICY communications_event_lookup ON public.tenant_event TO dw2_communications USING(true);

CREATE TABLE public.notification_preference (
 user_id text PRIMARY KEY REFERENCES public.identity_user(id), assignments boolean NOT NULL DEFAULT true,
 reviews boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 1 CHECK(revision>0)
);
GRANT SELECT,INSERT,UPDATE ON public.notification_preference TO dw2_communications;
CREATE FUNCTION public.read_notification_preferences(uid text,sid text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.notification_preference;
BEGIN PERFORM public.assert_session(sid,uid);
 SELECT * INTO p FROM public.notification_preference WHERE user_id=uid;
 RETURN jsonb_build_object('assignments',coalesce(p.assignments,true),'reviews',coalesce(p.reviews,true),'revision',coalesce(p.revision,1)); END $$;
CREATE FUNCTION public.save_notification_preferences(uid text,sid text,a boolean,r boolean,rev integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_rev integer;
BEGIN PERFORM public.assert_session(sid,uid);
 PERFORM pg_advisory_xact_lock(hashtextextended('notification-preference:'||uid,0));
 SELECT revision INTO current_rev FROM public.notification_preference WHERE user_id=uid;
 IF coalesce(current_rev,1)<>rev THEN RAISE EXCEPTION 'stale preferences' USING ERRCODE='P0412'; END IF;
 INSERT INTO public.notification_preference(user_id,assignments,reviews,revision) VALUES(uid,a,r,rev+1)
 ON CONFLICT(user_id) DO UPDATE SET assignments=a,reviews=r,revision=rev+1;
 INSERT INTO public.identity_audit(user_id,action) VALUES(uid,'notification.preferences.updated');
 RETURN jsonb_build_object('assignments',a,'reviews',r,'revision',rev+1); END $$;

ALTER TABLE public.tenant_event ADD COLUMN schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version IN (1,6)),
 ADD COLUMN project_id uuid, ADD COLUMN resource_kind text CHECK(resource_kind IN ('TASK','REVIEW','VERSION','PROJECT')),
 ADD COLUMN resource_id uuid, ADD COLUMN resource_revision integer, ADD COLUMN action text,
 ADD COLUMN assignment_id uuid,
 ADD FOREIGN KEY(organization_id,project_id) REFERENCES public.project(organization_id,id);
-- The envelope captures the resource and assignee at the actual mutation, never the latest version pointer.
CREATE FUNCTION public.capture_communication_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE x uuid; f public.feedback_thread;
BEGIN
 NEW.schema_version:=6; NEW.action:=coalesce(NEW.action,NEW.kind);
 IF NEW.kind='core.changed' THEN
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
 -- Other lifecycle events produce only scoped invalidation hints, not invented categories.
 IF NEW.resource_id IS NULL THEN
  SELECT id,id,revision INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.project WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id;
  IF NEW.resource_id IS NULL THEN
   SELECT project_id,project_id,revision INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.milestone WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id;
  END IF;
  IF NEW.resource_id IS NOT NULL THEN NEW.resource_kind:='PROJECT'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER capture_communication_event BEFORE INSERT ON public.tenant_event FOR EACH ROW EXECUTE FUNCTION public.capture_communication_event();

CREATE FUNCTION public.notification_access(oid uuid,uid text,pid uuid,cap text,project uuid,kind text,target uuid,action text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE role text;
BEGIN
 IF oid IS DISTINCT FROM public.tenant_id() OR NOT EXISTS(SELECT 1 FROM public.identity_user WHERE id=uid AND active AND "emailVerified") OR NOT EXISTS(SELECT 1 FROM public.organization WHERE id=oid AND status='ACTIVE') THEN RETURN false; END IF;
 IF cap='INTERNAL' THEN
  SELECT m.role INTO role FROM public.membership m WHERE m.organization_id=oid AND m.id=pid AND m.user_id=uid AND m.status='ACTIVE';
  IF role IS NULL OR NOT EXISTS(SELECT 1 FROM public.project WHERE organization_id=oid AND id=project) OR (role='MEMBER' AND NOT EXISTS(SELECT 1 FROM public.project_membership WHERE organization_id=oid AND project_id=project AND membership_id=pid AND status='ACTIVE')) THEN RETURN false; END IF;
  RETURN CASE kind WHEN 'TASK' THEN EXISTS(SELECT 1 FROM public.task WHERE organization_id=oid AND project_id=project AND id=target)
   WHEN 'REVIEW' THEN EXISTS(SELECT 1 FROM public.review_cycle WHERE organization_id=oid AND project_id=project AND id=target)
   WHEN 'VERSION' THEN EXISTS(SELECT 1 FROM public.deliverable_version WHERE organization_id=oid AND project_id=project AND id=target)
   WHEN 'PROJECT' THEN target=project ELSE false END;
 END IF;
 IF cap<>'CLIENT' OR kind NOT IN ('REVIEW','VERSION') OR action NOT IN ('review.opened','review.replaced','review.decided','review.cancelled','review.changed','version.shared','feedback.created','feedback.replied') THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.client_contact c JOIN public.client_project_access g ON g.organization_id=c.organization_id AND g.contact_id=c.id JOIN public.project p ON p.organization_id=g.organization_id AND p.id=g.project_id AND p.client_id=c.client_id JOIN public.client x ON x.organization_id=p.organization_id AND x.id=p.client_id
  WHERE c.organization_id=oid AND c.id=pid AND c.user_id=uid AND c.status='ACTIVE' AND g.status='ACTIVE' AND p.id=project AND p.portal_enabled AND p.status<>'ARCHIVED' AND x.status='ACTIVE') THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM public.deliverable_version v JOIN public.version_share s ON s.organization_id=v.organization_id AND s.project_id=v.project_id AND s.version_id=v.id AND s.status='ACTIVE'
  JOIN public.deliverable d ON d.organization_id=v.organization_id AND d.project_id=v.project_id AND d.id=v.deliverable_id AND d.status='ACTIVE'
  JOIN public.file_access a ON a.organization_id=v.organization_id AND a.project_id=v.project_id AND a.asset_id=v.asset_id AND a.status='AVAILABLE'
  WHERE v.organization_id=oid AND v.project_id=project AND ((kind='VERSION' AND v.id=target) OR (kind='REVIEW' AND EXISTS(SELECT 1 FROM public.review_cycle c WHERE c.organization_id=oid AND c.project_id=project AND c.id=target AND c.version_id=v.id))));
END $$;

CREATE TABLE public.notification (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, user_id text NOT NULL REFERENCES public.identity_user(id),
 principal_id uuid NOT NULL, capacity text NOT NULL CHECK(capacity IN ('INTERNAL','CLIENT')),
 category text NOT NULL CHECK(category IN ('assignments','reviews')), event_id uuid NOT NULL,
 project_id uuid NOT NULL, resource_kind text NOT NULL CHECK(resource_kind IN ('TASK','REVIEW','VERSION')),
 resource_id uuid NOT NULL, action text NOT NULL, occurred_at timestamptz NOT NULL, read_at timestamptz,
 UNIQUE(organization_id,event_id,user_id,principal_id,capacity,category),
 FOREIGN KEY(organization_id,event_id) REFERENCES public.tenant_event(organization_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES public.project(organization_id,id)
);
ALTER TABLE public.notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification FORCE ROW LEVEL SECURITY;
CREATE POLICY recipient_scope ON public.notification TO dw2_api USING(
 organization_id=public.tenant_id() AND user_id=current_setting('app.notification_user',true) AND principal_id::text=current_setting('app.notification_principal',true) AND capacity=current_setting('app.notification_capacity',true)
 AND public.notification_access(organization_id,user_id,principal_id,capacity,project_id,resource_kind,resource_id,action)) WITH CHECK(organization_id=public.tenant_id() AND user_id=current_setting('app.notification_user',true));
CREATE POLICY materializer_scope ON public.notification TO dw2_communications USING(organization_id=public.tenant_id()) WITH CHECK(organization_id=public.tenant_id());
GRANT SELECT,UPDATE(read_at) ON public.notification TO dw2_api;
GRANT SELECT,INSERT ON public.notification TO dw2_communications;
CREATE INDEX notification_recipient ON public.notification(organization_id,user_id,principal_id,capacity,occurred_at DESC,id DESC);
CREATE INDEX notification_unread ON public.notification(organization_id,user_id,principal_id,capacity) WHERE read_at IS NULL;
CREATE FUNCTION public.notification_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'read_at') IS DISTINCT FROM (to_jsonb(OLD)-'read_at') OR OLD.read_at IS NOT NULL OR NEW.read_at IS NULL THEN RAISE EXCEPTION 'immutable notification history' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER notification_history_guard BEFORE UPDATE OR DELETE ON public.notification FOR EACH ROW EXECUTE FUNCTION public.notification_history_guard();

CREATE FUNCTION public.materialize_notifications(eid uuid,ls uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e public.tenant_event; who record; enabled boolean; category text; created integer:=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.delivery WHERE lane='tenant' AND event_id=eid AND lease=ls AND lease_until>now() AND completed_at IS NULL) THEN RAISE EXCEPTION 'lease unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.tenant_event WHERE id=eid;
 IF e.id IS NULL THEN RAISE EXCEPTION 'unknown event' USING ERRCODE='42501'; END IF;
 PERFORM set_config('app.organization_id',e.organization_id::text,true);
 PERFORM 1 FROM public.organization WHERE id=e.organization_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.consumer_receipt WHERE lane='tenant' AND event_id=eid AND handler='notifications-v6') THEN RETURN jsonb_build_object('event_id',eid,'organization_id',e.organization_id,'replay',true); END IF;
 IF e.schema_version=6 AND e.resource_kind IN ('TASK','REVIEW','VERSION') THEN
  category:=CASE WHEN e.resource_kind='TASK' THEN 'assignments' ELSE 'reviews' END;
  FOR who IN
   SELECT m.user_id,m.id principal_id,'INTERNAL'::text capacity FROM public.membership m WHERE m.organization_id=e.organization_id AND m.status='ACTIVE'
    AND (e.resource_kind<>'TASK' OR (m.id=e.assignment_id AND EXISTS(SELECT 1 FROM public.task t WHERE t.organization_id=e.organization_id AND t.project_id=e.project_id AND t.id=e.resource_id AND t.assignee_id=e.assignment_id)))
   UNION ALL SELECT c.user_id,c.id,'CLIENT' FROM public.client_contact c WHERE c.organization_id=e.organization_id AND c.status='ACTIVE' AND c.user_id IS NOT NULL AND e.resource_kind IN ('REVIEW','VERSION')
  ORDER BY 1,2,3 LOOP
   -- Permission precedes the narrow preference port and the same ordering applies on reads.
   IF public.notification_access(e.organization_id,who.user_id,who.principal_id,who.capacity,e.project_id,e.resource_kind,e.resource_id,e.action) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('notification-preference:'||who.user_id,0));
    SELECT CASE WHEN category='assignments' THEN p.assignments ELSE p.reviews END INTO enabled FROM public.notification_preference p WHERE p.user_id=who.user_id;
    IF coalesce(enabled,true) THEN
     INSERT INTO public.notification(organization_id,user_id,principal_id,capacity,category,event_id,project_id,resource_kind,resource_id,action,occurred_at)
      VALUES(e.organization_id,who.user_id,who.principal_id,who.capacity,category,eid,e.project_id,e.resource_kind,e.resource_id,e.action,e.created_at) ON CONFLICT DO NOTHING;
     created:=created+1;
    END IF;
   END IF;
  END LOOP;
 END IF;
 INSERT INTO public.consumer_receipt(lane,event_id,handler) VALUES('tenant',eid,'notifications-v6');
 RETURN jsonb_build_object('event_id',eid,'organization_id',e.organization_id,'replay',false,'created',created);
END $$;

-- Tenant completion now requires the durable materializer receipt. Identity mail is unchanged.
GRANT CREATE ON SCHEMA public TO dw2_dispatch_owner;
SET LOCAL ROLE dw2_dispatch_owner;
CREATE OR REPLACE FUNCTION public.finish_event(l text,e uuid,ls uuid,ok boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE changed integer;
BEGIN
 IF ok AND l='tenant' AND EXISTS(SELECT 1 FROM public.tenant_event WHERE id=e AND schema_version=6) AND NOT EXISTS(SELECT 1 FROM public.consumer_receipt WHERE lane=l AND event_id=e AND handler='notifications-v6') THEN RAISE EXCEPTION 'notification receipt required' USING ERRCODE='23514'; END IF;
 UPDATE public.delivery SET completed_at=CASE WHEN ok THEN now() ELSE NULL END,error_code=CASE WHEN ok THEN NULL ELSE 'DELIVERY_FAILED' END,
 available_at=now()+make_interval(secs=>least(300,power(2,attempts)::integer)),lease_until=NULL WHERE lane=l AND event_id=e AND lease=ls AND completed_at IS NULL AND lease_until>now();
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed=1 AND ok THEN INSERT INTO public.consumer_receipt(lane,event_id,handler) VALUES(l,e,'phase2') ON CONFLICT DO NOTHING; END IF;
 RETURN changed=1;
END $$;
SET LOCAL ROLE dw2_owner;
REVOKE CREATE ON SCHEMA public FROM dw2_dispatch_owner;
GRANT CREATE ON SCHEMA public TO dw2_communications;
ALTER FUNCTION public.read_notification_preferences(text,text) OWNER TO dw2_communications;
ALTER FUNCTION public.save_notification_preferences(text,text,boolean,boolean,integer) OWNER TO dw2_communications;
ALTER FUNCTION public.notification_access(uuid,text,uuid,text,uuid,text,uuid,text) OWNER TO dw2_communications;
ALTER FUNCTION public.materialize_notifications(uuid,uuid) OWNER TO dw2_communications;
ALTER FUNCTION public.capture_communication_event() OWNER TO dw2_communications;
REVOKE CREATE ON SCHEMA public FROM dw2_communications;
REVOKE ALL ON FUNCTION public.read_notification_preferences(text,text),public.save_notification_preferences(text,text,boolean,boolean,integer),public.notification_access(uuid,text,uuid,text,uuid,text,uuid,text),public.materialize_notifications(uuid,uuid),public.capture_communication_event(),public.notification_history_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_notification_preferences(text,text),public.save_notification_preferences(text,text,boolean,boolean,integer),public.notification_access(uuid,text,uuid,text,uuid,text,uuid,text) TO dw2_api;
GRANT EXECUTE ON FUNCTION public.materialize_notifications(uuid,uuid) TO dw2_worker;
