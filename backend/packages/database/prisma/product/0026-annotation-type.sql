-- SQL NULL cannot turn an unknown/null JSON discriminator into a successful CHECK.
ALTER TABLE public.feedback_thread ADD CONSTRAINT feedback_annotation_type CHECK(
 annotation IS NULL OR ((jsonb_typeof(annotation->'type')='string' AND annotation->>'type' IN ('IMAGE_PIN','PDF_POINT')) IS TRUE)
);
