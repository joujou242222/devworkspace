-- Extend the existing communications purpose and lease-bound consumer. No notification backfill.
ALTER TABLE public.tenant_event DROP CONSTRAINT tenant_event_resource_kind_check;
ALTER TABLE public.tenant_event ADD CHECK(resource_kind IN ('TASK','REVIEW','VERSION','PROJECT','DISCUSSION','DOCUMENT','UPDATE'));
ALTER TABLE public.notification DROP CONSTRAINT notification_category_check;
ALTER TABLE public.notification DROP CONSTRAINT notification_resource_kind_check;
ALTER TABLE public.notification ADD CHECK(category IN ('assignments','reviews','discussions_documents','client_updates'));
ALTER TABLE public.notification ADD CHECK(resource_kind IN ('TASK','REVIEW','VERSION','DISCUSSION','DOCUMENT','UPDATE'));
ALTER TABLE public.notification ADD CHECK((category='discussions_documents')=(resource_kind IN ('DISCUSSION','DOCUMENT')) AND (category='client_updates')=(resource_kind='UPDATE'));
ALTER TABLE public.notification_preference ADD discussions_documents boolean NOT NULL DEFAULT true, ADD client_updates boolean NOT NULL DEFAULT true;
CREATE TABLE public.project_activity (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,project_id uuid NOT NULL,event_id uuid NOT NULL,
 action text NOT NULL,summary text NOT NULL,actor text NOT NULL,created_at timestamptz NOT NULL,
 UNIQUE(organization_id,project_id,event_id),FOREIGN KEY(organization_id,project_id) REFERENCES public.project(organization_id,id),FOREIGN KEY(organization_id,event_id) REFERENCES public.tenant_event(organization_id,id)
);
ALTER TABLE public.project_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON public.project_activity USING(organization_id=public.tenant_id()) WITH CHECK(organization_id=public.tenant_id());
GRANT SELECT ON public.project_activity TO dw2_api;
GRANT SELECT,INSERT ON public.project_activity TO dw2_communications;
CREATE INDEX activity_page ON public.project_activity(organization_id,project_id,created_at DESC,id DESC);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON public.project_activity FOR EACH ROW EXECUTE FUNCTION public.append_only();
GRANT SELECT ON public.project_upload,public.project_file,public.project_folder TO dw2_communications;
GRANT CREATE ON SCHEMA public TO dw2_communications;
SET LOCAL ROLE dw2_communications;
CREATE FUNCTION public.capture_expansion_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.resource_id IS NULL THEN
  SELECT project_id,id,revision INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.discussion WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id;
  IF NEW.resource_id IS NOT NULL THEN NEW.resource_kind:='DISCUSSION'; END IF;
 END IF;
 IF NEW.resource_id IS NULL THEN
  SELECT project_id,id,revision INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.document WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id;
  IF NEW.resource_id IS NOT NULL THEN NEW.resource_kind:='DOCUMENT'; END IF;
 END IF;
 IF NEW.resource_id IS NULL THEN
  SELECT project_id,id,revision INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.client_update WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id;
  IF NEW.resource_id IS NOT NULL THEN NEW.resource_kind:='UPDATE'; END IF;
 END IF;
 IF NEW.resource_id IS NULL THEN
  SELECT project_id,project_id,revision INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.deliverable WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id;
  IF NEW.resource_id IS NULL THEN SELECT project_id,project_id,revision INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.project_file WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id; END IF;
  IF NEW.resource_id IS NULL THEN SELECT project_id,project_id,revision INTO NEW.project_id,NEW.resource_id,NEW.resource_revision FROM public.project_folder WHERE organization_id=NEW.organization_id AND id::text=NEW.target_id; END IF;
  IF NEW.resource_id IS NOT NULL THEN NEW.resource_kind:='PROJECT'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.notification_access(oid uuid,uid text,pid uuid,cap text,project uuid,kind text,target uuid,action text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE role text;
BEGIN
 IF oid IS DISTINCT FROM public.tenant_id() OR NOT EXISTS(SELECT 1 FROM public.identity_user WHERE id=uid AND active AND "emailVerified") OR NOT EXISTS(SELECT 1 FROM public.organization WHERE id=oid AND status='ACTIVE') THEN RETURN false; END IF;
 IF cap='INTERNAL' THEN
  SELECT m.role INTO role FROM public.membership m WHERE m.organization_id=oid AND m.id=pid AND m.user_id=uid AND m.status='ACTIVE';
  IF role IS NULL OR NOT EXISTS(SELECT 1 FROM public.project WHERE organization_id=oid AND id=notification_access.project) OR (role='MEMBER' AND NOT EXISTS(SELECT 1 FROM public.project_membership WHERE organization_id=oid AND project_id=notification_access.project AND membership_id=pid AND status='ACTIVE')) THEN RETURN false; END IF;
  RETURN CASE kind WHEN 'TASK' THEN EXISTS(SELECT 1 FROM public.task WHERE organization_id=oid AND project_id=notification_access.project AND id=target)
   WHEN 'REVIEW' THEN EXISTS(SELECT 1 FROM public.review_cycle WHERE organization_id=oid AND project_id=notification_access.project AND id=target)
   WHEN 'VERSION' THEN EXISTS(SELECT 1 FROM public.deliverable_version WHERE organization_id=oid AND project_id=notification_access.project AND id=target)
   WHEN 'DISCUSSION' THEN EXISTS(SELECT 1 FROM public.discussion WHERE organization_id=oid AND project_id=notification_access.project AND id=target)
   WHEN 'DOCUMENT' THEN EXISTS(SELECT 1 FROM public.document WHERE organization_id=oid AND project_id=notification_access.project AND id=target)
   WHEN 'UPDATE' THEN EXISTS(SELECT 1 FROM public.client_update WHERE organization_id=oid AND project_id=notification_access.project AND id=target AND status='PUBLISHED')
   WHEN 'PROJECT' THEN target=notification_access.project ELSE false END;
 END IF;
 IF cap<>'CLIENT' OR kind NOT IN ('REVIEW','VERSION','UPDATE') OR action NOT IN ('review.opened','review.replaced','review.decided','review.cancelled','review.changed','version.shared','feedback.created','feedback.replied','update.published') THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.client_contact c JOIN public.client_project_access g ON g.organization_id=c.organization_id AND g.contact_id=c.id JOIN public.project p ON p.organization_id=g.organization_id AND p.id=g.project_id AND p.client_id=c.client_id JOIN public.client x ON x.organization_id=p.organization_id AND x.id=p.client_id
  WHERE c.organization_id=oid AND c.id=pid AND c.user_id=uid AND c.status='ACTIVE' AND g.status='ACTIVE' AND p.id=notification_access.project AND p.portal_enabled AND p.status<>'ARCHIVED' AND x.status='ACTIVE') THEN RETURN false; END IF;
 IF kind='UPDATE' THEN RETURN action='update.published' AND EXISTS(SELECT 1 FROM public.client_update WHERE organization_id=oid AND project_id=notification_access.project AND id=target AND status='PUBLISHED'); END IF;
 RETURN EXISTS(SELECT 1 FROM public.deliverable_version v JOIN public.version_share s ON s.organization_id=v.organization_id AND s.project_id=v.project_id AND s.version_id=v.id AND s.status='ACTIVE'
  JOIN public.deliverable d ON d.organization_id=v.organization_id AND d.project_id=v.project_id AND d.id=v.deliverable_id AND d.status='ACTIVE'
  JOIN public.file_access a ON a.organization_id=v.organization_id AND a.project_id=v.project_id AND a.asset_id=v.asset_id AND a.status='AVAILABLE'
  WHERE v.organization_id=oid AND v.project_id=notification_access.project AND ((kind='VERSION' AND v.id=target) OR (kind='REVIEW' AND EXISTS(SELECT 1 FROM public.review_cycle c WHERE c.organization_id=oid AND c.project_id=notification_access.project AND c.id=target AND c.version_id=v.id))));
