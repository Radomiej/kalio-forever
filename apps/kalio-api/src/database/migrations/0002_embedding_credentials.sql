-- Migration 0002: embedding_credentials table
-- Creates independent credential store for embedding providers.
-- Also clears stale single-config app_settings keys from the old embedding system.

CREATE TABLE `embedding_credentials` (
  `id`          text     PRIMARY KEY NOT NULL,
  `name`        text     NOT NULL,
  `provider`    text     NOT NULL,
  `api_key`     text     NOT NULL,
  `base_url`    text     NOT NULL,
  `model`       text     NOT NULL,
  `dimensions`  integer  NOT NULL DEFAULT 1536,
  `created_at`  integer  NOT NULL
);
--> statement-breakpoint
-- Clear stale single-config embedding keys so the new system starts clean
DELETE FROM `app_settings` WHERE `key` LIKE 'embedding.%';
-- active_embedding_credential uses a fresh key in the new system, no conflict
