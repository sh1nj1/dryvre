import { describe, expect, it } from "vitest";
import {
  type ComposerKeyEvent,
  shouldSendComposerMessage,
} from "./composer-keyboard";

const enterKey = (
  overrides: Partial<ComposerKeyEvent> = {},
): ComposerKeyEvent => ({
  key: "Enter",
  shiftKey: false,
  isComposing: false,
  ...overrides,
});

describe("stream composer keyboard shortcuts", () => {
  it("sends with Enter", () => {
    expect(shouldSendComposerMessage(enterKey())).toBe(true);
  });

  it("keeps Shift+Enter for a new line", () => {
    expect(shouldSendComposerMessage(enterKey({ shiftKey: true }))).toBe(false);
  });

  it("does not send while an IME is composing text", () => {
    expect(shouldSendComposerMessage(enterKey({ isComposing: true }))).toBe(
      false,
    );
    expect(shouldSendComposerMessage(enterKey({ keyCode: 229 }))).toBe(false);
  });

  it("ignores keys other than Enter", () => {
    expect(shouldSendComposerMessage(enterKey({ key: "a" }))).toBe(false);
  });
});
