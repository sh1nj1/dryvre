import { useCallback, useEffect, useRef, useState } from "react";
import {
  isInsideFencedCode,
  markdownLink,
  splitMarkdown,
  wrapMarkdown,
} from "./editor-commands";

export type EditorSaveResult = { version: number };
export type EditorSaveState = "saved" | "saving" | "conflict" | "offline";

export function BlockEditor({
  bodyMd,
  version,
  onEdit,
  onCreateAfter,
  onDelete,
  onExit,
}: {
  bodyMd: string;
  version: number;
  onEdit: (bodyMd: string, version: number) => Promise<EditorSaveResult>;
  onCreateAfter: (bodyMd: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onExit: () => void;
}) {
  const [value, setValue] = useState(bodyMd);
  const [saveState, setSaveState] = useState<EditorSaveState>("saved");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef(value);
  const savedRef = useRef({ bodyMd, version });
  const savingRef = useRef<Promise<boolean> | null>(null);
  const composingRef = useRef(false);

  valueRef.current = value;

  const resize = useCallback(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "0";
    element.style.height = `${element.scrollHeight}px`;
  }, []);

  useEffect(() => {
    textarea.current?.focus();
    resize();
  }, [resize]);

  const save = useCallback(
    async (nextBody = valueRef.current): Promise<boolean> => {
      if (savingRef.current) {
        const saved = await savingRef.current;
        return (
          saved && (nextBody === savedRef.current.bodyMd || save(nextBody))
        );
      }
      if (nextBody === savedRef.current.bodyMd) return true;
      setSaveState("saving");
      const request = onEdit(nextBody, savedRef.current.version)
        .then((result) => {
          savedRef.current = { bodyMd: nextBody, version: result.version };
          setSaveState("saved");
          return true;
        })
        .catch((reason: unknown) => {
          const message =
            reason instanceof Error ? reason.message.toLocaleLowerCase() : "";
          setSaveState(
            message.includes("changed") || message.includes("conflict")
              ? "conflict"
              : "offline",
          );
          return false;
        })
        .finally(() => {
          savingRef.current = null;
        });
      savingRef.current = request;
      const saved = await request;
      if (saved && valueRef.current !== savedRef.current.bodyMd)
        return save(valueRef.current);
      return saved;
    },
    [onEdit],
  );

  useEffect(() => {
    if (value === savedRef.current.bodyMd) return;
    const timer = window.setTimeout(() => {
      void save();
    }, 650);
    return () => window.clearTimeout(timer);
  }, [save, value]);

  const replaceSelection = (result: {
    value: string;
    selectionStart: number;
    selectionEnd: number;
  }) => {
    setValue(result.value);
    requestAnimationFrame(() => {
      textarea.current?.setSelectionRange(
        result.selectionStart,
        result.selectionEnd,
      );
      resize();
    });
  };

  return (
    <div className="block-editor" onClick={(event) => event.stopPropagation()}>
      <textarea
        ref={textarea}
        aria-label="Block Markdown"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          resize();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        onBlur={() => {
          void save().then((saved) => {
            if (saved) onExit();
          });
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || composingRef.current) return;
          const target = event.currentTarget;
          const command = event.metaKey || event.ctrlKey;
          if (event.key === "Escape") {
            event.preventDefault();
            setValue(savedRef.current.bodyMd);
            onExit();
            return;
          }
          if (command && event.key === "Enter") {
            event.preventDefault();
            void save().then((saved) => {
              if (saved) onExit();
            });
            return;
          }
          if (command && event.key.toLocaleLowerCase() === "b") {
            event.preventDefault();
            replaceSelection(
              wrapMarkdown(
                value,
                target.selectionStart,
                target.selectionEnd,
                "**",
                "bold",
              ),
            );
            return;
          }
          if (command && event.key.toLocaleLowerCase() === "i") {
            event.preventDefault();
            replaceSelection(
              wrapMarkdown(
                value,
                target.selectionStart,
                target.selectionEnd,
                "*",
                "italic",
              ),
            );
            return;
          }
          if (command && event.key.toLocaleLowerCase() === "k") {
            event.preventDefault();
            replaceSelection(
              markdownLink(value, target.selectionStart, target.selectionEnd),
            );
            return;
          }
          if (event.key === "Backspace" && value === "") {
            event.preventDefault();
            void onDelete();
            return;
          }
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !isInsideFencedCode(value, target.selectionStart)
          ) {
            event.preventDefault();
            const [before, after] = splitMarkdown(value, target.selectionStart);
            setValue(before);
            valueRef.current = before;
            void save(before).then((saved) => {
              if (saved) return onCreateAfter(after);
            });
          }
        }}
      />
      <span
        className={`save-state ${saveState}`}
        role="status"
        aria-live="polite"
      >
        {saveState}
      </span>
    </div>
  );
}
