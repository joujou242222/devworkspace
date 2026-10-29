-- Reviewed additive Phase 2 migration. Executed only in the owned product DB.
GRANT CREATE ON SCHEMA public TO dw2_resolver,dw2_dispatch_owner;
ALTER TABLE public.organization ADD CONSTRAINT organization_state CHECK (status IN ('ACTIVE','ARCHIVED'));
ALTER TABLE public.organization ADD CONSTRAINT organization_revision CHECK (revision > 0);
ALTER TABLE public.membership ADD CONSTRAINT membership_role CHECK (role IN ('OWNER','ADMIN','MEMBER'));
ALTER TABLE public.membership ADD CONSTRAINT membership_state CHECK (status IN ('ACTIVE','INACTIVE'));
ALTER TABLE public.membership ADD CONSTRAINT membership_revision CHECK (revision > 0);
ALTER TABLE public.membership ADD FOREIGN KEY (user_id) REFERENCES public.identity_user(id);
CREATE TABLE public.invitation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organization(id),
 inviter_id uuid NOT NULL, email text NOT NULL, role text NOT NULL CHECK(role IN ('ADMIN','MEMBER')),
 digest text UNIQUE NOT NULL, expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
 accepted_at timestamptz, revoked_at timestamptz, revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,inviter_id) REFERENCES public.membership(organization_id,id),
 CHECK(email=lower(email)), CHECK(NOT(accepted_at IS NOT NULL AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX invitation_pending ON public.invitation(organization_id,email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE TABLE public.audit_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organization(id),
 actor_id text NOT NULL REFERENCES public.identity_user(id), action text NOT NULL, target_id text NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}', request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.tenant_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organization(id),
 kind text NOT NULL CHECK(kind IN ('organization.created','organization.updated','membership.changed','invitation.created','invitation.revoked','invitation.accepted','ownership.transferred')),
 target_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id)
);
CREATE TABLE public.tenant_mail (
 id uuid PRIMARY KEY REFERENCES public.tenant_event(id), organization_id uuid NOT NULL, invitation_id uuid NOT NULL,
 envelope text NOT NULL, FOREIGN KEY(organization_id,id) REFERENCES public.tenant_event(organization_id,id),
 FOREIGN KEY(organization_id,invitation_id) REFERENCES public.invitation(organization_id,id)
);
CREATE TABLE public.command_receipt (
 organization_id uuid NOT NULL REFERENCES public.organization(id), actor_id text NOT NULL REFERENCES public.identity_user(id),
 operation text NOT NULL, key text NOT NULL, request_hash text NOT NULL, result jsonb NOT NULL,
 PRIMARY KEY(organization_id,actor_id,operation,key)
);
CREATE TABLE public.onboarding_receipt (
 user_id text NOT NULL REFERENCES public.identity_user(id), key text NOT NULL, request_hash text NOT NULL,
 organization_id uuid NOT NULL REFERENCES public.organization(id), PRIMARY KEY(user_id,key)
);
CREATE TABLE public.identity_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, action text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.identity_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('verify','reset','security')), target_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.delivery (
 event_id uuid NOT NULL, lane text NOT NULL CHECK(lane IN ('identity','tenant')), lease uuid,
 lease_until timestamptz, attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz, error_code text, PRIMARY KEY(lane,event_id)
);
CREATE TABLE public.consumer_receipt (
 lane text NOT NULL, event_id uuid NOT NULL, handler text NOT NULL, completed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(lane,event_id,handler), FOREIGN KEY(lane,event_id) REFERENCES public.delivery(lane,event_id)
);
CREATE TABLE public.abuse_bucket (key text PRIMARY KEY, window_start timestamptz NOT NULL, count integer NOT NULL);

CREATE FUNCTION public.tenant_id() RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN current_setting('app.organization_id',true) ~ '^[0-9a-f-]{36}$'
 THEN nullif(current_setting('app.organization_id',true),'')::uuid ELSE NULL END
$$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['organization','membership','invitation','audit_event','tenant_event','tenant_mail','command_receipt'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON public.%I USING (%I = public.tenant_id()) WITH CHECK (%I = public.tenant_id())',t,
   CASE WHEN t='organization' THEN 'id' ELSE 'organization_id' END, CASE WHEN t='organization' THEN 'id' ELSE 'organization_id' END);
 END LOOP;
