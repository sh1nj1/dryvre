export function isInsideFencedCode(bodyMd: string, cursor: number) {
  return (bodyMd.slice(0, cursor).match(/^\s*```/gm)?.length ?? 0) % 2 === 1;
}

export function splitMarkdown(bodyMd: string, cursor: number) {
  return [bodyMd.slice(0, cursor), bodyMd.slice(cursor)] as const;
}

export function wrapMarkdown(
  bodyMd: string,
  start: number,
  end: number,
  marker: string,
  placeholder = "",
) {
  const selected = bodyMd.slice(start, end) || placeholder;
  const value = `${bodyMd.slice(0, start)}${marker}${selected}${marker}${bodyMd.slice(end)}`;
  const selectionStart = start + marker.length;
  return {
    value,
    selectionStart,
    selectionEnd: selectionStart + selected.length,
  };
}

export function markdownLink(bodyMd: string, start: number, end: number) {
  const label = bodyMd.slice(start, end) || "link text";
  const value = `${bodyMd.slice(0, start)}[${label}](url)${bodyMd.slice(end)}`;
  const urlStart = start + label.length + 3;
  return { value, selectionStart: urlStart, selectionEnd: urlStart + 3 };
}
