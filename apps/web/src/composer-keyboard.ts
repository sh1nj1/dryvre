export interface ComposerKeyEvent {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode?: number;
}

export function shouldSendComposerMessage(event: ComposerKeyEvent) {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229
  );
}

// Enter-to-send is a desktop composer affordance. Mobile layouts (≤850px, per
// the breakpoint in styles.css) fall back to Enter-as-newline because soft
// keyboards have no practical Shift+Enter; the send button submits there.
export const DESKTOP_COMPOSER_QUERY = "(min-width: 851px)";

export function isEnterToSendViewport(
  matchMedia?: (query: string) => { matches: boolean },
): boolean {
  const matcher =
    matchMedia ??
    (typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia.bind(window)
      : undefined);
  // No matchMedia (SSR / non-browser): default to the desktop Enter-to-send behavior.
  if (!matcher) return true;
  return matcher(DESKTOP_COMPOSER_QUERY).matches;
}
