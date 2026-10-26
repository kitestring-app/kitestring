import { describe, expect, it } from "vitest";
import { parseLayers, parseMix, serializeMix, SOUNDS } from "./sounds";
import type { SoundMix } from "./sounds";
import { parseMixerData } from "../audio/mixer";
import { readFileSync, statSync } from "node:fs";

describe("mix serialization", () => {
  it("ships small Ogg recordings and keeps their source and licence credits", () => {
    const credits = readFileSync("public/LICENSES.md", "utf8");
    for (const sound of SOUNDS.filter((item) => item.file)) {
      const path = `public/sounds/${sound.file}`;
      expect(statSync(path).size, path).toBeLessThan(1_500_000);
      expect(readFileSync(path).subarray(0, 4).toString(), path).toBe("OggS");
      expect(credits, path).toContain(`sounds/${sound.file}`);
    }
    expect(credits).toContain("https://creativecommons.org/publicdomain/zero/1.0/");
  });
  it("covers the audited subjects with acyclic, known local scene layers", () => {
    for (const id of ["airplane-cabin", "exam-hall", "library", "city-street", "light-rain", "thunderstorm", "campfire", "office", "street-cafe", "countryside-morning", "deep-sea", "city-park", "airport-terminal", "waterfall", "rain-on-tent", "whales", "home-kitchen", "bowling-alley", "record-static", "cat-purr", "copper-chimes", "rain-and-wind", "summer-meadow", "dock-waves"])
      expect(SOUNDS.find((sound) => sound.id === id), id).toBeTruthy();
    const visit = (id: string, path: string[] = []) => {
      expect(path).not.toContain(id);
      const sound = SOUNDS.find((item) => item.id === id)!;
      expect(sound).toBeTruthy();
      for (const layer of sound.layers ?? []) {
        expect(layer.volume).toBeGreaterThan(0); expect(layer.volume).toBeLessThanOrEqual(1);
        visit(layer.id, [...path, id]);
      }
    };
    SOUNDS.forEach((sound) => visit(sound.id));
    const layers = SOUNDS.map((sound) => ({ id: sound.id, volume: 0.4 }));
    expect(parseMixerData({ layers }).layers).toEqual(layers);
    expect(parseMix({ version: 1, id: "new-scenes", name: "New scenes", layers })?.layers).toEqual(layers);
  });
  const mix: SoundMix = {
    version: 1,
    id: "test",
    name: "Rainy desk",
    layers: [
      { id: "rain", volume: 0.25 },
      { id: "alpha", volume: 0.4 },
    ],
  };
  it("round-trips a named layered mix without mutating it", () => {
    expect(parseMix(serializeMix(mix))).toEqual(mix);
    const copy = parseMix(mix)!;
    copy.layers[0].volume = 0;
    expect(mix.layers[0].volume).toBe(0.25);
  });
  it.each([
    "bad json",
    "null",
    [],
    {},
    { ...mix, version: 2 },
    { ...mix, name: " " },
    { ...mix, layers: null },
  ])("rejects malformed mix %j", (input) => expect(parseMix(input)).toBeNull());
  it("drops unknown, duplicate and invalid layers and bounds volumes", () => {
    expect(
      parseLayers([
        { id: "rain", volume: 4 },
        { id: "rain", volume: 0.2 },
        { id: "brown", volume: -2 },
        { id: "fake", volume: 1 },
        { id: "pink", volume: NaN },
        null,
      ]),
    ).toEqual([
      { id: "rain", volume: 1 },
      { id: "brown", volume: 0 },
    ]);
  });
  it("validates persisted favourites and enforces the five-item limit", () => {
    const f = {
      id: "a",
      name: "Music",
      emoji: "🎵",
      url: "https://youtu.be/jfKfPfyJRdk",
    };
    const data = parseMixerData({
      layers: mix.layers,
      mixes: [null, mix],
      favourites: [
        null,
        { ...f, url: "https://evil.com" },
        ...Array.from({ length: 8 }, (_, i) => ({ ...f, id: String(i) })),
      ],
    });
    expect(data.mixes).toEqual([mix]);
    expect(data.favourites).toHaveLength(5);
    expect(data.favourites[0].url).toBe(
      "https://www.youtube.com/embed/jfKfPfyJRdk",
    );
    expect(parseMixerData(null)).toEqual({
      layers: [],
      mixes: [],
      favourites: [],
    });
  });
  it("has unique catalogue identifiers and the requested binaural frequencies", () => {
    expect(new Set(SOUNDS.map((s) => s.id)).size).toBe(SOUNDS.length);
    expect(SOUNDS.filter((s) => s.beat).map((s) => s.beat)).toEqual([
      10, 18, 40, 6, 2,
    ]);
  });
});
