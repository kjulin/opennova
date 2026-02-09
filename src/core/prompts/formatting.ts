import type { ChannelType } from "../threads.js";

const FORMATTING_INSTRUCTIONS: Record<string, string> = {
  telegram: `
<Formatting>
You are communicating via Telegram. Format your responses using Telegram's Markdown syntax:

- *bold* for emphasis
- _italic_ for subtle emphasis
- \`inline code\` for code references
- \`\`\`
code block
\`\`\` for code blocks

Do NOT escape special characters. Just write naturally.
Keep messages concise. Use bullet points and short paragraphs. Avoid walls of text.
</Formatting>`,
};

export function getFormattingInstructions(channel: ChannelType): string {
  const baseChannel = channel.startsWith("telegram") ? "telegram" : channel;
  return FORMATTING_INSTRUCTIONS[baseChannel] ?? "";
}
