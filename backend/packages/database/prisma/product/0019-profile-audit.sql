CREATE FUNCTION public.record_profile_change(action text,target text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE uid text:=public.profile_user_id();
BEGIN
 IF uid IS NULL OR action NOT IN ('profile.attached','profile.upload.issued','profile.upload.finalized') OR NOT EXISTS(SELECT 1 FROM public.identity_user WHERE id=uid AND active AND "emailVerified") THEN RAISE EXCEPTION 'profile audit unavailable' USING ERRCODE='42501'; END IF;
 IF target<>uid AND NOT EXISTS(SELECT 1 FROM public.profile_upload WHERE id::text=target AND user_id=uid) THEN RAISE EXCEPTION 'profile target unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO public.identity_audit(user_id,action) VALUES(uid,action);
 INSERT INTO public.identity_event(user_id,kind,target_id) VALUES(uid,'security',target);
END $$;
REVOKE ALL ON FUNCTION public.record_profile_change(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_profile_change(text,text) TO dw2_identity;
