-- Disambiguate the explicit project parameter from the project relation row.
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
   WHEN 'PROJECT' THEN target=notification_access.project ELSE false END;
 END IF;
 IF cap<>'CLIENT' OR kind NOT IN ('REVIEW','VERSION') OR action NOT IN ('review.opened','review.replaced','review.decided','review.cancelled','review.changed','version.shared','feedback.created','feedback.replied') THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.client_contact c JOIN public.client_project_access g ON g.organization_id=c.organization_id AND g.contact_id=c.id JOIN public.project p ON p.organization_id=g.organization_id AND p.id=g.project_id AND p.client_id=c.client_id JOIN public.client x ON x.organization_id=p.organization_id AND x.id=p.client_id
  WHERE c.organization_id=oid AND c.id=pid AND c.user_id=uid AND c.status='ACTIVE' AND g.status='ACTIVE' AND p.id=notification_access.project AND p.portal_enabled AND p.status<>'ARCHIVED' AND x.status='ACTIVE') THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM public.deliverable_version v JOIN public.version_share s ON s.organization_id=v.organization_id AND s.project_id=v.project_id AND s.version_id=v.id AND s.status='ACTIVE'
  JOIN public.deliverable d ON d.organization_id=v.organization_id AND d.project_id=v.project_id AND d.id=v.deliverable_id AND d.status='ACTIVE'
  JOIN public.file_access a ON a.organization_id=v.organization_id AND a.project_id=v.project_id AND a.asset_id=v.asset_id AND a.status='AVAILABLE'
  WHERE v.organization_id=oid AND v.project_id=notification_access.project AND ((kind='VERSION' AND v.id=target) OR (kind='REVIEW' AND EXISTS(SELECT 1 FROM public.review_cycle c WHERE c.organization_id=oid AND c.project_id=notification_access.project AND c.id=target AND c.version_id=v.id))));
END $$;

SET LOCAL ROLE dw2_owner;
REVOKE CREATE ON SCHEMA public FROM dw2_communications;
