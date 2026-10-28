import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AboutTab } from "./settings/AboutTab";
import { Credits } from "./Credits";

const html = readFileSync("public/research.html", "utf8");
// Claims language contract, evidence.md. Kept here so the public tests are self-contained.
const banned = [
  "treats", "cures", "diagnoses", "clinically proven to reduce", "FDA approved", "FDA cleared",
  "boosts dopamine", "resets dopamine", "detoxes dopamine", "balances cortisol",
  "regulates your nervous system", "measures your brain's arousal",
  "25/5 is the scientifically optimal ADHD cycle", "every interruption costs 23 minutes",
  "you must save a note before stopping", "Focus Score measures attention",
  "brown noise treats ADHD", "this frequency is clinically optimised for ADHD",
  "binaural beats treat ADHD", "all instrumental music improves concentration",
  "one sigh switches off anxiety", "5.5 breaths a minute works best",
  "this one-minute reset has the benefits of an eight-week mindfulness course",
  "body doubling is proven treatment", "an AI double works like a person", "99% productivity improvement",
  "streaks clinically worsen ADHD/depression", "removing streaks is proven to improve mental health",
  "you will build a habit in 21 days", "66 days guarantees a habit",
  "missing sessions means you are not trying", "more timer minutes means better recovery",
  "failing this app means failing treatment",
];
const mapping: Record<string, [string, string[]]> = {
  action: ["moderate", ["S1"]], tiny: ["weak", ["S3"]], cue: ["moderate", ["S5", "S6"]],
  parking: ["moderate", ["S3"]], return: ["weak", ["S11", "S13"]],
  breaks: ["moderate", ["S8", "S9"]], display: ["weak", ["S10"]],
  quiet: ["moderate", ["S14", "S15"]], records: ["moderate", ["S16"]],
  restart: ["weak", ["S17", "S18"]], reward: ["weak", ["S19"]],
  sound: ["weak", ["S24", "S25", "S26"]], breathing: ["weak", ["S27", "S28", "S29"]],
};

it("bundles a static explanation with a conservative rating and sources for every feature", () => {
  expect(html).toContain("<h1>Why it works this way</h1>");
  const rows = [...html.matchAll(/<article data-feature="([^"]+)"[\s\S]*?<\/article>/g)];
  expect(rows.map(row => row[1]).sort()).toEqual(Object.keys(mapping).sort());
  for (const [row, id] of rows) {
    const [strength, sources] = mapping[id];
    expect(row).toContain(`href="#${strength}"`);
    for (const source of sources) {
      expect(row).toContain(`href="#${source}"`);
      expect(html).toMatch(new RegExp(`id="${source}"[\\s\\S]*?<a href="https://`));
    }
  }
  expect(html).not.toMatch(/<script|<iframe|<link|@import|url\(|\son\w+=/i);
  expect(html).toContain("prefers-color-scheme: light");
  expect(html).toContain("prefers-reduced-motion: reduce");
});

it("keeps changed user-facing copy within the claims contract", () => {
  const copy = [html, readFileSync("src/ui/settings/AboutTab.tsx", "utf8"), readFileSync("src/ui/Credits.tsx", "utf8")]
    .join(" ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").toLowerCase();
  for (const phrase of banned) expect(copy, phrase).not.toContain(phrase.toLowerCase());
});

it("links About and the footer to the bundled page in the same window on web and Mac", () => {
  try {
    for (const desktop of [undefined, {}]) {
      vi.stubGlobal("window", { desktop });
      for (const component of [<AboutTab />, <Credits />]) {
        const markup = renderToStaticMarkup(component);
        expect(markup).toMatch(/<a[^>]*href="\.\/research.html"[^>]*>Why it works this way<\/a>/);
        const link = markup.match(/<a[^>]*href="\.\/research.html"[^>]*>/)?.[0];
        expect(link).not.toMatch(/target=/);
      }
    }
  } finally { vi.unstubAllGlobals(); }
});
