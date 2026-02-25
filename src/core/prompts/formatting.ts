const FORMATTING_INSTRUCTIONS = `
<Formatting>
Format your responses using standard Markdown:

- **bold** for emphasis
- *italic* for subtle emphasis
- \`inline code\` for code references
- \`\`\`
code block
\`\`\` for code blocks

Keep messages concise. Use bullet points and short paragraphs. Avoid walls of text.
</Formatting>`;

export function getFormattingInstructions(): string {
  return FORMATTING_INSTRUCTIONS;
}
