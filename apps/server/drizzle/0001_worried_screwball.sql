CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`quest_id` integer,
	`type` text NOT NULL,
	`actor_user_id` integer,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `notifications_user_read_idx` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `party_members` (
	`quest_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`retreat_reason` text,
	`joined_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`quest_id`, `user_id`),
	FOREIGN KEY (`quest_id`) REFERENCES `quests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `party_members_user_id_idx` ON `party_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `quest_floors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quest_id` integer NOT NULL,
	`title` text NOT NULL,
	`order_key` text NOT NULL,
	`done_at` integer,
	`done_by` integer,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`quest_id`) REFERENCES `quests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`done_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `quest_floors_quest_order_idx` ON `quest_floors` (`quest_id`,`order_key`);--> statement-breakpoint
CREATE TABLE `quest_nominations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quest_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`nominee_id` integer NOT NULL,
	`nominated_by` integer NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`pass_reason` text,
	`relay_from_nomination_id` integer,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`quest_id`) REFERENCES `quests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`nominee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`nominated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `quest_nominations_nominee_state_idx` ON `quest_nominations` (`nominee_id`,`state`);--> statement-breakpoint
CREATE INDEX `quest_nominations_quest_state_idx` ON `quest_nominations` (`quest_id`,`state`);--> statement-breakpoint
CREATE TABLE `xp_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`quest_id` integer,
	`reason` text NOT NULL,
	`amount` integer NOT NULL,
	`idem_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `xp_ledger_idem_key_unique` ON `xp_ledger` (`idem_key`);--> statement-breakpoint
ALTER TABLE `quests` ADD `first_claimed_at` integer;