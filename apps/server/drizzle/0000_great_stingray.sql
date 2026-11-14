CREATE TABLE `invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`code` text NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_code_idx` ON `invites` (`code`);--> statement-breakpoint
CREATE INDEX `invites_project_id_idx` ON `invites` (`project_id`);--> statement-breakpoint
CREATE TABLE `project_members` (
	`project_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_members_user_id_idx` ON `project_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`next_quest_number` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quest_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quest_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`actor_user_id` integer,
	`familiar_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`quest_id`) REFERENCES `quests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `quest_events_quest_id_idx` ON `quest_events` (`quest_id`);--> statement-breakpoint
CREATE TABLE `quest_tags` (
	`quest_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`quest_id`, `tag_id`),
	FOREIGN KEY (`quest_id`) REFERENCES `quests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quest_tags_tag_id_idx` ON `quest_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `quests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`situation` text DEFAULT '' NOT NULL,
	`direction` text DEFAULT '' NOT NULL,
	`stage` text DEFAULT 'board' NOT NULL,
	`rank` text,
	`order_key` text NOT NULL,
	`archive_reason` text,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `quests_project_stage_order_idx` ON `quests` (`project_id`,`stage`,`order_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `quests_project_id_number_unique` ON `quests` (`project_id`,`number`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_project_id_name_unique` ON `tags` (`project_id`,`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`login_id` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_login_id_unique` ON `users` (`login_id`);