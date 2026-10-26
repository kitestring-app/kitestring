import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { musicFavouriteUrl, toEmbedUrl } from "./stations";

const require = createRequire(import.meta.url);
const { shouldBlockYouTube } = require("../../desktop/youtube-policy.cjs");

describe("SoundCloud links", () => {
  it.each(["artist/quiet-track", "artist/sets/evening-playlist", "artist-name/Track_2/"])("embeds %s using only the canonical URL", path => {
    const source = `https://soundcloud.com/${path}`;
    const embed = toEmbedUrl(`  ${source}  `)!;
    const canonical = source.replace(/\/$/, "");
    expect(embed).toEqual({ provider: "SoundCloud", sourceUrl: canonical, url: `https://w.soundcloud.com/player/?url=${encodeURIComponent(canonical)}` });
    const widget = new URL(embed.url);
    expect([...widget.searchParams]).toEqual([["url", canonical]]);
    // Favourites persist the share link, so the strict paste validator can restore them.
    expect(toEmbedUrl(embed.sourceUrl!)).toEqual(embed);
    expect(musicFavouriteUrl(source)).toBe(canonical);
    expect(shouldBlockYouTube(embed.url, "subFrame")).toBe(false);
  });
  it.each([
    "http://soundcloud.com/artist/track", "https://soundcloud.com/artist", "https://soundcloud.com/artist/sets",
    "https://soundcloud.com/artist/sets/list/extra", "https://soundcloud.com/artist/track/s-secret",
    "https://soundcloud.com/artist/track?utm_source=share", "https://soundcloud.com/artist/track?auto_play=true",
    "https://soundcloud.com/artist/track#t=10", "https://soundcloud.com/artist/track?", "https://soundcloud.com/artist/track#",
    "https://w.soundcloud.com/player/?url=https://evil.test/", "https://api.soundcloud.com/tracks/123",
    "https://on.soundcloud.com/short", "https://www.soundcloud.com/artist/track",
    "https://soundcloud.com.evil.test/artist/track", "https://soundcloud.com@evil.test/artist/track",
    "https://user@soundcloud.com/artist/track", "https://soundcloud.com:444/artist/track", "https://soundcloud.com:443/artist/track",
    "https://soundcloud.com/artist/%2ftrack", "https://soundcloud.com/artist/a/../track", "https://soundcloud.com/artist/%2e%2e/track",
    "https://soundcloud.com/artist\\track", "https://soundcloud.com//artist/track", "https://soundcloud.com/search/sounds",
    "https://soundcloud.com/artist/tracks", "<iframe src='https://soundcloud.com/artist/track'></iframe>",
  ])("rejects %s", input => expect(toEmbedUrl(input)).toBeNull());
  it("allows only the widget origin in matching web and Mac CSPs", () => {
    const headers = readFileSync("public/_headers", "utf8");
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
    const web = vercel.headers[0].headers.find((h: { key: string }) => h.key === "Content-Security-Policy").value;
    const local = headers.match(/Content-Security-Policy: (.+)/)![1];
    expect(web).toBe(local);
    const frames = web.match(/frame-src ([^;]+)/)![1].split(" ");
    expect(frames).toContain("https://w.soundcloud.com");
    expect(frames).not.toContain("https://soundcloud.com");
    expect(frames).not.toContain("*");
    expect(shouldBlockYouTube("https://www.youtube.com/watch?v=unlisted", "subFrame")).toBe(true);
  });
});

it("keeps SoundCloud favourites through repeated mixer reloads", async () => {
  const { parseMixerData } = await import("../audio/mixer");
  const saved = { favourites: [{ id: "sc", name: "Quiet hours", emoji: "♫", url: "https://soundcloud.com/artist/sets/quiet-hours" }] };
  const restored = parseMixerData(saved);
  expect(restored.favourites[0]).toEqual(saved.favourites[0]);
  expect(parseMixerData(JSON.parse(JSON.stringify(restored)))).toEqual(restored);
});
