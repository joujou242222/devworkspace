-- Bounded jitter and content-free operator visibility.
GRANT CREATE ON SCHEMA public TO dw2_dispatch_owner;
SET LOCAL ROLE dw2_dispatch_owner;
CREATE OR REPLACE FUNCTION public.finish_event(l text,e uuid,ls uuid,ok boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE changed integer;
BEGIN
 IF ok AND l='tenant' AND EXISTS(SELECT 1 FROM public.tenant_event WHERE id=e AND schema_version=6) AND NOT EXISTS(SELECT 1 FROM public.consumer_receipt WHERE lane=l AND event_id=e AND handler='notifications-v6') THEN RAISE EXCEPTION 'notification receipt required' USING ERRCODE='23514'; END IF;
 UPDATE public.delivery SET completed_at=CASE WHEN ok THEN now() ELSE NULL END,error_code=CASE WHEN ok THEN NULL ELSE 'DELIVERY_FAILED' END,
 available_at=now()+make_interval(secs=>least(300,power(2,least(attempts,8))::integer+floor(random()*3)::integer)),lease_until=NULL WHERE lane=l AND event_id=e AND lease=ls AND completed_at IS NULL AND lease_until>now();
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed=1 AND ok THEN INSERT INTO public.consumer_receipt(lane,event_id,handler) VALUES(l,e,'phase2') ON CONFLICT DO NOTHING; END IF;
 RETURN changed=1;
END $$;
CREATE FUNCTION public.delivery_details(maximum integer) RETURNS TABLE(lane text,event_id uuid,attempts integer,state text,available_at timestamptz,lease_until timestamptz,error_code text,projection_complete boolean) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT d.lane,d.event_id,d.attempts,CASE WHEN d.completed_at IS NOT NULL THEN 'COMPLETED' WHEN d.attempts>=8 THEN 'EXHAUSTED' WHEN d.lease_until>now() THEN 'LEASED' ELSE 'PENDING' END,d.available_at,d.lease_until,d.error_code,
 EXISTS(SELECT 1 FROM public.consumer_receipt r WHERE r.lane=d.lane AND r.event_id=d.event_id AND r.handler='notifications-v6')
 FROM public.delivery d ORDER BY (d.completed_at IS NULL) DESC,d.available_at,d.event_id LIMIT greatest(1,least(maximum,100))
$$;
REVOKE ALL ON FUNCTION public.delivery_details(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delivery_details(integer) TO dw2_worker;
SET LOCAL ROLE dw2_owner;
REVOKE CREATE ON SCHEMA public FROM dw2_dispatch_owner;