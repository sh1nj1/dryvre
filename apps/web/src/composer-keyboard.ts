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
