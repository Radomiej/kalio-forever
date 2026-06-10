ALTER TABLE `personas` ADD COLUMN `avatar_seed` text;--> statement-breakpoint
ALTER TABLE `personas` ADD COLUMN `avatar_variant` text;--> statement-breakpoint
ALTER TABLE `personas` ADD COLUMN `avatar_palette_key` text;--> statement-breakpoint
ALTER TABLE `personas` ADD COLUMN `avatar_index` integer DEFAULT 0;
