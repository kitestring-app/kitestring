export const STATIONS = [
  {
    id: "claude",
    name: "Claude FM",
    glyph: "radio" as const,
    channel: "UCV03SRZXJEz-hchIAogeJOg",
    description: "A soundtrack for focused work",
  },
  {
    id: "lofi",
    name: "Lofi Girl",
    glyph: "moon" as const,
    channel: "UCSJ4gkVC6NrvII8umztf0Ow",
    // the channel runs several streams at once, so live_stream?channel= can land on one that won't play;
    // pin the long-running "lofi hip hop radio" stream instead
    video: "rFZHOHl-L8A",
    description: "lofi hip hop radio, beats to relax/study to",
  },
  {
    id: "chillhop",
    name: "Chillhop",
    glyph: "leaf" as const,
    channel: "UCOxqgCwgOqC2lMqC5PYz_Dg",
    video: "5yx6BWlEVcY", // "Chillhop Radio - jazzy & lofi hip hop beats"
    description: "Jazzy & lofi hip hop radio",
  },
] as const;

/** Pinned video when the station has one, else the channel's current live stream. Each URL must be in Chrome's URLAllowlist. */
export function stationEmbed(station: { channel: string; video?: string }): string {
  return station.video
    ? `https://www.youtube.com/embed/${encodeURIComponent(station.video)}?autoplay=1`
    : `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(station.channel)}&autoplay=1`;
}

export interface MusicEmbed {
  sourceUrl?: string; // canonical share URL when it differs from the iframe URL
  provider: "Spotify" | "Apple Music" | "Amazon Music" | "YouTube" | "SoundCloud";
  url: string;
}

// Build URLs from allowlisted hosts and resource identifiers, never arbitrary iframe markup.
export function toEmbedUrl(input: string): MusicEmbed | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port)
    return null;
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  if (host === "soundcloud.com") {
    // Public track and /sets/playlist links only. Reject query strings, fragments,
    // encoded separators, credentials and noncanonical paths rather than passing them on.
    const parts = input.trim().match(/^https:\/\/soundcloud\.com\/([A-Za-z0-9_-]+)\/(?:(sets)\/)?([A-Za-z0-9_-]+)\/?$/);
    if (!parts ||
        ["discover", "search", "you", "settings", "upload", "stream", "charts", "playlists", "stations"].includes(parts[1].toLowerCase()) ||
        (!parts[2] && ["sets", "tracks", "albums", "reposts", "likes", "popular-tracks"].includes(parts[3].toLowerCase()))) return null;
    const sourceUrl = `https://soundcloud.com/${parts[1]}/${parts[2] ? "sets/" : ""}${parts[3]}`;
    return { provider: "SoundCloud", sourceUrl, url: `https://w.soundcloud.com/player/?url=${encodeURIComponent(sourceUrl)}` };
  }
  if (host === "open.spotify.com") {
    const m = path.match(
      /^\/(?:intl-[a-z]{2}\/)?(?:embed\/)?(track|album|playlist)\/([A-Za-z0-9]{22})\/?$/,
    );
    return m
      ? {
          provider: "Spotify",
          url: `https://open.spotify.com/embed/${m[1]}/${m[2]}`,
        }
      : null;
  }
  if (host === "music.apple.com" || host === "embed.music.apple.com") {
    if (
      !/^\/[a-z]{2}\/(album|song|playlist)\/(?:[^/]+\/)?[A-Za-z0-9.-]+\/?$/.test(
        path,
      )
    )
      return null;
    const song = u.searchParams.get("i");
    if (song && !/^\d+$/.test(song)) return null;
    return {
      provider: "Apple Music",
      url: `https://embed.music.apple.com${path}${song ? `?i=${song}` : ""}`,
    };
  }
  if (
    /^music\.amazon\.(com|co\.uk|co\.jp|com\.au|com\.br|com\.mx|ca|de|fr|it|es|in)$/.test(
      host,
    )
  ) {
    const embedId = path.match(/^\/embed\/([A-Za-z0-9-]+)\/?$/)?.[1];
    const m = path.match(/^\/(albums|tracks|playlists)\/([A-Za-z0-9-]+)\/?$/);
    const id = u.searchParams.get("trackAsin") ?? embedId ?? m?.[2];
    if (!id || !/^[A-Za-z0-9-]{10,80}$/.test(id) || (!m && !embedId))
      return null;
    const params = new URLSearchParams();
    const territory = u.searchParams.get("musicTerritory");
    const marketplace = u.searchParams.get("marketplaceId");
    if (territory && /^[A-Z]{2}$/.test(territory))
      params.set("musicTerritory", territory);
    if (marketplace && /^[A-Z0-9]{10,20}$/.test(marketplace))
      params.set("marketplaceId", marketplace);
    return {
      provider: "Amazon Music",
      url: `https://${host}/embed/${id}/${params.size ? `?${params}` : ""}`,
    };
  }
  if (
    [
      "youtube.com",
      "www.youtube.com",
      "music.youtube.com",
      "m.youtube.com",
      "youtube-nocookie.com",
      "www.youtube-nocookie.com",
      "youtu.be",
    ].includes(host)
  ) {
    if (path === "/embed/live_stream") {
      const channel = u.searchParams.get("channel");
      return channel && /^UC[\w-]{22}$/.test(channel)
        ? { provider: "YouTube", url: stationEmbed({ channel }) }
        : null;
    }
    const id =
      host === "youtu.be"
        ? path.slice(1)
        : path === "/watch"
          ? u.searchParams.get("v")
          : path.match(/^\/(?:embed|shorts|live)\/([^/]+)\/?$/)?.[1];
    if (path !== "/embed/videoseries" && id && /^[\w-]{11}$/.test(id))
      return {
        provider: "YouTube",
        url: `https://www.youtube.com/embed/${id}`,
      };
    const list = u.searchParams.get("list");
    if (
      ["/playlist", "/embed/videoseries"].includes(path) &&
      list &&
      /^[\w-]{10,100}$/.test(list)
    ) {
      return {
        provider: "YouTube",
        url: `https://www.youtube.com/embed/videoseries?list=${list}`,
      };
    }
  }
  return null;
}

/** Save a validated share link when the player URL itself is not accepted as paste input. */
export function musicFavouriteUrl(input: string): string | null {
  const embed = toEmbedUrl(input);
  return embed ? embed.sourceUrl ?? embed.url : null;
}
