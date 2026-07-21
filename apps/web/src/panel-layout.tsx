import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { ViewMode } from './model';

const STORAGE_KEY = 'dryvre.panel-widths.v1';
const LEFT_MIN = 190;
const LEFT_MAX = 420;
const CENTER_MIN = 320;
const STREAM_MIN = 320;
const STREAM_MAX = 640;
const INSPECTOR_MIN = 280;
const INSPECTOR_MAX = 520;

type StoredPanelWidths = {
  left: number;
  stream: number;
  inspector: number;
};

type ResizerProps = {
  className: string;
  label: string;
  value: number;
  min: number;
  max: number;
  direction: 1 | -1;
  onResize: (width: number) => void;
  onReset: () => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function defaults(viewportWidth: number): StoredPanelWidths {
  if (viewportWidth <= 1100) return { left: 230, stream: 360, inspector: 320 };
  return { left: 264, stream: 420, inspector: 340 };
}

function loadWidths(viewportWidth: number) {
  const fallback = defaults(viewportWidth);
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') as Partial<StoredPanelWidths>;
    return {
      left: typeof stored.left === 'number' ? stored.left : fallback.left,
      stream: typeof stored.stream === 'number' ? stored.stream : fallback.stream,
      inspector: typeof stored.inspector === 'number' ? stored.inspector : fallback.inspector,
    };
  } catch {
    return fallback;
  }
}

function fitWidths(leftValue: number, rightValue: number, viewportWidth: number, rightMin: number, rightMax: number) {
  let left = clamp(leftValue, LEFT_MIN, LEFT_MAX);
  let right = clamp(rightValue, rightMin, rightMax);
  let overflow = left + right - (viewportWidth - CENTER_MIN);

  if (overflow > 0) {
    const leftReduction = Math.min(overflow, left - LEFT_MIN);
    left -= leftReduction;
    overflow -= leftReduction;
    right -= Math.min(overflow, right - rightMin);
  }

  return { left, right };
}

export function usePanelLayout(view: ViewMode) {
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [widths, setWidths] = useState<StoredPanelWidths>(() => loadWidths(window.innerWidth));
  const rightKey = view === 'stream' ? 'inspector' : 'stream';
  const rightMin = rightKey === 'stream' ? STREAM_MIN : INSPECTOR_MIN;
  const rightMaxLimit = rightKey === 'stream' ? STREAM_MAX : INSPECTOR_MAX;
  const fitted = useMemo(
    () => fitWidths(widths.left, widths[rightKey], viewportWidth, rightMin, rightMaxLimit),
    [rightKey, rightMaxLimit, rightMin, viewportWidth, widths],
  );
  const leftMax = Math.max(LEFT_MIN, Math.min(LEFT_MAX, viewportWidth - fitted.right - CENTER_MIN));
  const rightMax = Math.max(rightMin, Math.min(rightMaxLimit, viewportWidth - fitted.left - CENTER_MIN));

  useEffect(() => {
    const updateViewport = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  // Persist only the panels the user actually resized/reset. The initial `widths` is
  // viewport-derived (defaults() falls back to compact values at <=1100px, where
  // resizers are also hidden below 850px), so an untouched panel still holds a fallback
  // the user never chose. Writing the whole object would store those fallbacks (e.g.
  // stream: 360, inspector: 320) after the user resized only one panel, masking the
  // desktop defaults on a later wide-viewport visit. `touched` tracks *which* keys were
  // changed; we merge only those into any existing stored prefs so untouched panels keep
  // falling back per-key in loadWidths(). Empty set on mount also keeps this StrictMode-safe.
  const touched = useRef<Set<keyof StoredPanelWidths>>(new Set());
  useEffect(() => {
    if (touched.current.size === 0) return;
    let stored: Partial<StoredPanelWidths> = {};
    try {
      stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<StoredPanelWidths>;
    } catch {
      stored = {};
    }
    for (const key of touched.current) stored[key] = widths[key];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  }, [widths]);

  return {
    left: fitted.left,
    right: fitted.right,
    leftMin: LEFT_MIN,
    leftMax,
    rightMin,
    rightMax,
    setLeft: (left: number) => {
      touched.current.add('left');
      setWidths((current) => ({ ...current, left: clamp(left, LEFT_MIN, leftMax) }));
    },
    setRight: (right: number) => {
      touched.current.add(rightKey);
      setWidths((current) => ({ ...current, [rightKey]: clamp(right, rightMin, rightMax) }));
    },
    resetLeft: () => {
      touched.current.add('left');
      setWidths((current) => ({ ...current, left: defaults(viewportWidth).left }));
    },
    resetRight: () => {
      touched.current.add(rightKey);
      setWidths((current) => ({ ...current, [rightKey]: defaults(viewportWidth)[rightKey] }));
    },
  };
}

export function PanelResizer({ className, label, value, min, max, direction, onResize, onReset }: ResizerProps) {
  const [dragStart, setDragStart] = useState<{ x: number; width: number }>();

  useEffect(() => {
    if (!dragStart) return;
    const move = (event: globalThis.PointerEvent) => onResize(dragStart.width + (event.clientX - dragStart.x) * direction);
    const stop = () => setDragStart(undefined);
    document.body.classList.add('panel-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
    return () => {
      document.body.classList.remove('panel-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [direction, dragStart, onResize]);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setDragStart({ x: event.clientX, width: value });
  };
  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const physicalDelta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (physicalDelta) {
      event.preventDefault();
      onResize(value + physicalDelta * direction * (event.shiftKey ? 32 : 12));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onResize(min);
    } else if (event.key === 'End') {
      event.preventDefault();
      onResize(max);
    }
  };

  return <div
    className={`panel-resizer ${className}${dragStart ? ' dragging' : ''}`}
    role="separator"
    aria-label={label}
    aria-orientation="vertical"
    aria-valuemin={Math.round(min)}
    aria-valuemax={Math.round(max)}
    aria-valuenow={Math.round(value)}
    tabIndex={0}
    title="Drag to resize · Double-click to reset"
    onPointerDown={startDrag}
    onKeyDown={resizeWithKeyboard}
    onDoubleClick={onReset}
  />;
}
