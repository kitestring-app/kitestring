export interface RadioStation {
  id: string;
  name: string;
  description: string;
  stream: string;
  site: string;
  cors: boolean;
  metadata?: { kind: "nightride" | "icecast"; url: string };
}

// Stream GETs verified as 200 audio/* with localhost Origin and CORS, 2026-10-24.
// Sources: https://nightride.fm, https://radioparadise.com/listen/stream-links,
// https://gamingnow.net/radio/ (player's streamurl + icecastmountpoint).
export const RADIO_STATIONS: readonly RadioStation[] = [
  ...[
    ["nightride", "Nightride", "Synthwave · Nightride FM"],
    ["chillsynth", "Chillsynth", "Chill synth · Nightride FM"],
    ["darksynth", "Darksynth", "Dark synth · Nightride FM"],
    ["spacesynth", "Spacesynth", "Space disco · Nightride FM"],
  ].map(([id, name, description]): RadioStation => ({
    id, name, description,
    stream: `https://stream.nightride.fm/${id}.mp3`,
    site: `https://nightride.fm/?station=${id}`,
    cors: true,
    metadata: { kind: "nightride", url: "https://nightride.fm/meta" },
  })),
  {
    id: "paradise-main", name: "Radio Paradise · Main Mix",
    description: "Eclectic rock, electronic & world",
    stream: "https://stream.radioparadise.com/aac-320",
    site: "https://radioparadise.com/listen/channels/main-mix", cors: true,
  },
  {
    id: "paradise-mellow", name: "Radio Paradise · Mellow Mix",
    description: "A softer, slower mix",
    stream: "https://stream.radioparadise.com/mellow-320",
    site: "https://radioparadise.com/listen/channels/mellow-mix", cors: true,
  },
  {
    id: "eve", name: "EVE Radio", description: "GamingNow · Music for gamers",
    stream: "https://media01.gamingnow.net:8010/erweb.mp3",
    site: "https://gamingnow.net/eve-radio/", cors: true,
    metadata: { kind: "icecast", url: "https://media01.gamingnow.net:8010/status-json.xsl" },
  },
];

// Radio Paradise's now_playing?chan=0 / chan=1 API returned no
// Access-Control-Allow-Origin for localhost. Do not issue blocked requests or proxy it.
export function selectRadioStations(query: string, pinned: readonly string[]): RadioStation[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return RADIO_STATIONS.filter((s) => {
    const text = `${s.name} ${s.description}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  }).sort((a, b) => Number(pinned.includes(b.id)) - Number(pinned.includes(a.id)));
}

export interface RadioPreferences { pinned: string[]; lastStation: string; volume: number }
export const INITIAL_RADIO: RadioPreferences = { pinned: [], lastStation: "nightride", volume: 0.5 };

export function radioVolume(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;
}

export function restoreRadio(value: unknown): RadioPreferences {
  const saved = record(value);
  const valid = (id: unknown): id is string => typeof id === "string" && RADIO_STATIONS.some((s) => s.id === id);
  return {
    pinned: Array.isArray(saved?.pinned) ? [...new Set(saved.pinned.filter(valid))] : [],
    lastStation: valid(saved?.lastStation) ? saved.lastStation : INITIAL_RADIO.lastStation,
    volume: radioVolume(saved?.volume),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function parse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}
function text(value: unknown): string { return typeof value === "string" ? value.trim().slice(0, 300) : ""; }
function track(value: unknown): string | null {
  const row = record(value);
  const artist = text(row?.artist), title = text(row?.title);
  return artist && title ? `${artist} — ${title}` : null;
}

// EventSource supplies the JSON inside `data:`, one array containing station updates.
export function parseNightride(value: unknown, station: string): string | null {
  const rows = parse(value);
  if (!Array.isArray(rows)) return null;
  return track(rows.find((row) => record(row)?.station === station));
}

export function parseParadise(value: unknown): string | null { return track(parse(value)); }

export function parseIcecast(value: unknown, stream: string): string | null {
  const sources = record(record(parse(value))?.icestats)?.source;
  const rows = Array.isArray(sources) ? sources : [sources];
  const row = rows.find((v) => {
    const url = record(v)?.listenurl;
    try { return typeof url === "string" && new URL(url).pathname === new URL(stream).pathname; }
    catch { return false; }
  });
  const title = text(record(row)?.title);
  return title ? title.replace(" - ", " — ") : null;
}
