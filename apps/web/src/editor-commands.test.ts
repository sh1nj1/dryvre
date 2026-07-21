import { describe, expect, it } from "vitest";
import {
  isInsideFencedCode,
  markdownLink,
  splitMarkdown,
  wrapMarkdown,
} from "./editor-commands";

describe("block editor commands", () => {
  it("splits Markdown at the exact cursor position", () => {
    expect(splitMarkdown("beforeafter", 6)).toEqual(["before", "after"]);
  });

  it("keeps Enter inside an open fenced code block", () => {
    const markdown = "intro\n```ts\nconst value = 1;\n```\noutro";
    expect(isInsideFencedCode(markdown, markdown.indexOf("const"))).toBe(true);
    expect(isInsideFencedCode(markdown, markdown.indexOf("outro"))).toBe(false);
  });

  it("wraps selected text and builds Markdown links", () => {
    expect(wrapMarkdown("make this bold", 5, 9, "**").value).toBe(
      "make **this** bold",
    );
    expect(markdownLink("visit Dryvre", 6, 12).value).toBe(
      "visit [Dryvre](url)",
    );
  });
});