END $$;
CREATE FUNCTION public.immutable_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF (to_jsonb(NEW)->>'organization_id') IS DISTINCT FROM (to_jsonb(OLD)->>'organization_id') THEN RAISE EXCEPTION 'immutable scope' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['membership','invitation','audit_event','tenant_event','tenant_mail','command_receipt'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_scope BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.immutable_scope()',t);
 END LOOP;
END $$;
CREATE FUNCTION public.append_only() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'append only' USING ERRCODE='42501'; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['audit_event','identity_audit','tenant_event','identity_event','identity_mail','tenant_mail','consumer_receipt'] LOOP
  EXECUTE format('CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.append_only()',t);
 END LOOP;
END $$;
CREATE FUNCTION public.require_owner() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE oid uuid;
BEGIN
 oid := CASE WHEN TG_TABLE_NAME='organization' THEN NEW.id ELSE NEW.organization_id END;
 PERFORM 1 FROM public.organization WHERE id=oid FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.membership WHERE organization_id=oid AND role='OWNER' AND status='ACTIVE') THEN
  RAISE EXCEPTION 'last active owner required' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER organization_owner AFTER INSERT ON public.organization DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_owner();
CREATE CONSTRAINT TRIGGER membership_owner AFTER INSERT OR UPDATE ON public.membership DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_owner();
CREATE FUNCTION public.record_identity_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid text; action text;
BEGIN
 uid := CASE WHEN TG_TABLE_NAME='identity_user' THEN COALESCE(NEW.id,OLD.id) ELSE COALESCE(NEW."userId",OLD."userId") END;
 action := TG_TABLE_NAME||'.'||lower(TG_OP);
 IF TG_TABLE_NAME='identity_session' AND TG_OP='UPDATE' THEN RETURN NEW; END IF;
 INSERT INTO public.identity_audit(user_id,action) VALUES(uid,action);
 INSERT INTO public.identity_event(user_id,kind,target_id) VALUES(uid,'security',uid);
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER user_audit AFTER INSERT OR UPDATE ON public.identity_user FOR EACH ROW EXECUTE FUNCTION public.record_identity_change();
CREATE TRIGGER account_audit AFTER INSERT OR UPDATE ON public.identity_account FOR EACH ROW EXECUTE FUNCTION public.record_identity_change();
CREATE TRIGGER session_audit AFTER INSERT OR DELETE ON public.identity_session FOR EACH ROW EXECUTE FUNCTION public.record_identity_change();
CREATE FUNCTION public.mail_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 INSERT INTO public.identity_event(id,user_id,kind,target_id) VALUES(NEW.id::uuid,NEW."userId",NEW.kind,NEW.id); RETURN NEW;
END $$;
CREATE TRIGGER mail_event AFTER INSERT ON public.identity_mail FOR EACH ROW EXECUTE FUNCTION public.mail_event();
CREATE FUNCTION public.delivery_intent() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 INSERT INTO public.delivery(event_id,lane) VALUES(NEW.id,CASE WHEN TG_TABLE_NAME='tenant_event' THEN 'tenant' ELSE 'identity' END); RETURN NEW;
END $$;
CREATE TRIGGER delivery_intent AFTER INSERT ON public.identity_event FOR EACH ROW EXECUTE FUNCTION public.delivery_intent();
CREATE TRIGGER delivery_intent AFTER INSERT ON public.tenant_event FOR EACH ROW EXECUTE FUNCTION public.delivery_intent();

