CREATE UNIQUE INDEX `messages_session_tool_result_unique`
ON `messages` (`session_id`, `tool_call_id`)
WHERE `role` = 'tool_result' AND `tool_call_id` IS NOT NULL;
