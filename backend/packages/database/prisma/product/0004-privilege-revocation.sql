-- Fail closed on every membership privilege transition, including acceptance and
-- first-owner bootstrap. Reauthentication issues a fresh library session.
CREATE FUNCTION public.membership_session_revision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF TG_OP='INSERT' OR NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status THEN
  DELETE FROM public.identity_session WHERE "userId"=NEW.user_id;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER membership_session_revision AFTER INSERT OR UPDATE ON public.membership FOR EACH ROW EXECUTE FUNCTION public.membership_session_revision();
REVOKE ALL ON FUNCTION public.membership_session_revision() FROM PUBLIC;
