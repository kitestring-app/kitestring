const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldBlockYouTube: block } = require('../youtube-policy.cjs');

for (const resourceType of ['mainFrame', 'subFrame']) {
  test(`${resourceType}: allows only the selected YouTube embeds and Music`, () => {
    for (const host of ['youtube.com', 'www.youtube.com']) {
      for (const channel of ['UCV03SRZXJEz-hchIAogeJOg', 'UCSJ4gkVC6NrvII8umztf0Ow', 'UCOxqgCwgOqC2lMqC5PYz_Dg']) {
        assert.equal(block(`https://${host}/embed/live_stream?channel=${channel}&autoplay=1`, resourceType), false);
      }
      for (const video of ['jfKfPfyJRdk', 'rFZHOHl-L8A', '5yx6BWlEVcY']) {
        assert.equal(block(`https://${host}/embed/${video}?autoplay=1`, resourceType), false);
      }
    }
    assert.equal(block('https://music.youtube.com/watch?v=anything', resourceType), false);
  });
  test(`${resourceType}: blocks browsing, alternate hosts, malformed and ambiguous URLs`, () => {
    for (const url of [
      'https://youtube.com/', 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
      'https://www.youtube.com/shorts/jfKfPfyJRdk', 'https://youtu.be/jfKfPfyJRdk',
      'https://www.youtube-nocookie.com/embed/jfKfPfyJRdk', 'https://youtube-nocookie.com/',
      'https://m.youtube.com/embed/jfKfPfyJRdk', 'https://evil.youtube.com/embed/jfKfPfyJRdk',
      'https://www.youtube.com/embed/unknown', 'https://www.youtube.com/embed/jfKfPfyJRdk/extra',
      'https://www.youtube.com/embed/live_stream', 'https://www.youtube.com/embed/live_stream?channel=other',
      'https://www.youtube.com/embed/live_stream?channel=UCV03SRZXJEz-hchIAogeJOg&channel=other',
      'https://www.youtube.com/embed/%6afKfPfyJRdk', 'https://www.youtube.com:444/embed/jfKfPfyJRdk',
      'https://' + 'user:pass@youtube.com/embed/jfKfPfyJRdk', 'http://youtube.com/embed/jfKfPfyJRdk',
      'http://music.youtube.com/', 'https://music.youtube.com:444/', 'not a URL',
    ]) assert.equal(block(url, resourceType), true, url);
  });
}
test('does not block player resources or unrelated providers', () => {
  for (const type of ['script', 'xhr', 'image', 'media', 'other']) assert.equal(block('https://youtube.com/api/player', type), false);
  for (const url of ['https://open.spotify.com/embed/track/abc', 'https://youtube.com.evil.test/', 'app://custom-pomodoro/']) assert.equal(block(url, 'subFrame'), false);
});

for (const resourceType of ['mainFrame', 'subFrame']) {
  test(`${resourceType}: rejects all four reviewed query bypasses`, () => {
    for (const url of [
      'https://www.youtube.com/embed/jfKfPfyJRdk?playlist=dQw4w9WgXcQ',
      'https://www.youtube.com/embed/jfKfPfyJRdk?list=PLabcdefghij&listType=playlist',
      'https://www.youtube.com/embed/jfKfPfyJRdk?enablejsapi=1',
      'https://www.youtube.com/embed/live_stream?channel=UCV03SRZXJEz-hchIAogeJOg&playlist=dQw4w9WgXcQ',
    ]) assert.equal(block(url, resourceType), true, url);
  });
  test(`${resourceType}: accepts only the listed optional query keys`, () => {
    for (const base of [
      'https://www.youtube.com/embed/jfKfPfyJRdk?',
      'https://www.youtube.com/embed/5yx6BWlEVcY?',
      'https://www.youtube.com/embed/live_stream?channel=UCV03SRZXJEz-hchIAogeJOg&',
    ]) {
      assert.equal(block(base + 'autoplay=1&start=30&rel=0&mute=1&modestbranding=1&playsinline=1&origin=app%3A%2F%2Fcustom-pomodoro', resourceType), false);
      for (const key of ['playlist', 'list', 'listType', 'enablejsapi', 'loop', 'unknown', 'Autoplay', '%70laylist']) {
        assert.equal(block(base + `${key}=1`, resourceType), true, base + key);
      }
    }
    assert.equal(block('https://www.youtube.com/embed/jfKfPfyJRdk?channel=UCV03SRZXJEz-hchIAogeJOg', resourceType), true);
    assert.equal(block('https://www.youtube.com/embed/live_stream?channel=UCV03SRZXJEz-hchIAogeJOg&channel=UCV03SRZXJEz-hchIAogeJOg', resourceType), true);
  });
}

test('the actual stationEmbed URLs from the read-only dashboard source still pass', () => {
  const { readFileSync } = require('node:fs');
  const { stripTypeScriptTypes } = require('node:module');
  const vm = require('node:vm');
  const source = readFileSync(require('node:path').join(__dirname, '../../src/data/stations.ts'), 'utf8');
  const js = stripTypeScriptTypes(source).replace(/export /g, '');
  const urls = vm.runInNewContext(js + '; STATIONS.map(stationEmbed)');
  assert.equal(urls.length, 3);
  for (const url of urls) assert.equal(block(url, 'subFrame'), false, url);
});

test('identifies allowed embeds from the app without changing other requests', () => {
  const { youtubeEmbedHeaders } = require('../youtube-policy.cjs');
  const details = { resourceType: 'subFrame', initiatorOrigin: 'app://custom-pomodoro',
    url: 'https://www.youtube.com/embed/jfKfPfyJRdk?autoplay=1', requestHeaders: { Accept: '*/*', referer: 'app://custom-pomodoro/' } };
  const headers = youtubeEmbedHeaders(details);
  assert.deepEqual(headers, { Accept: '*/*', Referer: 'https://local.custom-pomodoro.desktop/' });
  assert.equal(details.requestHeaders.referer, 'app://custom-pomodoro/');
  for (const change of [
    { resourceType: 'mainFrame' }, { resourceType: 'xhr' }, { initiatorOrigin: 'https://www.youtube.com' },
    { initiatorOrigin: undefined }, { url: 'https://music.youtube.com/' },
    { url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk' },
    { url: 'https://www.youtube.com/embed/unknown' },
    { url: 'https://www.youtube.com/embed/jfKfPfyJRdk?playlist=other' },
    { url: 'https://www.youtube.com.evil.test/embed/jfKfPfyJRdk' },
  ]) assert.equal(youtubeEmbedHeaders({ ...details, ...change }), details.requestHeaders);
});
