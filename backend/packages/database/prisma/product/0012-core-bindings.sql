-- Preserve immutable invitation targets introduced by Phase 3.
CREATE FUNCTION public.core_invitation_binding() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF ROW(NEW.purpose,NEW.contact_id,NEW.project_id,NEW.project_role) IS DISTINCT FROM ROW(OLD.purpose,OLD.contact_id,OLD.project_id,OLD.project_role) THEN RAISE EXCEPTION 'immutable invitation target' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER core_invitation_binding BEFORE UPDATE ON public.invitation FOR EACH ROW EXECUTE FUNCTION public.core_invitation_binding();
CREATE FUNCTION public.core_contact_revocation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.user_id IS NOT NULL AND NEW.email<>OLD.email THEN RAISE EXCEPTION 'linked contact identity immutable' USING ERRCODE='23514'; END IF;
 IF NEW.status='INACTIVE' THEN
 UPDATE public.client_project_access SET status='REVOKED',revision=revision+1 WHERE organization_id=NEW.organization_id AND contact_id=NEW.id AND status='ACTIVE';
 UPDATE public.invitation SET revoked_at=now(),revision=revision+1 WHERE organization_id=NEW.organization_id AND contact_id=NEW.id AND accepted_at IS NULL AND revoked_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER core_contact_revocation BEFORE UPDATE ON public.client_contact FOR EACH ROW EXECUTE FUNCTION public.core_contact_revocation();
REVOKE ALL ON FUNCTION public.core_invitation_binding(),public.core_contact_revocation() FROM PUBLIC;
