ALTER TABLE public.review_cycle ADD COLUMN roster_transaction xid8 NOT NULL DEFAULT pg_current_xact_id();
CREATE FUNCTION public.review_roster_insert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.review_cycle WHERE organization_id=NEW.organization_id AND id=NEW.cycle_id AND roster_transaction=pg_current_xact_id()) THEN RAISE EXCEPTION 'frozen review roster' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_roster_insert_guard BEFORE INSERT ON public.review_participant FOR EACH ROW EXECUTE FUNCTION public.review_roster_insert_guard();
CREATE FUNCTION public.review_share_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 PERFORM 1 FROM public.organization WHERE id=NEW.organization_id FOR UPDATE;
 IF NEW.organization_id<>OLD.organization_id OR NEW.project_id<>OLD.project_id OR NEW.version_id<>OLD.version_id OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'immutable share identity' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_share_guard BEFORE UPDATE ON public.version_share FOR EACH ROW EXECUTE FUNCTION public.review_share_guard();
CREATE FUNCTION public.review_reply_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.feedback_thread f JOIN public.review_cycle c ON c.organization_id=f.organization_id AND c.project_id=f.project_id AND c.id=f.cycle_id WHERE f.organization_id=NEW.organization_id AND f.project_id=NEW.project_id AND f.id=NEW.thread_id AND c.status='OPEN' AND (NEW.capacity='INTERNAL' OR f.visibility='CLIENT')) THEN RAISE EXCEPTION 'feedback is closed or private' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER review_reply_guard BEFORE INSERT ON public.feedback_reply FOR EACH ROW EXECUTE FUNCTION public.review_reply_guard();
REVOKE ALL ON FUNCTION public.review_roster_insert_guard(),public.review_share_guard(),public.review_reply_guard() FROM PUBLIC;
