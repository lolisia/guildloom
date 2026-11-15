CREATE TABLE `quest_refs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quest_id` integer NOT NULL,
	`label` text,
	`target` text NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`quest_id`) REFERENCES `quests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `quest_refs_quest_id_id_idx` ON `quest_refs` (`quest_id`,`id`);--> statement-breakpoint
ALTER TABLE `quests` ADD `kind` text DEFAULT 'fix' NOT NULL;--> statement-breakpoint
ALTER TABLE `quests` ADD `clear_round` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE quests SET direction = direction || CASE WHEN direction = '' THEN '' ELSE char(10) END || (SELECT group_concat(line, char(10)) FROM (SELECT CASE WHEN done_at IS NULL THEN '- [ ] ' ELSE '- [x] ' END || title AS line FROM quest_floors f WHERE f.quest_id = quests.id ORDER BY f.order_key)) WHERE EXISTS (SELECT 1 FROM quest_floors f WHERE f.quest_id = quests.id);--> statement-breakpoint
DROP TABLE `quest_floors`;
