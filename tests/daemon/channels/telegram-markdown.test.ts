import { describe, it, expect } from "vitest";
import { toTelegramMarkdown } from "../../../src/daemon/channels/telegram-utils.js";

describe("toTelegramMarkdown", () => {
  it("converts **bold** to *bold*", () => {
    expect(toTelegramMarkdown("Hello **world**")).toBe("Hello *world*");
  });

  it("converts *italic* to _italic_", () => {
    expect(toTelegramMarkdown("Hello *world*")).toBe("Hello _world_");
  });

  it("converts __bold__ to *bold*", () => {
    expect(toTelegramMarkdown("Hello __world__")).toBe("Hello *world*");
  });

  it("converts headings to bold", () => {
    expect(toTelegramMarkdown("# Heading")).toBe("*Heading*");
    expect(toTelegramMarkdown("## Sub heading")).toBe("*Sub heading*");
    expect(toTelegramMarkdown("### Deep heading")).toBe("*Deep heading*");
  });

  it("preserves inline code", () => {
    expect(toTelegramMarkdown("Use `**bold**` syntax")).toBe("Use `**bold**` syntax");
  });

  it("preserves code blocks", () => {
    const input = "Before\n```\n**bold** in code\n```\nAfter **bold**";
    const expected = "Before\n```\n**bold** in code\n```\nAfter *bold*";
    expect(toTelegramMarkdown(input)).toBe(expected);
  });

  it("handles mixed bold and italic", () => {
    expect(toTelegramMarkdown("**bold** and *italic*")).toBe("*bold* and _italic_");
  });

  it("preserves links", () => {
    expect(toTelegramMarkdown("[text](https://example.com)")).toBe("[text](https://example.com)");
  });

  it("handles text without markdown", () => {
    expect(toTelegramMarkdown("Hello world")).toBe("Hello world");
  });

  it("handles bullet lists with bold", () => {
    const input = "- **Item 1**: description\n- **Item 2**: description";
    const expected = "- *Item 1*: description\n- *Item 2*: description";
    expect(toTelegramMarkdown(input)).toBe(expected);
  });
});
