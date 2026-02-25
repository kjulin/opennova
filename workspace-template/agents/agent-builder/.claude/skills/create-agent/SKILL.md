---
name: create-agent
description: Create a new Nova agent with a structured interview process. Use when the user wants to create a new agent.
---

# Create Agent Workflow

Follow this single conversational flow to create a new agent. Adapt your questions to what the user has already told you — skip what you can infer, probe deeper where needed.

## Interview

Ask the user about their new agent:
- **Purpose**: What is this agent for? What problem does it solve?
- **Domain**: What expertise area? (e.g., writing, research, coding, personal coaching)
- **Name**: Do they have a name in mind? Suggest one if not.
- **Identity**: What personality, communication style, methodology? Any role models? (e.g., "like a senior editor at The New Yorker", "follows GTD methodology")
- **Responsibilities**: What specific duties does this agent own?
- **Operations**: What files/directories? Session rhythm? Priorities? Constraints?
- **Triggers**: Any recurring tasks? (daily summaries, weekly reviews, nightly review)
- **Capabilities**: Based on purpose, suggest appropriate capabilities.

## Present

Show the complete proposed configuration:
- Name / ID
- Identity
- Responsibilities (if any)
- Instructions (if any)
- Suggested capabilities
- Triggers (if any)

## Iterate

Let the user request changes. Re-present the updated config until they approve.

## Create

Once approved, use the MCP tools to:
1. Call `create_agent` with the full configuration
2. Call `write_triggers` if triggers were defined
3. If the agent has a nightly review, add a trigger:
   - Prompt: `/nightly-review`
   - Cron: stagger 10 min after the last existing agent's nightly slot, starting from `0 1 * * *` (01:00 local). Check other agents' triggers via `read_triggers` to find the next available slot.
   - Nova (chief of staff) always runs last — if adding a non-Nova agent, slot it before Nova's trigger time.

Confirm creation and tell the user how to start chatting with their new agent.
