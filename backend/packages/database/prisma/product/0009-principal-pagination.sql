CREATE FUNCTION public.principals_page(uid text,after_id uuid) RETURNS TABLE(id uuid,organization_id uuid,name text,role text) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT m.id,m.organization_id,o.name,m.role FROM public.membership m JOIN public.organization o ON o.id=m.organization_id
 WHERE m.user_id=uid AND m.status='ACTIVE' AND o.status='ACTIVE' AND (after_id IS NULL OR m.id>after_id) ORDER BY m.id LIMIT 51
$$;
GRANT CREATE ON SCHEMA public TO dw2_resolver;
ALTER FUNCTION public.principals_page(text,uuid) OWNER TO dw2_resolver;
REVOKE CREATE ON SCHEMA public FROM dw2_resolver;
REVOKE ALL ON FUNCTION public.principals_page(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.principals_page(text,uuid) TO dw2_api;
