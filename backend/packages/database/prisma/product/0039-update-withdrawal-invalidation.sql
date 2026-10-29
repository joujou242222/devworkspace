-- A withdrawn update permits only a content-free authorized invalidation; notices remain publication-only.
GRANT CREATE ON SCHEMA public TO dw2_communications;
SET LOCAL ROLE dw2_communications;
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
   WHEN 'UPDATE' THEN EXISTS(SELECT 1 FROM public.client_update WHERE organization_id=oid AND project_id=notification_access.project AND id=target)
   WHEN 'PROJECT' THEN target=notification_access.project ELSE false END;
 END IF;
 IF cap<>'CLIENT' OR kind NOT IN ('REVIEW','VERSION','UPDATE') OR action NOT IN ('review.opened','review.replaced','review.decided','review.cancelled','review.changed','version.shared','feedback.created','feedback.replied','update.published','update.withdrawn') THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.client_contact c JOIN public.client_project_access g ON g.organization_id=c.organization_id AND g.contact_id=c.id JOIN public.project p ON p.organization_id=g.organization_id AND p.id=g.project_id AND p.client_id=c.client_id JOIN public.client x ON x.organization_id=p.organization_id AND x.id=p.client_id
  WHERE c.organization_id=oid AND c.id=pid AND c.user_id=uid AND c.status='ACTIVE' AND g.status='ACTIVE' AND p.id=notification_access.project AND p.portal_enabled AND p.status<>'ARCHIVED' AND x.status='ACTIVE') THEN RETURN false; END IF;
 IF kind='UPDATE' THEN RETURN action IN ('update.published','update.withdrawn') AND EXISTS(SELECT 1 FROM public.client_update WHERE organization_id=oid AND project_id=notification_access.project AND id=target AND (action='update.withdrawn' OR status='PUBLISHED')); END IF;
 RETURN EXISTS(SELECT 1 FROM public.deliverable_version v JOIN public.version_share s ON s.organization_id=v.organization_id AND s.project_id=v.project_id AND s.version_id=v.id AND s.status='ACTIVE'
  JOIN public.deliverable d ON d.organization_id=v.organization_id AND d.project_id=v.project_id AND d.id=v.deliverable_id AND d.status='ACTIVE'
  JOIN public.file_access a ON a.organization_id=v.organization_id AND a.project_id=v.project_id AND a.asset_id=v.asset_id AND a.status='AVAILABLE'
  WHERE v.organization_id=oid AND v.project_id=notification_access.project AND ((kind='VERSION' AND v.id=target) OR (kind='REVIEW' AND EXISTS(SELECT 1 FROM public.review_cycle c WHERE c.organization_id=oid AND c.project_id=notification_access.project AND c.id=target AND c.version_id=v.id))));
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
 IF e.schema_version=6 AND e.resource_kind IN ('TASK','REVIEW','VERSION','DISCUSSION','DOCUMENT','UPDATE') AND (e.resource_kind<>'UPDATE' OR e.action='update.published') THEN
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



SET LOCAL ROLE dw2_owner;
REVOKE CREATE ON SCHEMA public FROM dw2_communications;
