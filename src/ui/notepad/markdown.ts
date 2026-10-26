export type Format = "bold" | "italic" | "heading" | "bullet" | "numbered" | "checklist" | "link";
export interface Edit { text: string; start: number; end: number }
/** All edits splice source text. Neither pasted HTML nor imported text becomes DOM markup. */
export function formatSelection(text: string, start: number, end: number, format: Format, href = ""): Edit {
  const selected = text.slice(start, end);
  let replacement: string, selectStart = start, selectEnd: number;
  if (format === "bold" || format === "italic" || format === "link") {
    const label = selected || (format === "link" ? "link text" : "text");
    const marker = format === "bold" ? "**" : "*";
    replacement = format === "link" ? `[${label.replace(/[\[\]]/g, "")}](${href})` : marker + label + marker;
    selectStart += format === "link" ? 1 : marker.length;
    selectEnd = selectStart + label.length;
  } else {
    start = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
    // A selection ending at the next line's start must not format that next line.
    const last = end > start && text[end - 1] === "\n" ? end - 1 : end;
    const lineEnd = text.indexOf("\n", last);
    end = lineEnd === -1 ? text.length : lineEnd;
    replacement = text.slice(start, end).split("\n").map((line, index) => {
      const prefix = format === "heading" ? "## " : format === "bullet" ? "- " : format === "numbered" ? `${index + 1}. ` : "- [ ] ";
      return prefix + line.replace(/^(?:#{1,6}\s+|[-*]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/, "");
    }).join("\n");
    selectStart = start; selectEnd = start + replacement.length;
  }
  return { text: text.slice(0, start) + replacement + text.slice(end), start: selectStart, end: selectEnd };
}
export function safeLink(value: string): string | undefined {
  // Explicit schemes only; no scripts, data URLs, relative URLs or hidden controls.
  if (!/^(https?:\/\/|mailto:)/i.test(value) || /[\s\u0000-\u001f\u007f()<>]/.test(value)) return;
  try { const url = new URL(value); return ["http:", "https:", "mailto:"].includes(url.protocol) ? value : undefined; } catch { return; }
}
export function toggleChecklist(text: string, lineIndex: number): string {
  return text.split("\n").map((line, i) => i === lineIndex ? line.replace(/^(\s*[-*] \[)([ xX])(\])/, (_, before, checked, after) => before + (checked === " " ? "x" : " ") + after) : line).join("\n");
}
export interface Block { kind: "paragraph" | "heading" | "bullet" | "numbered" | "checklist"; text: string; line: number; level?: number; checked?: boolean }
export function parseBlocks(text: string): Block[] {
  return text.split("\n").map((source, line) => {
    const text = source.replace(/\r$/, "");
    const check = /^\s*[-*] \[([ xX])\]\s?(.*)$/.exec(text);
    if (check) return { kind: "checklist", text: check[2], line, checked: check[1] !== " " };
    const heading = /^(#{1,6})\s+(.*)$/.exec(text);
    if (heading) return { kind: "heading", text: heading[2], line, level: heading[1].length };
    const bullet = /^\s*[-*]\s+(.*)$/.exec(text);
    if (bullet) return { kind: "bullet", text: bullet[1], line };
    const numbered = /^\s*\d+\.\s+(.*)$/.exec(text);
    if (numbered) return { kind: "numbered", text: numbered[1], line };
    return { kind: "paragraph", text, line };
  });
}
export function noteCounts(text: string) {
  const plain = parseBlocks(text).map(block => block.text.replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1").replace(/\*\*([^*]+)\*\*|\*([^*]+)\*/g, (_, bold, italic) => bold ?? italic)).join("\n");
  return { words: plain.trim() ? plain.trim().split(/\s+/).length : 0, characters: plain.length };
}
