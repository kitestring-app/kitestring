import type { GlyphName } from "../ui/glyphs.data";
export const CATEGORIES = [
  "All",
  "Noise",
  "Nature",
  "Places",
  "Binaural",
  "Machines",
] as const;
export type SoundCategory = Exclude<(typeof CATEGORIES)[number], "All">;
export interface SoundDefinition {
  id: string;
  name: string;
  /** Line icon shown on the tile. */
  glyph: GlyphName;
  category: SoundCategory;
  file?: string;
  beat?: number;
  layers?: readonly MixLayer[]; // Original scenes built from existing local voices.
}

export const SOUNDS: readonly SoundDefinition[] = [
  { id: "white", name: "White noise", glyph: "circle", category: "Noise" },
  { id: "pink", name: "Pink noise", glyph: "flower-2", category: "Noise" },
  { id: "brown", name: "Brown noise", glyph: "bean", category: "Noise" },
  { id: "pulse", name: "Pink + 16 Hz pulse", glyph: "audio-waveform", category: "Noise" },
  {
    id: "alpha",
    name: "Alpha · 10 Hz",
    glyph: "brain",
    category: "Binaural",
    beat: 10,
  },
  {
    id: "beta",
    name: "Beta · 18 Hz",
    glyph: "zap",
    category: "Binaural",
    beat: 18,
  },
  {
    id: "gamma",
    name: "Gamma · 40 Hz",
    glyph: "activity",
    category: "Binaural",
    beat: 40,
  },
  {
    id: "theta",
    name: "Theta · 6 Hz",
    glyph: "moon",
    category: "Binaural",
    beat: 6,
  },
  {
    id: "delta",
    name: "Delta · 2 Hz",
    glyph: "bed",
    category: "Binaural",
    beat: 2,
  },
  { id: "rain", name: "Rain", glyph: "cloud-rain", category: "Nature" },
  { id: "heavy-rain", name: "Heavy rain", glyph: "cloud-lightning", category: "Nature" },
  { id: "wind", name: "Wind", glyph: "wind", category: "Nature" },
  { id: "ocean", name: "Ocean", glyph: "waves", category: "Nature" },
  { id: "fireplace", name: "Fireplace", glyph: "flame", category: "Nature" },
  { id: "underwater", name: "Underwater", glyph: "droplet", category: "Nature" },
  { id: "space", name: "Outer space rumble", glyph: "orbit", category: "Places" },
  { id: "fan", name: "Room fan", glyph: "fan", category: "Machines" },
  { id: "ac", name: "Air conditioner", glyph: "snowflake", category: "Machines" },
  { id: "clock", name: "Clock ticking", glyph: "clock", category: "Machines" },
  {
    id: "keyboard",
    name: "Keyboard typing",
    glyph: "keyboard",
    category: "Machines",
  },
  { id: "train", name: "Train", glyph: "train-front", category: "Places" },
  {
    id: "cafe",
    name: "Café",
    glyph: "coffee",
    category: "Places",
    file: "cafe.ogg",
  },
  {
    id: "birds",
    name: "Birds",
    glyph: "bird",
    category: "Nature",
    file: "birds.ogg",
  },
  {
    id: "crickets",
    name: "Night crickets",
    glyph: "bug",
    category: "Nature",
    file: "crickets.ogg",
  },
  {
    id: "stream",
    name: "Stream",
    glyph: "mountain",
    category: "Nature",
    file: "stream.ogg",
  },
  { id: "airplane-cabin", name: "Airplane cabin", glyph: "plane", category: "Places" },
  { id: "exam-hall", name: "Exam hall", glyph: "pencil", category: "Places" },
  { id: "library", name: "Library", glyph: "library", category: "Places", file: "library.ogg" },
  { id: "city-street", name: "City street", glyph: "building-2", category: "Places", file: "city-street.ogg" },
  { id: "light-rain", name: "Light rain", glyph: "cloud-drizzle", category: "Nature" },
  { id: "thunderstorm", name: "Thunderstorm", glyph: "cloud-lightning", category: "Nature" },
  { id: "campfire", name: "Campfire", glyph: "tent", category: "Nature" },
  { id: "office", name: "Office", glyph: "monitor", category: "Places", file: "office.ogg" },
  { id: "street-cafe", name: "Street café", glyph: "croissant", category: "Places", layers: [{ id: "cafe", volume: 0.65 }, { id: "city-street", volume: 0.25 }] },
  { id: "countryside-morning", name: "Countryside morning", glyph: "sunrise", category: "Nature", layers: [{ id: "birds", volume: 0.6 }, { id: "wind", volume: 0.3 }] },
  { id: "deep-sea", name: "Deep sea", glyph: "anchor", category: "Nature", layers: [{ id: "underwater", volume: 0.6 }, { id: "whales", volume: 0.3 }] },
  { id: "city-park", name: "City park", glyph: "trees", category: "Places", layers: [{ id: "birds", volume: 0.55 }, { id: "city-street", volume: 0.15 }] },
  { id: "airport-terminal", name: "Airport terminal", glyph: "plane-takeoff", category: "Places", file: "airport-terminal.ogg" },
  { id: "waterfall", name: "Waterfall", glyph: "droplets", category: "Nature" },
  { id: "rain-on-tent", name: "Rain on a tent", glyph: "cloud-sun-rain", category: "Nature" },
  { id: "whales", name: "Whales", glyph: "fish", category: "Nature", file: "whales.ogg" },
  { id: "home-kitchen", name: "Home kitchen", glyph: "cooking-pot", category: "Places", file: "home-kitchen.ogg" },
  { id: "bowling-alley", name: "Bowling alley", glyph: "target", category: "Places", file: "bowling-alley.ogg" },
  { id: "record-static", name: "Record static", glyph: "disc-3", category: "Machines" },
  { id: "cat-purr", name: "Purring cat", glyph: "cat", category: "Nature", file: "cat-purr.ogg" },
  { id: "copper-chimes", name: "Copper chimes", glyph: "bell", category: "Machines" },
  { id: "rain-and-wind", name: "Rain and wind", glyph: "tornado", category: "Nature", layers: [{ id: "rain", volume: 0.65 }, { id: "wind", volume: 0.4 }] },
  { id: "summer-meadow", name: "Summer meadow", glyph: "wheat", category: "Nature", layers: [{ id: "birds", volume: 0.45 }, { id: "crickets", volume: 0.25 }, { id: "wind", volume: 0.2 }] },
  { id: "dock-waves", name: "Waves at a dock", glyph: "sailboat", category: "Nature", layers: [{ id: "ocean", volume: 0.65 }, { id: "stream", volume: 0.2 }] },
];

