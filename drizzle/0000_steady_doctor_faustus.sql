CREATE TABLE `messages` (
	`event_id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`space_id` text NOT NULL,
	`user_id` text NOT NULL,
	`message` text NOT NULL,
	`reply_id` text,
	`is_mentioned` integer DEFAULT false,
	`mentions` text,
	`is_thread_starter` integer DEFAULT false,
	`is_ask_thread` integer DEFAULT false,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pending_toolcalls` (
	`id` text PRIMARY KEY NOT NULL,
	`draft_event_id` text NOT NULL,
	`original_event_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`tool_args` text NOT NULL,
	`status` text DEFAULT 'pending',
	FOREIGN KEY (`draft_event_id`) REFERENCES `messages`(`event_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`original_event_id`) REFERENCES `messages`(`event_id`) ON UPDATE no action ON DELETE no action
);
