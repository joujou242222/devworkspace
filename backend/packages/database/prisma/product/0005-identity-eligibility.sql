CREATE FUNCTION public.eligible_member(uid text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM public.identity_user u JOIN public.membership m ON m.user_id=u.id
 WHERE m.organization_id=public.tenant_id() AND u.id=uid AND u.active AND u."emailVerified" AND m.status='ACTIVE')
$$;
REVOKE ALL ON FUNCTION public.eligible_member(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eligible_member(text) TO dw2_api;
