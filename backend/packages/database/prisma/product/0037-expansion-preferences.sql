GRANT CREATE ON SCHEMA public TO dw2_communications;
SET LOCAL ROLE dw2_communications;
CREATE FUNCTION public.save_all_notification_preferences(uid text,sid text,a boolean,r boolean,d boolean,c boolean,rev integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.save_notification_preferences(uid,sid,a,r,rev);
 UPDATE public.notification_preference SET discussions_documents=coalesce(d,discussions_documents),client_updates=coalesce(c,client_updates) WHERE user_id=uid;
 RETURN public.read_notification_preferences(uid,sid);
END $$;
SET LOCAL ROLE dw2_owner;
REVOKE CREATE ON SCHEMA public FROM dw2_communications;
REVOKE ALL ON FUNCTION public.save_all_notification_preferences(text,text,boolean,boolean,boolean,boolean,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_all_notification_preferences(text,text,boolean,boolean,boolean,boolean,integer) TO dw2_api;
