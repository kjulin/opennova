---
name: create-agent
description: Create a new Nova agent with a structured interview process. Use when the user wants to create a new agent.
---

# Create Agent Workflow

Follow this structured process to create a new agent. Do NOT rush through steps — gather thorough requirements before building.

## Phase 1: Understand the Agent Type

Ask the user what kind of agent they want to create:
- What is the agent's primary purpose?
- Does the user already have a name in mind?

## Phase 2: Interview for Identity

Dig deeper into WHO this agent should be:
- What domain or expertise area? (e.g., writing, research, coding, personal coaching)
- Is there a specific methodology, framework, or approach they should follow? (e.g., GTD, Aki Hintsa's Core method, Zettelkasten)
- Any role models or examples of the kind of expert they want? (e.g., "like a senior editor at The New Yorker")

# Phase 3: Build Identity

Once you have enough detail, delegate to the **identity-builder** subagent with a complete brief. Pass all gathered requirements.

Review the returned identity. If it doesn't capture the essence, iterate with corrections.

## Phase 4: Interview for Instructions

Ask about HOW this agent should operate:
- What files or directories will they work with?
- What's the typical session rhythm? (quick check-ins, deep work sessions, daily standups)
- What should they focus on? Any priority areas?
- Any hard constraints or things they should never do?
- Should they be proactive or reactive?
- Any recurring tasks or triggers? (daily summaries, weekly reviews)
- Should the agent do a nightly review? Most specialist agents should. Utility agents (like agent-builder) should not. If yes, ask what domain-specific focus the nightly review should have — this goes into the instructions. The shared nightly-review skill handles the rest.

## Phase 5: Build Instructions

Delegate to the **instructions-builder** subagent with requirements + the approved identity for context.

Review the returned instructions and triggers. Iterate if needed.

## Phase 6: Create the Agent

Present the complete agent configuration to the user:
- Name and ID
- Identity (who they are)
- Instructions (how they operate)
- Directories (if any)
- Triggers (if any)

Once approved, use the MCP tools to:
1. Call `create_agent` with identity and instructions
2. Call `write_triggers` if triggers were defined
3. If the agent has a nightly review, add a trigger:
   - Prompt: `/nightly-review`
   - Cron: stagger 10 min after the last existing agent's nightly slot, starting from `0 1 * * *` (01:00 local). Check other agents' triggers via `read_triggers` to find the next available slot.
   - Nova (chief of staff) always runs last — if adding a non-Nova agent, slot it before Nova's trigger time.

Confirm creation and tell the user how to start chatting with their new agent.
