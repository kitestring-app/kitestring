import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClockFace, TapeFace } from "./lookFaces";

describe("ClockFace", () => {
  it.each(["focus", "short", "long"] as const)("renders %s with an active and an inactive dial", (segment) => {
    const markup = renderToStaticMarkup(<ClockFace display="25:00" progress={0.5} showNumbers segment={segment} />);
    expect(markup).toContain('aria-label="25:00"');
    expect(markup).toContain('class="face-time"');
    expect(markup).toContain('data-active="true"');
    expect(markup).toContain('data-active="false"');
    expect(markup).toContain("is-active");
    expect(markup).toContain("is-inactive");
  });

  it("sweeps the active hand with progress and stays NaN-safe", () => {
    expect(renderToStaticMarkup(<ClockFace display="25:00" progress={0.5} showNumbers />)).toContain("--sweep:180deg");
    expect(renderToStaticMarkup(<ClockFace display="25:00" progress={1} showNumbers />)).toContain("--sweep:360deg");
    const nan = renderToStaticMarkup(<ClockFace display="25:00" progress={NaN} showNumbers />);
    expect(nan).toContain("--sweep:0deg");
    expect(nan).not.toContain("NaN");
  });

  it("hides visible numbers but keeps an accessible time", () => {
    const visible = renderToStaticMarkup(<ClockFace display="24:58" progress={0.4} showNumbers big={false} />);
    const hidden = renderToStaticMarkup(<ClockFace display="24:58" progress={0.4} showNumbers={false} />);
    expect(visible).toContain("is-compact");
    expect(visible).toContain('class="face-time"');
    expect(hidden).not.toContain('class="face-time"');
    expect(hidden).toContain('aria-label="24:58"');
  });

  it("shows ADJOURN on the break dial for long segments", () => {
    const markup = renderToStaticMarkup(<ClockFace display="25:00" progress={0.2} showNumbers segment="long" />);
    expect(markup).toContain("ADJOURN");
  });
});

describe("TapeFace", () => {
  it.each([0, 0.25, 0.5, 1])("renders progress %s with a torn edge and visible time", (progress) => {
    const markup = renderToStaticMarkup(<TapeFace display="25:00" progress={progress} showNumbers />);
    expect(markup).toContain('aria-label="25:00"');
    expect(markup).toContain('class="face-time"');
    expect(markup).toContain('class="tape-tear"');
    expect(markup).toContain("--tape-progress");
  });

  it("clamps invalid progress and stays NaN-safe", () => {
    const nan = renderToStaticMarkup(<TapeFace display="25:00" progress={NaN} showNumbers />);
    expect(nan).toContain("--tape-progress:0");
    expect(nan).not.toContain("NaN");
    const over = renderToStaticMarkup(<TapeFace display="25:00" progress={2} showNumbers />);
    expect(over).toContain("--tape-progress:1");
  });

  it("hides visible numbers but keeps an accessible time", () => {
    const visible = renderToStaticMarkup(<TapeFace display="24:58" progress={0.4} showNumbers big={false} />);
    const hidden = renderToStaticMarkup(<TapeFace display="24:58" progress={0.4} showNumbers={false} />);
    expect(visible).toContain("is-compact");
    expect(visible).toContain('class="face-time"');
    expect(hidden).not.toContain('class="face-time"');
    expect(hidden).toContain('aria-label="24:58"');
  });
});