-- Add attachments column to messages for image/file attachments references.
-- The bytes live in the per-session VFS; this column stores ChatAttachment[]
-- ({ path, mimeType }) as JSON. Nullable; existing rows keep NULL.
ALTER TABLE messages ADD COLUMN attachments TEXT;
