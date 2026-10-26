const CHANNELS = new Set([
  'UCV03SRZXJEz-hchIAogeJOg',
  'UCSJ4gkVC6NrvII8umztf0Ow',
  'UCOxqgCwgOqC2lMqC5PYz_Dg',
]);
const OPTIONAL_KEYS = new Set(['autoplay', 'start', 'rel', 'mute', 'modestbranding', 'playsinline', 'origin']);
const VIDEOS = new Set(['jfKfPfyJRdk', 'rFZHOHl-L8A', '5yx6BWlEVcY']);
const inDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);

function shouldBlockYouTube(url, resourceType) {
  if (resourceType !== 'mainFrame' && resourceType !== 'subFrame') return false;
  let parsed;
  try { parsed = new URL(url); } catch { return true; }
  const host = parsed.hostname;
  if (!['youtube.com', 'youtube-nocookie.com', 'youtu.be'].some((domain) => inDomain(host, domain))) return false;
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return true;
  if (host === 'music.youtube.com') return false;
  if (host !== 'youtube.com' && host !== 'www.youtube.com') return true;
  if (parsed.pathname === '/embed/live_stream') {
    const channels = parsed.searchParams.getAll('channel');
    return channels.length !== 1 || !CHANNELS.has(channels[0])
      || [...parsed.searchParams.keys()].some((key) => key !== 'channel' && !OPTIONAL_KEYS.has(key));
  }
  const video = parsed.pathname.match(/^\/embed\/([\w-]+)$/)?.[1];
  return !VIDEOS.has(video) || [...parsed.searchParams.keys()].some((key) => !OPTIONAL_KEYS.has(key));
}

// YouTube requires HTTPS client identity even for a bundled desktop page.
// Use the installed bundle ID, per its embedded-player identity documentation.
// Keep this separate from frame filtering: no other requests gain a referrer.
function youtubeEmbedHeaders(details) {
  const headers = details.requestHeaders;
  if (details.resourceType !== 'subFrame' || details.initiatorOrigin !== 'app://custom-pomodoro'
    || shouldBlockYouTube(details.url, 'subFrame')) return headers;
  const url = new URL(details.url);
  if (!['youtube.com', 'www.youtube.com'].includes(url.hostname) || !url.pathname.startsWith('/embed/')) return headers;
  return { ...Object.fromEntries(Object.entries(headers).filter(([key]) => key.toLowerCase() !== 'referer')),
    Referer: 'https://local.custom-pomodoro.desktop/' };
}

module.exports = { shouldBlockYouTube, youtubeEmbedHeaders };
