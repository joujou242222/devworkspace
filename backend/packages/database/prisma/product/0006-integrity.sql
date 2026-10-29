ALTER TABLE public.identity_email_proof ADD FOREIGN KEY("userId") REFERENCES public.identity_user(id) ON DELETE RESTRICT;
ALTER TABLE public.identity_mail ADD FOREIGN KEY("userId") REFERENCES public.identity_user(id) ON DELETE RESTRICT;
ALTER TABLE public.identity_audit ADD FOREIGN KEY(user_id) REFERENCES public.identity_user(id) ON DELETE RESTRICT;
ALTER TABLE public.identity_event ADD FOREIGN KEY(user_id) REFERENCES public.identity_user(id) ON DELETE RESTRICT;
CREATE FUNCTION public.serialize_membership() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 -- An MVCC write also rejects stale REPEATABLE READ/SERIALIZABLE snapshots;
 -- the public aggregate revision changes only for an actual settings edit.
 UPDATE public.organization SET revision=revision WHERE id=NEW.organization_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'organization unavailable' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER serialize_membership BEFORE INSERT OR UPDATE ON public.membership FOR EACH ROW EXECUTE FUNCTION public.serialize_membership();
REVOKE ALL ON FUNCTION public.serialize_membership() FROM PUBLIC;
CREATE FUNCTION public.invitation_binding() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF ROW(NEW.id,NEW.inviter_id,NEW.email,NEW.role,NEW.digest) IS DISTINCT FROM ROW(OLD.id,OLD.inviter_id,OLD.email,OLD.role,OLD.digest) THEN
 RAISE EXCEPTION 'immutable invitation binding' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER invitation_binding BEFORE UPDATE ON public.invitation FOR EACH ROW EXECUTE FUNCTION public.invitation_binding();
REVOKE ALL ON FUNCTION public.invitation_binding() FROM PUBLIC;
