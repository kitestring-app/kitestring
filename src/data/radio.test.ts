/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { INITIAL_RADIO, RADIO_STATIONS, parseIcecast, parseNightride, parseParadise, radioVolume, restoreRadio, selectRadioStations } from "./radio";

describe("radio station catalogue", () => {
  it("contains seven distinct HTTPS stations and only verified stream hosts", () => {
    expect(RADIO_STATIONS).toHaveLength(7);
    expect(new Set(RADIO_STATIONS.map((s) => s.id)).size).toBe(RADIO_STATIONS.length);
    expect(new Set(RADIO_STATIONS.map((s) => s.stream)).size).toBe(RADIO_STATIONS.length);
    for (const station of RADIO_STATIONS) {
      for (const url of [station.stream, station.site, station.metadata?.url].filter(Boolean)) {
        expect(new URL(url!).protocol).toBe("https:");
        expect(new URL(url!).username).toBe("");
        expect(new URL(url!).password).toBe("");
      }
      expect(["stream.nightride.fm", "stream.radioparadise.com", "media01.gamingnow.net:8010"]).toContain(new URL(station.stream).host);
    }
    expect(RADIO_STATIONS.find((s) => s.id === "paradise-mellow")?.stream).toBe("https://stream.radioparadise.com/mellow-320");
  });

  it("filters names and descriptions, ignoring case and whitespace", () => {
    expect(selectRadioStations("  CHILL  SYNTH ", []).map((s) => s.id)).toEqual(["chillsynth"]);
    expect(selectRadioStations("paradise", [])).toHaveLength(2);
    expect(selectRadioStations("gamers", ["nightride"]).map((s) => s.id)).toEqual(["eve"]);
    expect(selectRadioStations("no such station", [])).toEqual([]);
    expect(selectRadioStations("   ", [])).toHaveLength(7);
  });

  it("sorts pins first, preserving catalogue order within each group without mutating it", () => {
    const original = RADIO_STATIONS.map((s) => s.id);
    const sorted = selectRadioStations("", ["eve", "chillsynth", "missing", "eve"]);
    expect(sorted.map((s) => s.id)).toEqual(["chillsynth", "eve", ...original.filter((id) => id !== "chillsynth" && id !== "eve")]);
    expect(selectRadioStations("nightride fm", ["darksynth"]).map((s) => s.id)).toEqual(["darksynth", "nightride", "chillsynth", "spacesynth"]);
    expect(RADIO_STATIONS.map((s) => s.id)).toEqual(original);
  });

  it("keeps both CSPs identical and permits every exact stream and metadata origin", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
    const deployed = vercel.headers[0].headers.find((h: { key: string }) => h.key === "Content-Security-Policy").value as string;
    const staticHeader = readFileSync("public/_headers", "utf8").match(/Content-Security-Policy: (.+)/)![1];
    expect(deployed).toBe(staticHeader);
    const directives = new Map(deployed.split(";").map((d) => { const [name, ...hosts] = d.trim().split(/\s+/); return [name, hosts]; }));
    for (const station of RADIO_STATIONS) {
      expect(directives.get("media-src")).toContain(new URL(station.stream).origin);
      expect(directives.get("connect-src")).toContain(new URL(station.stream).origin);
      if (station.metadata) expect(directives.get("connect-src")).toContain(new URL(station.metadata.url).origin);
    }
    expect(directives.get("connect-src")).not.toContain("*");
    expect(directives.get("media-src")).not.toContain("*");
    expect(directives.get("frame-src")).toEqual(["https://www.youtube.com", "https://open.spotify.com", "https://embed.music.apple.com", "https://music.amazon.com", "https://w.soundcloud.com"]);
  });
});

describe("saved radio preferences", () => {
  it("restores only valid IDs and finite bounded volume", () => {
    expect(restoreRadio({ pinned: ["eve", "missing", null, "eve"], lastStation: "paradise-mellow", volume: 2 })).toEqual({ pinned: ["eve"], lastStation: "paradise-mellow", volume: 1 });
    expect(restoreRadio({ pinned: "eve", lastStation: "bad", volume: NaN })).toEqual(INITIAL_RADIO);
    for (const value of [null, [], "broken", { volume: "loud" }]) expect(restoreRadio(value)).toEqual(INITIAL_RADIO);
    expect(radioVolume(-1)).toBe(0);
    expect(radioVolume(Infinity)).toBe(0.5);
  });
});

describe("now-playing parsers", () => {
  it("selects the requested Nightride station from actual SSE data payloads", () => {
    const rows = [{ station: "chillsynth", artist: "Adieu Aru", title: "Igneses" }, { station: "nightride", artist: " GalactiCop ", title: " Undead Planet " }];
    expect(parseNightride(JSON.stringify(rows), "nightride")).toBe("GalactiCop — Undead Planet");
    expect(parseNightride(rows, "chillsynth")).toBe("Adieu Aru — Igneses");
    expect(parseNightride(rows, "darksynth")).toBeNull();
  });

  it("parses Radio Paradise without depending on album art or other fields", () => {
    expect(parseParadise({ artist: "Eurythmics", title: "Here Comes the Rain Again", album: "Storytellers" })).toBe("Eurythmics — Here Comes the Rain Again");
    expect(parseParadise('{"artist":"Artist","title":"Title"}')).toBe("Artist — Title");
  });

  it("selects EVE's exact mount, handling both Icecast source shapes", () => {
    const eve = { listenurl: "http://media01.gamingnow.net:8000/erweb.mp3", title: "Artist - Song - Live" };
    const stream = RADIO_STATIONS.find((s) => s.id === "eve")!.stream;
    expect(parseIcecast({ icestats: { source: [{ listenurl: "http://example.test/ssr.mp3", title: "Wrong" }, eve] } }, stream)).toBe("Artist — Song - Live");
    expect(parseIcecast(JSON.stringify({ icestats: { source: eve } }), stream)).toBe("Artist — Song - Live");
    expect(parseIcecast({ icestats: { source: { listenurl: "bad", title: "Wrong" } } }, stream)).toBeNull();
    expect(parseIcecast({}, stream)).toBeNull();
  });

  it("rejects malformed, partial, and non-string metadata", () => {
    for (const value of [null, 12, "invalid JSON", {}, [], { artist: "", title: "Title" }, { artist: "Artist", title: 42 }]) {
      expect(parseParadise(value)).toBeNull();
      expect(parseNightride(value, "nightride")).toBeNull();
    }
    expect(parseNightride([null, { station: "nightride", artist: "Artist" }], "nightride")).toBeNull();
  });
});
