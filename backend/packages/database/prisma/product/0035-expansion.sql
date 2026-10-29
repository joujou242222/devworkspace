-- Additive Phase 7 collaboration. No existing record or migration is rewritten.
CREATE FUNCTION public.document_content_valid(c jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE b jsonb; s jsonb; groups jsonb; spans jsonb;
BEGIN
 IF c IS NULL OR jsonb_typeof(c)<>'object' OR c->'version'<>'1'::jsonb OR c-'version'-'blocks'<>'{}'::jsonb OR jsonb_typeof(c->'blocks')<>'array' OR octet_length(c::text)>150000 OR jsonb_array_length(c->'blocks')>200 THEN RETURN false; END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(c->'blocks') LOOP
  IF jsonb_typeof(b)<>'object' THEN RETURN false; END IF;
  IF b->>'type' IN ('paragraph','heading') THEN
   IF (b->>'type'='heading' AND (b->'level' NOT IN ('1'::jsonb,'2'::jsonb,'3'::jsonb) OR NOT b?'level')) OR b-ARRAY['type','spans','level']<>'{}'::jsonb OR (b->>'type'='paragraph' AND b?'level') THEN RETURN false; END IF;
   groups:=jsonb_build_array(b->'spans');
  ELSIF b->>'type' IN ('bulletList','orderedList') THEN
   IF b-ARRAY['type','items']<>'{}'::jsonb OR jsonb_typeof(b->'items')<>'array' OR jsonb_array_length(b->'items') NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
   groups:=b->'items';
  ELSE RETURN false; END IF;
  FOR spans IN SELECT value FROM jsonb_array_elements(groups) LOOP
   IF jsonb_typeof(spans)<>'array' OR jsonb_array_length(spans)>200 THEN RETURN false; END IF;
   FOR s IN SELECT value FROM jsonb_array_elements(spans) LOOP
    IF jsonb_typeof(s)<>'object' OR jsonb_typeof(s->'text') IS DISTINCT FROM 'string' OR length(s->>'text')>10000 OR s-ARRAY['text','bold','italic','href']<>'{}'::jsonb THEN RETURN false; END IF;
    IF (s?'bold' AND jsonb_typeof(s->'bold')<>'boolean') OR (s?'italic' AND jsonb_typeof(s->'italic')<>'boolean') OR (s?'href' AND (jsonb_typeof(s->'href')<>'string' OR length(s->>'href')>2048 OR s->>'href' !~ '^https?://[^/@[:space:]]+([/:?#][^[:space:]]*)?$' OR s->>'href' ~ '[[:cntrl:]]')) THEN RETURN false; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 RETURN c?'version' AND c?'blocks';
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE TABLE public.discussion (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL,
 author_id text NOT NULL REFERENCES public.identity_user(id), title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200), body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 10000),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')), revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,project_id,id), FOREIGN KEY(organization_id,project_id) REFERENCES public.project(organization_id,id)
);
CREATE TABLE public.discussion_reply (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, discussion_id uuid NOT NULL,
 author_id text NOT NULL REFERENCES public.identity_user(id), body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 10000), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id,discussion_id) REFERENCES public.discussion(organization_id,project_id,id)
);
CREATE TABLE public.document (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, author_id text NOT NULL REFERENCES public.identity_user(id),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200), content jsonb NOT NULL CHECK(public.document_content_valid(content)),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')), revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,project_id,id), FOREIGN KEY(organization_id,project_id) REFERENCES public.project(organization_id,id)
);
CREATE TABLE public.client_update (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL, author_id text NOT NULL REFERENCES public.identity_user(id),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 10000), status text NOT NULL DEFAULT 'PUBLISHED' CHECK(status IN ('PUBLISHED','WITHDRAWN')), revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), withdrawn_at timestamptz,
 CHECK((status='WITHDRAWN')=(withdrawn_at IS NOT NULL)), UNIQUE(organization_id,project_id,id), FOREIGN KEY(organization_id,project_id) REFERENCES public.project(organization_id,id)
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['discussion','discussion_reply','document','client_update'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_scope ON public.%I USING(organization_id=public.tenant_id()) WITH CHECK(organization_id=public.tenant_id())',t);
 EXECUTE format('GRANT SELECT,INSERT ON public.%I TO dw2_api',t);
 EXECUTE format('GRANT SELECT ON public.%I TO dw2_communications',t);
 IF t<>'discussion_reply' THEN EXECUTE format('GRANT UPDATE ON public.%I TO dw2_api',t); END IF;
 EXECUTE format('CREATE INDEX ON public.%I(organization_id,project_id,created_at DESC,id DESC)',t);
END LOOP; END $$;
CREATE INDEX discussion_reply_thread ON public.discussion_reply(organization_id,project_id,discussion_id,created_at,id);
CREATE FUNCTION public.expansion_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p public.project;
BEGIN
 PERFORM 1 FROM public.organization WHERE id=NEW.organization_id FOR UPDATE;
 SELECT * INTO p FROM public.project WHERE organization_id=NEW.organization_id AND id=NEW.project_id FOR UPDATE;
 IF NOT FOUND OR p.status IN ('ARCHIVED','COMPLETED') THEN RAISE EXCEPTION 'project read only' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF TG_TABLE_NAME='discussion_reply' AND NOT EXISTS(SELECT 1 FROM public.discussion WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND id=NEW.discussion_id AND status='ACTIVE' FOR UPDATE) THEN RAISE EXCEPTION 'topic read only' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.organization_id<>OLD.organization_id OR NEW.project_id<>OLD.project_id OR NEW.id<>OLD.id OR NEW.author_id<>OLD.author_id OR NEW.created_at<>OLD.created_at OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'immutable ancestry or invalid revision' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='document' THEN
  IF OLD.status<>'ACTIVE' OR (NEW.status='ARCHIVED' AND (NEW.title<>OLD.title OR NEW.content<>OLD.content)) THEN RAISE EXCEPTION 'document read only' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='discussion' THEN
  IF OLD.status<>'ACTIVE' OR NEW.status<>'ARCHIVED' OR NEW.title<>OLD.title OR NEW.body<>OLD.body THEN RAISE EXCEPTION 'topic history immutable' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='client_update' THEN
  IF OLD.status<>'PUBLISHED' OR NEW.status<>'WITHDRAWN' OR NEW.body<>OLD.body THEN RAISE EXCEPTION 'update history immutable' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.updated_at:=now(); RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['discussion','discussion_reply','document','client_update'] LOOP
 EXECUTE format('CREATE TRIGGER expansion_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.expansion_guard()',t);
END LOOP; END $$;
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON public.discussion_reply FOR EACH ROW EXECUTE FUNCTION public.append_only();
REVOKE ALL ON FUNCTION public.document_content_valid(jsonb),public.expansion_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.document_content_valid(jsonb) TO dw2_api;