END $$;


CREATE OR REPLACE FUNCTION public.read_notification_preferences(uid text,sid text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.notification_preference;
BEGIN PERFORM public.assert_session(sid,uid);SELECT * INTO p FROM public.notification_preference WHERE user_id=uid;
 RETURN jsonb_build_object('assignments',coalesce(p.assignments,true),'reviews',coalesce(p.reviews,true),'discussions_documents',coalesce(p.discussions_documents,true),'client_updates',coalesce(p.client_updates,true),'revision',coalesce(p.revision,1)); END $$;
CREATE FUNCTION public.save_expansion_preferences(uid text,sid text,d boolean,c boolean,rev integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_rev integer;
BEGIN PERFORM public.assert_session(sid,uid);PERFORM pg_advisory_xact_lock(hashtextextended('notification-preference:'||uid,0));
 SELECT revision INTO current_rev FROM public.notification_preference WHERE user_id=uid;
 IF coalesce(current_rev,1)<>rev THEN RAISE EXCEPTION 'stale preferences' USING ERRCODE='P0412'; END IF;
 INSERT INTO public.notification_preference(user_id,discussions_documents,client_updates,revision) VALUES(uid,d,c,rev+1) ON CONFLICT(user_id) DO UPDATE SET discussions_documents=d,client_updates=c,revision=rev+1;
 INSERT INTO public.identity_audit(user_id,action) VALUES(uid,'notification.preferences.updated');
 RETURN public.read_notification_preferences(uid,sid);
END $$;
CREATE FUNCTION public.project_activity_materialize(eid uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE e public.tenant_event; p uuid;
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
 IF p IS NOT NULL AND e.kind IN ('core.changed','review.changed','file.changed') THEN
  INSERT INTO public.project_activity(organization_id,project_id,event_id,action,summary,actor,created_at) VALUES(e.organization_id,p,e.id,coalesce(e.action,e.kind),'Project lifecycle activity',CASE WHEN e.actor_id IS NULL THEN 'System' ELSE 'Team member' END,e.created_at) ON CONFLICT DO NOTHING;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.materialize_notifications(eid uuid,ls uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e public.tenant_event; who record; enabled boolean; category text; created integer:=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.delivery WHERE lane='tenant' AND event_id=eid AND lease=ls AND lease_until>now() AND completed_at IS NULL) THEN RAISE EXCEPTION 'lease unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.tenant_event WHERE id=eid;
 IF e.id IS NULL THEN RAISE EXCEPTION 'unknown event' USING ERRCODE='42501'; END IF;
 PERFORM set_config('app.organization_id',e.organization_id::text,true);
 PERFORM 1 FROM public.organization WHERE id=e.organization_id FOR UPDATE;
 PERFORM public.project_activity_materialize(eid);
 IF EXISTS(SELECT 1 FROM public.consumer_receipt WHERE lane='tenant' AND event_id=eid AND handler='notifications-v6') THEN RETURN jsonb_build_object('event_id',eid,'organization_id',e.organization_id,'replay',true); END IF;
 IF e.schema_version=6 AND e.resource_kind IN ('TASK','REVIEW','VERSION','DISCUSSION','DOCUMENT','UPDATE') THEN
  category:=CASE WHEN e.resource_kind='TASK' THEN 'assignments' WHEN e.resource_kind IN ('DISCUSSION','DOCUMENT') THEN 'discussions_documents' WHEN e.resource_kind='UPDATE' THEN 'client_updates' ELSE 'reviews' END;
  FOR who IN
   SELECT m.user_id,m.id principal_id,'INTERNAL'::text capacity FROM public.membership m WHERE m.organization_id=e.organization_id AND m.status='ACTIVE'
    AND (e.resource_kind<>'TASK' OR (m.id=e.assignment_id AND EXISTS(SELECT 1 FROM public.task t WHERE t.organization_id=e.organization_id AND t.project_id=e.project_id AND t.id=e.resource_id AND t.assignee_id=e.assignment_id)))
   UNION ALL SELECT c.user_id,c.id,'CLIENT' FROM public.client_contact c WHERE c.organization_id=e.organization_id AND c.status='ACTIVE' AND c.user_id IS NOT NULL AND e.resource_kind IN ('REVIEW','VERSION','UPDATE')
  ORDER BY 1,2,3 LOOP
   -- Permission precedes the narrow preference port and the same ordering applies on reads.
   IF public.notification_access(e.organization_id,who.user_id,who.principal_id,who.capacity,e.project_id,e.resource_kind,e.resource_id,e.action) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('notification-preference:'||who.user_id,0));
    SELECT CASE WHEN category='assignments' THEN p.assignments WHEN category='discussions_documents' THEN p.discussions_documents WHEN category='client_updates' THEN p.client_updates ELSE p.reviews END INTO enabled FROM public.notification_preference p WHERE p.user_id=who.user_id;
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


-- Existing durable events can populate safe activity only, never optional notifications.
DO $$ DECLARE eid uuid; BEGIN FOR eid IN SELECT id FROM public.tenant_event LOOP PERFORM public.project_activity_materialize(eid); END LOOP; END $$;
SET LOCAL ROLE dw2_owner;
CREATE TRIGGER capture_expansion_event BEFORE INSERT ON public.tenant_event FOR EACH ROW EXECUTE FUNCTION public.capture_expansion_event();
REVOKE CREATE ON SCHEMA public FROM dw2_communications;
REVOKE ALL ON FUNCTION public.capture_expansion_event(),public.project_activity_materialize(uuid),public.save_expansion_preferences(text,text,boolean,boolean,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_expansion_preferences(text,text,boolean,boolean,integer) TO dw2_api;
