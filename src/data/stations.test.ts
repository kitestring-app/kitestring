import { describe, expect, it } from "vitest";
import { STATIONS, stationEmbed, toEmbedUrl } from "./stations";

describe("official music embeds", () => {
  const spotify = "37i9dQZF1DXcBWIGoYBM5M";
  it.each(["track", "album", "playlist"])(
    "converts Spotify %s links and strips tracking",
    (type) => {
      expect(
        toEmbedUrl(`https://open.spotify.com/${type}/${spotify}?si=tracking`)
          ?.url,
      ).toBe(`https://open.spotify.com/embed/${type}/${spotify}`);
      expect(
        toEmbedUrl(`https://open.spotify.com/intl-en/${type}/${spotify}`)
          ?.provider,
      ).toBe("Spotify");
    },
  );
  it.each([
    [
      "https://music.apple.com/us/album/example/12345?i=67890&ls=1",
      "https://embed.music.apple.com/us/album/example/12345?i=67890",
    ],
    [
      "https://music.apple.com/in/playlist/lofi/pl.1234",
      "https://embed.music.apple.com/in/playlist/lofi/pl.1234",
    ],
    [
      "https://music.apple.com/us/song/12345",
      "https://embed.music.apple.com/us/song/12345",
    ],
    [
      "https://music.amazon.com/albums/B012345678?trackAsin=B098765432&ref=dm",
      "https://music.amazon.com/embed/B098765432/",
    ],
    [
      "https://music.amazon.in/playlists/B012345678",
      "https://music.amazon.in/embed/B012345678/",
    ],
    [
      "https://music.amazon.com/albums/B012345678?marketplaceId=ATVPDKIKX0DER&musicTerritory=US&ref=tracking",
      "https://music.amazon.com/embed/B012345678/?musicTerritory=US&marketplaceId=ATVPDKIKX0DER",
    ],
    [
      "https://youtu.be/jfKfPfyJRdk?si=tracking",
      "https://www.youtube.com/embed/jfKfPfyJRdk",
    ],
    [
      "https://www.youtube.com/watch?v=jfKfPfyJRdk&t=23",
      "https://www.youtube.com/embed/jfKfPfyJRdk",
    ],
    [
      "https://www.youtube.com/live/jfKfPfyJRdk",
      "https://www.youtube.com/embed/jfKfPfyJRdk",
    ],
    [
      "https://www.youtube.com/playlist?list=PL12345678901234",
      "https://www.youtube.com/embed/videoseries?list=PL12345678901234",
    ],
  ])("converts %s", (input, expected) => {
    const converted = toEmbedUrl(input);
    expect(converted?.url).toBe(expected);
    expect(toEmbedUrl(expected)).toEqual(converted);
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,bad",
    "https://youtube.com.evil.com/watch?v=jfKfPfyJRdk",
    "https://open.spotify.com@evil.com/playlist/123",
    "https://evil.com/",
    "http://youtu.be/jfKfPfyJRdk",
    "https://youtu.be/bad",
    "https://music.amazon.com.evil.com/albums/B012345678",
    "https://music.apple.com/us/search",
    "https://open.spotify.com/embed/playlist/bad",
    "https://music.amazon.com/search?trackAsin=B012345678",
    "https://youtube.com:444/watch?v=jfKfPfyJRdk",
    "https://www.youtube.com/embed/live_stream",
    "<iframe src='https://evil.com'></iframe>",
  ])("rejects unsafe or unsupported input: %s", (input) =>
    expect(toEmbedUrl(input)).toBeNull(),
  );
  it("embeds exactly the assigned station channels", () => {
    expect(STATIONS.map((s) => s.channel)).toEqual([
      "UCV03SRZXJEz-hchIAogeJOg",
      "UCSJ4gkVC6NrvII8umztf0Ow",
      "UCOxqgCwgOqC2lMqC5PYz_Dg",
    ]);
    expect(stationEmbed(STATIONS[0])).toBe(
      `https://www.youtube.com/embed/live_stream?channel=${STATIONS[0].channel}&autoplay=1`,
    );
    for (const station of STATIONS) {
      const id = "video" in station ? station.video : station.channel;
      expect(stationEmbed(station)).toContain(id);
      // pasting a station link into My Music resolves to the same stream
      expect(toEmbedUrl(stationEmbed(station))?.url).toContain(id);
    }
  });
});

it('accepts YouTube Music track share links as regular YouTube embeds', () => {
  expect(toEmbedUrl('https://music.youtube.com/watch?v=5yx6BWlEVcY&si=tracking')).toEqual({
    provider: 'YouTube', url: 'https://www.youtube.com/embed/5yx6BWlEVcY',
  });
  expect(toEmbedUrl('https://music.youtube.com.evil.test/watch?v=5yx6BWlEVcY')).toBeNull();
});
