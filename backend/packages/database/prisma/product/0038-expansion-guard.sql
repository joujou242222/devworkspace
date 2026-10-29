-- Forward repair: a shared trigger record does not expose reply-only fields.
CREATE OR REPLACE FUNCTION public.expansion_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p public.project;
BEGIN
 PERFORM 1 FROM public.organization WHERE id=NEW.organization_id FOR UPDATE;
 SELECT * INTO p FROM public.project WHERE organization_id=NEW.organization_id AND id=NEW.project_id FOR UPDATE;
 IF NOT FOUND OR p.status IN ('ARCHIVED','COMPLETED') THEN RAISE EXCEPTION 'project read only' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF TG_TABLE_NAME='discussion_reply' AND NOT EXISTS(SELECT 1 FROM public.discussion WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id AND id=(to_jsonb(NEW)->>'discussion_id')::uuid AND status='ACTIVE' FOR UPDATE) THEN RAISE EXCEPTION 'topic read only' USING ERRCODE='23514'; END IF;
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
