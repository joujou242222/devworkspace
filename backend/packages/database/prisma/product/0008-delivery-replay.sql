CREATE TABLE public.dispatch_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lane text NOT NULL,event_id uuid NOT NULL,
 action text NOT NULL CHECK(action='retry_exhausted'),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(lane,event_id) REFERENCES public.delivery(lane,event_id)
);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON public.dispatch_audit FOR EACH ROW EXECUTE FUNCTION public.append_only();
GRANT INSERT ON public.dispatch_audit TO dw2_dispatch_owner;
CREATE FUNCTION public.retry_failed(l text,e uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE changed integer;
BEGIN
 UPDATE public.delivery SET attempts=0,available_at=now(),lease=NULL,lease_until=NULL,error_code=NULL
 WHERE lane=l AND event_id=e AND completed_at IS NULL AND attempts>=8 AND (lease_until IS NULL OR lease_until<now());
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed=1 THEN INSERT INTO public.dispatch_audit(lane,event_id,action) VALUES(l,e,'retry_exhausted'); END IF;
 RETURN changed=1;
END $$;
GRANT CREATE ON SCHEMA public TO dw2_dispatch_owner;
ALTER FUNCTION public.retry_failed(text,uuid) OWNER TO dw2_dispatch_owner;
REVOKE CREATE ON SCHEMA public FROM dw2_dispatch_owner;
REVOKE ALL ON FUNCTION public.retry_failed(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_failed(text,uuid) TO dw2_dispatch;
