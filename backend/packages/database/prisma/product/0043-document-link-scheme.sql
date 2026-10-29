-- HTTP(S) schemes are case-insensitive; preserve the API/SQL safe-link agreement.
CREATE OR REPLACE FUNCTION public.document_content_valid(c jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
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
    IF (s?'bold' AND jsonb_typeof(s->'bold')<>'boolean') OR (s?'italic' AND jsonb_typeof(s->'italic')<>'boolean') OR (s?'href' AND (jsonb_typeof(s->'href')<>'string' OR length(s->>'href')>2048 OR s->>'href' !~* '^https?://[^/@[:space:]]+([/:?#][^[:space:]]*)?$' OR s->>'href' ~ '[[:cntrl:]]')) THEN RETURN false; END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 RETURN c?'version' AND c?'blocks';
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
