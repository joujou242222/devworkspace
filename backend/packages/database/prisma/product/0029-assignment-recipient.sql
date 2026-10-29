-- Correct project-assignee identity binding; prior migration remains immutable.
GRANT CREATE ON SCHEMA public TO dw2_communications;
SET LOCAL ROLE dw2_communications;
CREATE OR REPLACE FUNCTION public.materialize_notifications(eid uuid,ls uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
    AND (e.resource_kind<>'TASK' OR (EXISTS(SELECT 1 FROM public.project_membership pm WHERE pm.organization_id=m.organization_id AND pm.project_id=e.project_id AND pm.id=e.assignment_id AND pm.membership_id=m.id AND pm.status='ACTIVE') AND EXISTS(SELECT 1 FROM public.task t WHERE t.organization_id=e.organization_id AND t.project_id=e.project_id AND t.id=e.resource_id AND t.assignee_id=e.assignment_id)))
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

SET LOCAL ROLE dw2_owner;
REVOKE CREATE ON SCHEMA public FROM dw2_communications;
