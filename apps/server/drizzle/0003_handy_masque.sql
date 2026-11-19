CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`quest_id` integer,
	`kind` text NOT NULL,
	`author_user_id` integer,
	`familiar_id` integer,
	`body` text NOT NULL,
	`payload` text,
	`promoted_quest_id` integer,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`quest_id`) REFERENCES `quests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`promoted_quest_id`) REFERENCES `quests`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `messages_project_quest_id_idx` ON `messages` (`project_id`,`quest_id`,`id`);--> statement-breakpoint
CREATE TABLE `read_cursors` (
	`user_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`thread_quest_id` integer DEFAULT 0 NOT NULL,
	`last_read_message_id` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `project_id`, `thread_quest_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
