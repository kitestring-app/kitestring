import type { ReactNode } from "react";
import { parseBlocks, safeLink } from "./markdown";

function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]*)\)/g;
  let from = 0;
  for (const match of text.matchAll(pattern)) {
    nodes.push(text.slice(from, match.index));
    const key = match.index;
    if (match[1]) nodes.push(<strong key={key}>{match[1]}</strong>);
    else if (match[2]) nodes.push(<em key={key}>{match[2]}</em>);
    else {
      const href = safeLink(match[4]);
      nodes.push(href ? <a key={key} href={href} target="_blank" rel="noopener noreferrer">{match[3]}</a> : match[0]);
    }
    from = match.index + match[0].length;
  }
  nodes.push(text.slice(from));
  return nodes;
}
export function MarkdownPreview({ text, onCheck }: { text: string; onCheck: (line: number) => void }) {
  const blocks = parseBlocks(text);
  const rendered: ReactNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (["bullet", "numbered", "checklist"].includes(block.kind)) {
      const items: ReactNode[] = [];
      const kind = block.kind;
      do {
        const item = blocks[i];
        items.push(<li key={item.line}>{kind === "checklist" ? <label><input type="checkbox" checked={item.checked} onChange={() => onCheck(item.line)} aria-label={`Complete ${item.text || "checklist item"}`} /><span>{inline(item.text)}</span></label> : inline(item.text)}</li>);
        i++;
      } while (i < blocks.length && blocks[i].kind === kind);
      i--;
      const List = kind === "numbered" ? "ol" : "ul";
      rendered.push(<List key={block.line} className={kind === "checklist" ? "note-checklist" : undefined}>{items}</List>);
    } else if (block.kind === "heading") {
      const Heading = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      rendered.push(<Heading key={block.line}>{inline(block.text)}</Heading>);
    } else rendered.push(<p key={block.line}>{block.text ? inline(block.text) : <br />}</p>);
  }
  return <div className="note-preview" aria-label="Formatted notes">{rendered}</div>;
}
