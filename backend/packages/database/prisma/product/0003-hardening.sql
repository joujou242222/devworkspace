-- Polymorphic trigger records must be accessed via JSON, not nonexistent fields.
CREATE OR REPLACE FUNCTION public.record_identity_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid text; action text;
BEGIN
 uid:=CASE WHEN TG_TABLE_NAME='identity_user' THEN COALESCE(to_jsonb(NEW)->>'id',to_jsonb(OLD)->>'id') ELSE COALESCE(to_jsonb(NEW)->>'userId',to_jsonb(OLD)->>'userId') END;
 action:=TG_TABLE_NAME||'.'||lower(TG_OP);
 IF TG_TABLE_NAME='identity_session' AND TG_OP='UPDATE' THEN RETURN NEW; END IF;
 INSERT INTO public.identity_audit(user_id,action) VALUES(uid,action);
 INSERT INTO public.identity_event(user_id,kind,target_id) VALUES(uid,'security',uid);
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE OR REPLACE FUNCTION public.require_owner() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE oid uuid;
BEGIN
 oid:=(CASE WHEN TG_TABLE_NAME='organization' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'organization_id' END)::uuid;
 PERFORM 1 FROM public.organization WHERE id=oid FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.membership WHERE organization_id=oid AND role='OWNER' AND status='ACTIVE') THEN RAISE EXCEPTION 'last active owner required' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION public.delivery_status() RETURNS TABLE(lane text,pending bigint,completed bigint,failed bigint) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT d.lane,count(*) FILTER(WHERE completed_at IS NULL AND attempts<8),count(*) FILTER(WHERE completed_at IS NOT NULL),count(*) FILTER(WHERE completed_at IS NULL AND attempts>=8) FROM public.delivery d GROUP BY d.lane
$$;
GRANT CREATE ON SCHEMA public TO dw2_dispatch_owner;
ALTER FUNCTION public.delivery_status() OWNER TO dw2_dispatch_owner;
REVOKE CREATE ON SCHEMA public FROM dw2_dispatch_owner;
REVOKE ALL ON FUNCTION public.delivery_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delivery_status() TO dw2_worker;
