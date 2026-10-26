import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BarFace, DotsFace, FlipFace, GaugeFace, PieFace } from "./styles";

describe("remaining time geometry", () => {
  it("inverts elapsed progress and bounds invalid values", () => {
    for (const [progress, expected] of [[0, 1], [0.25, 0.75], [0.5, 0.5], [1, 0], [-1, 1], [2, 0], [NaN, 1], [Infinity, 1]]) {
      const markup = renderToStaticMarkup(<BarFace display="25:00" progress={progress} showNumbers />);
      expect(markup).toContain(`scaleX(${expected})`);
    }
  });

  it("handles empty, full, and partial pie slices", () => {
    const slices = [1, 0, 0.75, 0.5, 0.25].map(progress =>
      renderToStaticMarkup(<PieFace display="25:00" progress={progress} showNumbers />));
    expect(slices[0]).toContain('d=""');
    expect(slices[1].match(/ A /g)).toHaveLength(2);
    expect(slices[2]).toContain('d="M 50 50 L 50 4 A 46 46 0 0 1 96 50 Z"');
    expect(slices[3]).toContain("A 46 46 0 0 1");
    expect(slices[4]).toContain("A 46 46 0 1 1 4");
  });
});

describe("timer faces", () => {
  const props = { display: "24:58", progress: 0.4, showNumbers: true };
  for (const Face of [BarFace, GaugeFace, DotsFace, PieFace]) {
    it(`${Face.name} hides visible numbers but keeps an accessible time`, () => {
      const visible = renderToStaticMarkup(<Face {...props} big={false} />);
      const hidden = renderToStaticMarkup(<Face {...props} showNumbers={false} />);
      expect(visible).toContain("is-compact");
      expect(visible).toContain('class="face-time"');
      expect(hidden).not.toContain('class="face-time"');
      expect(hidden).toContain('aria-label="24:58"');
    });
  }

  it.each(["2:24", "24:58", "1:02:03", "14:24:05"])("renders split cards and colons for %s even without numbers", (display) => {
    const markup = renderToStaticMarkup(<FlipFace {...props} display={display} showNumbers={false} />);
    expect(markup.match(/class="flip-card"/g)).toHaveLength(display.replaceAll(":", "").length);
    expect(markup.match(/class="flip-colon"/g)).toHaveLength(display.split(":").length - 1);
    expect(markup).not.toContain("flip-fold");
  });

  it.each([[0, 30], [0.1, 27], [0.4, 18], [0.7, 9], [0.8, 6], [1, 0]])("switches dots off at progress %s", (progress, count) => {
    const markup = renderToStaticMarkup(<DotsFace {...props} progress={progress} />);
    expect(markup.match(/class="face-dot /g)).toHaveLength(30);
    expect(markup.match(/face-dot is-lit/g) ?? []).toHaveLength(count);
  });

  it("shrinks the bar and removes the round gauge cap at completion", () => {
    expect(renderToStaticMarkup(<BarFace {...props} />)).toContain("scaleX(0.6)");
    expect(renderToStaticMarkup(<GaugeFace {...props} progress={1} />)).toContain('opacity="0"');
    expect(renderToStaticMarkup(<PieFace {...props} progress={1} />)).toContain('d=""');
  });
});
