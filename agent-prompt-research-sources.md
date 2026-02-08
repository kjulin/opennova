# Agent System Prompt Research Sources (Feb 2026)

Research on best practices for structuring agent system prompts with Claude Opus 4.5/4.6.

## Anthropic Official Documentation

- [Context Engineering for AI Agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) - Core principles: "right altitude", minimal high-signal tokens
- [Claude Agent SDK: Modifying System Prompts](https://platform.claude.com/docs/en/agent-sdk/modifying-system-prompts) - Three methods: custom, append, CLAUDE.md
- [Claude 4 Prompting Best Practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-4-best-practices) - Opus 4.5/4.6 specific guidance
- [Role Prompting with System Prompts](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/system-prompts) - Identity/persona assignment
- [XML Tags for Prompt Structure](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/use-xml-tags) - Structuring with tags
- [Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview) - SDK architecture
- [Building Agents with Claude Agent SDK](https://claude.com/blog/building-agents-with-the-claude-agent-sdk) - Operational patterns

## Community Resources

- [Claude Code System Prompts Repository](https://github.com/Piebald-AI/claude-code-system-prompts) - Extracted Claude Code prompts (v2.1.37)
- [Claude Agent Skills Deep Dive](https://leehanchung.github.io/blogs/2025/10/26/claude-skills-deep-dive/) - First principles analysis
- [Anthropic Prompt Engineering Tutorial](https://github.com/anthropics/prompt-eng-interactive-tutorial) - Interactive examples

## Persona/Role Research

- [Role Prompting Guide](https://learnprompting.org/docs/advanced/zero_shot/role_prompting) - Persona-based task guidance
- [LLM Personas: Style, Tone, and Intent](https://brimlabs.ai/blog/llm-personas-how-system-prompts-influence-style-tone-and-intent/) - How system prompts shape behavior
- [The Persona Pattern](https://towardsai.net/p/artificial-intelligence/the-persona-pattern-unlocking-modular-intelligence-in-ai-agents) - Modular agent identity
- [Agentic Prompt Engineering: Roles](https://www.clarifai.com/blog/agentic-prompt-engineering) - Role-based formatting
- [Does Adding Personas Really Help?](https://www.prompthub.us/blog/role-prompting-does-adding-personas-to-your-prompts-really-make-a-difference) - Research on effectiveness

## Key Takeaways

1. **Structure as contract**: "You are" (role) + "Goal" (success criteria) + "Constraints"
2. **Use XML tags**: `<identity>`, `<instructions>`, `<working_arrangement>`
3. **Right altitude**: Specific enough to guide, flexible enough for heuristics
4. **Opus 4.5/4.6**: More instruction-sensitive, dial back aggressive prompting
