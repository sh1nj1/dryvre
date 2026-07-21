import { describe, expect, it } from "vitest";
import {
  type ComposerKeyEvent,
  DESKTOP_COMPOSER_QUERY,
  isEnterToSendViewport,
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

describe("Enter-to-send viewport gate", () => {
  it("enables Enter-to-send on the desktop composer layout", () => {
    expect(
      isEnterToSendViewport((query) => ({
        matches: query === DESKTOP_COMPOSER_QUERY,
      })),
    ).toBe(true);
  });

  it("keeps Enter as a newline on mobile layouts", () => {
    expect(isEnterToSendViewport(() => ({ matches: false }))).toBe(false);
  });

  it("defaults to desktop behavior without matchMedia", () => {
    expect(isEnterToSendViewport(undefined)).toBe(true);
  });
});
