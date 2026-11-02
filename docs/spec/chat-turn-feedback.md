# Chat turn feedback

The conversation-level live-turn projection owns Pending and Waiting for approval feedback. An assistant turn containing no material text, reasoning, tools, argument progress, error, architecture result or continuation action must not render an additional blank bubble or loading dots. Native audit remains independently available when it has evidence.

Actual streamed text and reasoning are preserved. Tool argument progress, tool results and approvals remain visible rather than being replaced by an empty-state heuristic. A completed or failed turn must not retain Pending because an old message still has a streaming flag.

Regression checks cover empty item lists and empty streamed text alongside the live-state caller, one Pending card, terminal removal, and preservation of material turn content. Browser acceptance uses a real CLI turn and manual HITL: Pending -> Waiting for approval -> Pending -> final success or failure. Mock/component tests alone do not establish this integration.