export interface MixLayer {
  id: string;
  volume: number;
}
export interface SoundMix {
  version: 1;
  id: string;
  name: string;
  layers: MixLayer[];
}
export const FOCUS_PRESETS = [
  {
    name: "Deep focus",
    layers: [
      { id: "brown", volume: 0.45 },
      { id: "rain", volume: 0.25 },
    ],
  },
  {
    name: "Quiet café",
    layers: [
      { id: "cafe", volume: 0.35 },
      { id: "pink", volume: 0.15 },
    ],
  },
  {
    name: "Night train",
    layers: [
      { id: "train", volume: 0.4 },
      { id: "crickets", volume: 0.2 },
    ],
  },
];

export function clampVolume(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

export function parseLayers(input: unknown): MixLayer[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input.flatMap((l: unknown) => {
    if (
      !l ||
      typeof l !== "object" ||
      !("id" in l) ||
      !("volume" in l) ||
      typeof l.id !== "string" ||
      typeof l.volume !== "number" ||
      !Number.isFinite(l.volume) ||
      seen.has(l.id) ||
      !SOUNDS.some((s) => s.id === l.id)
    )
      return [];
    seen.add(l.id);
    return [{ id: l.id, volume: clampVolume(l.volume) }];
  });
}

export function parseMix(input: unknown): SoundMix | null {
  try {
    const m =
      typeof input === "string" ? (JSON.parse(input) as unknown) : input;
    if (
      !m ||
      typeof m !== "object" ||
      !("version" in m) ||
      m.version !== 1 ||
      !("id" in m) ||
      typeof m.id !== "string" ||
      !m.id.trim() ||
      !("name" in m) ||
      typeof m.name !== "string" ||
      !m.name.trim() ||
      !("layers" in m) ||
      !Array.isArray(m.layers)
    )
      return null;
    return {
      version: 1,
      id: m.id.slice(0, 80),
      name: m.name.trim().slice(0, 60),
      layers: parseLayers(m.layers),
    };
  } catch {
    return null;
  }
}

export function serializeMix(mix: SoundMix): string {
  const parsed = parseMix(mix);
  if (!parsed) throw new Error("Invalid mix");
  return JSON.stringify(parsed);
}
