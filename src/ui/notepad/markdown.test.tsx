import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownPreview } from "./MarkdownPreview";
import { formatSelection, noteCounts, parseBlocks, safeLink, toggleChecklist } from "./markdown";
describe("safe note editing", () => {
  it("formats selected text and complete selected lines without changing surrounding content", () => {
    expect(formatSelection("one two three", 4, 7, "bold").text).toBe("one **two** three");
    expect(formatSelection("first\nsecond\nthird", 0, 13, "numbered").text).toBe("1. first\n2. second\nthird");
    expect(formatSelection("first\nsecond", 0, 6, "checklist").text).toBe("- [ ] first\nsecond");
    expect(formatSelection("\nfirst", 0, 0, "heading").text).toBe("## \nfirst");
    expect(formatSelection("bold", 0, 4, "italic").text).toBe("*bold*");
    expect(formatSelection("read", 0, 4, "link", "https://example.com").text).toBe("[read](https://example.com)");
  });
  it("ticks the chosen checklist line without changing other text or line endings", () => {
    const text = "## Plan\r\n- [ ] Write **draft**\r\n- [x] Review\n";
    const toggled = toggleChecklist(text, 1);
    expect(toggled).toBe(text.replace("[ ]", "[x]"));
    expect(toggleChecklist(toggled, 1)).toBe(text);
    expect(parseBlocks(toggled)[1].checked).toBe(true);
  });
  it("counts visible words and characters and renders headings, lists and inline formatting", () => {
    expect(noteCounts("## Plan\n- [ ] Write **draft**\n[Read](https://example.com)")).toEqual({ words: 4, characters: 21 });
    const html = renderToStaticMarkup(<MarkdownPreview text={"## Plan\n- **Write**\n1. *Read*\n- [x] Done"} onCheck={() => {}} />);
    expect(html).toContain("<h2>Plan</h2>"); expect(html).toContain("<strong>Write</strong>"); expect(html).toContain("<ol>"); expect(html).toContain("<em>Read</em>"); expect(html).toContain('type="checkbox"');
  });
  it("escapes pasted HTML and blocks dangerous link protocols without creating remote media", () => {
    for (const value of ["javascript:alert(1)", "data:text/html,x", "file:///tmp/a", "//evil.invalid", "https://a.invalid/\u0000", "https://example.com/a b"]) expect(safeLink(value)).toBeUndefined();
    expect(safeLink("mailto:hello@example.com")).toBeTruthy();
    const html = renderToStaticMarkup(<MarkdownPreview text={'<img src=x onerror=alert(1)>\n<script>alert(2)</script>\n[bad](javascript:alert)\n[ok](https://example.com)'} onCheck={() => {}} />);
    expect(html).not.toContain("<img"); expect(html).not.toContain("<script"); expect(html).not.toContain('href="javascript:');
    expect(html).toContain("&lt;script&gt;"); expect(html).toContain('rel="noopener noreferrer"');
  });
});
