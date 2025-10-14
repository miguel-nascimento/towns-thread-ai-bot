CREATE TABLE `messages` (
	`event_id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`user_id` text NOT NULL,
	`message` text NOT NULL,
	`is_thread_starter` integer DEFAULT false,
	`created_at` integer NOT NULL
);
