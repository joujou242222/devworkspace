CREATE OR REPLACE FUNCTION public.serialize_membership() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.organization_id IS DISTINCT FROM public.tenant_id() THEN RAISE EXCEPTION 'tenant scope required' USING ERRCODE='42501'; END IF;
 UPDATE public.organization SET revision=revision WHERE id=NEW.organization_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'organization unavailable' USING ERRCODE='23503'; END IF;
 RETURN NEW;
END $$;
