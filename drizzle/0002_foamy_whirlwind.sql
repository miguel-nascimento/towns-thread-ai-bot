ALTER TABLE `messages` ADD `space_id` text NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `reply_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `is_mentioned` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `messages` ADD `mentions` text;