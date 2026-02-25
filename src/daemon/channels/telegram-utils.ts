/**
 * Telegram message utilities.
 *
 * Telegram's sendMessage API limits text to 4096 characters.
 * This module provides helpers to split long messages into
 * multiple chunks, breaking at paragraph or line boundaries
 * when possible.
 */

import type { Context, NextFunction } from "grammy";

const TELEGRAM_MAX_LENGTH = 4096;

/**
 * Split a message into chunks that fit within Telegram's 4096-character limit.
 * Prefers splitting at paragraph boundaries (\n\n), then line boundaries (\n),
 * then at the hard limit as a last resort.
 */
export function splitMessage(text: string, maxLength = TELEGRAM_MAX_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a paragraph boundary (\n\n)
    let splitIndex = remaining.lastIndexOf("\n\n", maxLength);
    if (splitIndex > maxLength * 0.3) {
      // Found a reasonable paragraph break — split after it
      chunks.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex + 2); // skip the \n\n
      continue;
    }

    // Try to split at a line boundary (\n)
    splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex > maxLength * 0.3) {
      chunks.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex + 1); // skip the \n
      continue;
    }

    // Hard split at max length as last resort
    chunks.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }

  return chunks;
}

/**
 * Convert standard Markdown to Telegram's legacy Markdown format.
 *
 * Telegram's "Markdown" parse_mode supports:
 *   *bold*  _italic_  `inline code`  ```code block```  [text](url)
 *
 * Standard Markdown uses **bold** and *italic*, so we convert:
 *   **text** → *text*   (bold)
 *   *text*  → _text_    (italic)
 *   # heading → *heading* (bold, Telegram has no headings)
 *
 * Code blocks and inline code are left untouched.
 */
export function toTelegramMarkdown(text: string): string {
  // Protect code blocks and inline code by replacing them with placeholders
  const protected_: string[] = [];
  function protect(match: string): string {
    protected_.push(match);
    return `\x00P${protected_.length - 1}\x00`;
  }

  let result = text.replace(/```[\s\S]*?```/g, protect);
  result = result.replace(/`[^`]+`/g, protect);

  // Convert headings (# text) to bold — use placeholder to avoid italic conversion
  result = result.replace(/^#{1,6}\s+(.+)$/gm, (_match, content) => `\x01B${content}\x01`);

  // Convert **bold** → placeholder (to avoid italic regex picking it up)
  result = result.replace(/\*\*(.+?)\*\*/g, (_match, content) => `\x01B${content}\x01`);

  // Convert __bold__ → placeholder
  result = result.replace(/__(.+?)__/g, (_match, content) => `\x01B${content}\x01`);

  // Convert remaining *italic* → _italic_
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "_$1_");

  // Restore bold placeholders → *bold*
  result = result.replace(/\x01B([\s\S]*?)\x01/g, "*$1*");

  // Restore protected code
  result = result.replace(/\x00P(\d+)\x00/g, (_, i) => protected_[Number(i)]!);

  return result;
}

export function chatGuard(authorizedChatId: string) {
  return (ctx: Context, next: NextFunction) => {
    const chatId = ctx.chat?.id;
    if (!chatId || String(chatId) !== authorizedChatId) {
      // Silent drop — don't leak bot existence to unauthorized users
      return;
    }
    return next();
  };
}