-- Resolver is deliberately limited to the authenticated user's context lookup.
CREATE POLICY resolver_membership ON public.membership TO dw2_resolver USING(true);
CREATE POLICY resolver_organization ON public.organization TO dw2_resolver USING(true);
GRANT SELECT ON public.membership,public.organization TO dw2_resolver;
CREATE FUNCTION public.principals(uid text) RETURNS TABLE(id uuid,organization_id uuid,name text,role text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT m.id,m.organization_id,o.name,m.role FROM public.membership m JOIN public.organization o ON o.id=m.organization_id
 WHERE m.user_id=uid AND m.status='ACTIVE' AND o.status='ACTIVE' ORDER BY o."createdAt",m.id LIMIT 100
$$;
ALTER FUNCTION public.principals(text) OWNER TO dw2_resolver;
GRANT SELECT ON public.invitation TO dw2_resolver;
CREATE POLICY resolver_invitation ON public.invitation TO dw2_resolver USING(true);
CREATE FUNCTION public.invitation_scope(proof text) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT organization_id FROM public.invitation WHERE digest=proof $$;
ALTER FUNCTION public.invitation_scope(text) OWNER TO dw2_resolver;
CREATE FUNCTION public.team_identity(uid text) RETURNS TABLE(name text,email text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT u.name,u.email FROM public.identity_user u WHERE u.id=uid AND EXISTS(
 SELECT 1 FROM public.membership m WHERE m.organization_id=public.tenant_id() AND m.user_id=uid)
$$;
CREATE FUNCTION public.assert_session(sid text,uid text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM 1 FROM public.identity_session s JOIN public.identity_user u ON u.id=s."userId" WHERE s.id=sid AND u.id=uid AND u.active AND u."emailVerified"
 AND s."expiresAt">now() AND s."createdAt">now()-interval '8 hours' AND s."lastActivityAt">now()-interval '30 minutes' FOR SHARE OF s,u;
 IF NOT FOUND THEN RAISE EXCEPTION 'session unavailable' USING ERRCODE='28000'; END IF;
END $$;
CREATE FUNCTION public.revoke_member_sessions(uid text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.membership WHERE organization_id=public.tenant_id() AND user_id=uid) THEN RAISE EXCEPTION 'member unavailable' USING ERRCODE='42501'; END IF;
 DELETE FROM public.identity_session WHERE "userId"=uid;
END $$;
CREATE FUNCTION public.bootstrap(uid text,sid text,n text,d text,tz text,k text,h text,rid uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE oid uuid; receipt public.onboarding_receipt;
BEGIN
 -- Identity row serializes this user's retry keys without global locks.
 PERFORM 1 FROM public.identity_user WHERE id=uid AND active AND "emailVerified" FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'identity unavailable' USING ERRCODE='28000'; END IF;
 PERFORM public.assert_session(sid,uid);
 SELECT * INTO receipt FROM public.onboarding_receipt WHERE user_id=uid AND key=k;
 IF FOUND THEN
  IF receipt.request_hash<>h THEN RAISE EXCEPTION 'idempotency conflict' USING ERRCODE='23505'; END IF;
  PERFORM set_config('app.organization_id',receipt.organization_id::text,true);
  IF NOT EXISTS(SELECT 1 FROM public.membership WHERE organization_id=receipt.organization_id AND user_id=uid AND status='ACTIVE') THEN RAISE EXCEPTION 'access unavailable' USING ERRCODE='42501'; END IF;
  RETURN receipt.organization_id;
 END IF;
 oid:=gen_random_uuid(); PERFORM set_config('app.organization_id',oid::text,true);
 INSERT INTO public.organization(id,name,description,timezone) VALUES(oid,n,d,tz);
 INSERT INTO public.membership(id,organization_id,user_id,role) VALUES(gen_random_uuid(),oid,uid,'OWNER');
 INSERT INTO public.audit_event(organization_id,actor_id,action,target_id,request_id) VALUES(oid,uid,'organization.created',oid::text,rid);
 INSERT INTO public.tenant_event(organization_id,kind,target_id) VALUES(oid,'organization.created',oid::text);
 INSERT INTO public.onboarding_receipt VALUES(uid,k,h,oid);
 RETURN oid;
END $$;
CREATE FUNCTION public.abuse(k text,lim integer) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE hits integer;
BEGIN
 INSERT INTO public.abuse_bucket VALUES(k,date_trunc('minute',now()),1) ON CONFLICT(key) DO UPDATE
 SET window_start=date_trunc('minute',now()),count=CASE WHEN abuse_bucket.window_start=date_trunc('minute',now()) THEN abuse_bucket.count+1 ELSE 1 END RETURNING count INTO hits;
 RETURN hits<=lim;
END $$;

-- Dispatch owner has event access only. It cannot read tenant domain tables.
GRANT SELECT ON public.tenant_event,public.tenant_mail,public.identity_event,public.identity_mail TO dw2_dispatch_owner;
GRANT SELECT,UPDATE ON public.delivery TO dw2_dispatch_owner;
GRANT SELECT,INSERT ON public.consumer_receipt TO dw2_dispatch_owner;
CREATE POLICY dispatch_events ON public.tenant_event TO dw2_dispatch_owner USING(true);
CREATE POLICY dispatch_mail ON public.tenant_mail TO dw2_dispatch_owner USING(true);
CREATE FUNCTION public.claim_events() RETURNS TABLE(lane text,event_id uuid,lease uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH candidates AS (SELECT d.lane,d.event_id FROM public.delivery d WHERE d.completed_at IS NULL AND d.attempts<8
 AND d.available_at<=now() AND (d.lease_until IS NULL OR d.lease_until<now()) ORDER BY d.available_at LIMIT 20 FOR UPDATE SKIP LOCKED)
 UPDATE public.delivery d SET lease=gen_random_uuid(),lease_until=now()+interval '30 seconds',attempts=attempts+1
 FROM candidates c WHERE d.lane=c.lane AND d.event_id=c.event_id RETURNING d.lane,d.event_id,d.lease
$$;
CREATE FUNCTION public.load_mail(l text,e uuid,ls uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.delivery WHERE lane=l AND event_id=e AND lease=ls AND completed_at IS NULL AND lease_until>now()) THEN RAISE EXCEPTION 'lease unavailable' USING ERRCODE='42501'; END IF;
 IF l='identity' THEN SELECT m.envelope INTO result FROM public.identity_mail m JOIN public.identity_event v ON v.id=m.id::uuid AND v.kind=m.kind AND v.user_id=m."userId" WHERE v.id=e;
 ELSIF l='tenant' THEN SELECT m.envelope INTO result FROM public.tenant_mail m JOIN public.tenant_event v ON v.id=m.id AND v.organization_id=m.organization_id AND v.kind='invitation.created' WHERE v.id=e;
 ELSE RAISE EXCEPTION 'invalid lane'; END IF;
 RETURN result;
END $$;
CREATE FUNCTION public.finish_event(l text,e uuid,ls uuid,ok boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE changed integer;
BEGIN
 UPDATE public.delivery SET completed_at=CASE WHEN ok THEN now() ELSE NULL END,
 error_code=CASE WHEN ok THEN NULL ELSE 'DELIVERY_FAILED' END,
 available_at=now()+make_interval(secs=>least(300,power(2,attempts)::integer)),lease_until=NULL
 WHERE lane=l AND event_id=e AND lease=ls AND completed_at IS NULL;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed=1 AND ok THEN INSERT INTO public.consumer_receipt(lane,event_id,handler) VALUES(l,e,'phase2') ON CONFLICT DO NOTHING; END IF;
 RETURN changed=1;
END $$;
ALTER FUNCTION public.claim_events() OWNER TO dw2_dispatch_owner;
ALTER FUNCTION public.load_mail(text,uuid,uuid) OWNER TO dw2_dispatch_owner;
ALTER FUNCTION public.finish_event(text,uuid,uuid,boolean) OWNER TO dw2_dispatch_owner;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO dw2_api,dw2_identity,dw2_dispatch,dw2_worker,dw2_dispatch_owner,dw2_resolver;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.identity_user,public.identity_session,public.identity_account,public.identity_verification,public.identity_email_proof TO dw2_identity;
GRANT SELECT,INSERT ON public.identity_mail TO dw2_identity;
GRANT SELECT,INSERT,UPDATE ON public.organization,public.membership,public.invitation TO dw2_api;
GRANT SELECT,INSERT ON public.audit_event,public.tenant_event,public.tenant_mail,public.command_receipt TO dw2_api;
GRANT EXECUTE ON FUNCTION public.tenant_id() TO dw2_api,dw2_resolver;
GRANT EXECUTE ON FUNCTION public.principals(text),public.invitation_scope(text),public.team_identity(text),public.assert_session(text,text),public.revoke_member_sessions(text),public.bootstrap(text,text,text,text,text,text,text,uuid),public.abuse(text,integer) TO dw2_api;
GRANT EXECUTE ON FUNCTION public.claim_events() TO dw2_dispatch;
GRANT EXECUTE ON FUNCTION public.load_mail(text,uuid,uuid),public.finish_event(text,uuid,uuid,boolean) TO dw2_worker;
REVOKE CREATE ON SCHEMA public FROM dw2_resolver,dw2_dispatch_owner;
