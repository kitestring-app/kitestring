const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync, mkdtempSync, rmSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { inflateSync } = require('node:zlib');
const { tmpdir } = require('node:os');
const path = require('node:path');
const root = path.join(__dirname, '..', '..');
const read = file => readFileSync(path.join(root, file));
function pngSize(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}
test('web icon artwork matches the selected masters and every linked icon has the expected size', () => {
  assert.deepEqual(read('public/icon.svg'), read('brand/app.svg'));
  assert.deepEqual(read('public/favicon.svg'), read('brand/favicon.svg'));
  for (const [file, size] of [['icon-32.png', 32], ['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512], ['apple-touch-icon.png', 180]]) {
    assert.deepEqual(pngSize(read(`public/${file}`)), [size, size]);
  }
  const html = read('index.html').toString();
  const icons = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="\/([^"]+)"/g)];
  assert.ok(icons.some(match => match[1] === 'favicon.svg'));
  for (const match of icons) assert.ok(read(`public/${match[1]}`).length);
  const ico = read('public/favicon.ico');
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  assert.deepEqual([6, 22, 38].map(offset => [ico[offset], ico[offset + 1]]), [[16, 16], [32, 32], [48, 48]]);
});
// Decode the exported PNG pixels, not just embedded PNG headers. In particular,
// PNG bytes written to ICNS's small ARGB slots pass a header-only check.
function decodePng(bytes) {
  const [width, height] = pngSize(bytes);
  assert.equal(bytes[24], 8, '8-bit PNG');
  assert.equal(bytes[28], 0, 'non-interlaced PNG');
  const channels = { 2: 3, 6: 4 }[bytes[25]];
  assert.ok(channels, `Unsupported PNG colour type ${bytes[25]}`);
  const compressed = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(compressed));
  const stride = width * channels;
  assert.equal(raw.length, height * (stride + 1));
  const pixels = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const distances = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
    return distances[0] <= distances[1] && distances[0] <= distances[2] ? a : distances[1] <= distances[2] ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4, `Valid PNG row filter: ${filter}`);
    for (let x = 0; x < stride; x++) {
      const offset = y * stride + x;
      const left = x >= channels ? pixels[offset - channels] : 0;
      const above = y ? pixels[offset - stride] : 0;
      const upperLeft = y && x >= channels ? pixels[offset - stride - channels] : 0;
      const predictors = [0, left, above, Math.floor((left + above) / 2), paeth(left, above, upperLeft)];
      pixels[offset] = (raw[y * (stride + 1) + 1 + x] + predictors[filter]) & 255;
    }
  }
  return { width, height, pixel: (x, y) => {
    const offset = (y * width + x) * channels;
    return [...pixels.subarray(offset, offset + 3), channels === 4 ? pixels[offset + 3] : 255];
  } };
}
function assertKitestring(bytes, label) {
  const { width, height, pixel } = decodePng(bytes);
  let alpha = 0;
  let plum = 0;
  let warm = 0;
  let line = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      alpha += a / 255;
      if (a > 230 && b > r && r >= g && b < 130) plum++;
      if (a > 200 && r > 170 && g > 80 && b < 180) warm++;
      if (a > 128 && r > 70 && g > 65 && b > r && b > 100) line++;
    }
  }
  const area = width * height;
  assert.ok(alpha / area > 0.55 && alpha / area < 0.8, `${label}: squircle alpha coverage (${alpha / area})`);
  assert.ok(plum / area > 0.35, `${label}: dominant plum background (${plum / area})`);
  assert.ok(warm / area > 0.025 && warm / area < 0.15, `${label}: visible warm kite (${warm / area})`);
  assert.ok(line / area > 0.001 && line / area < 0.06, `${label}: visible curved line (${line / area})`);
  for (const [u, v] of [[0.23, 0.23], [0.77, 0.23], [0.23, 0.77], [0.77, 0.77]]) {
    const [r, g, b, a] = pixel(Math.floor(u * (width - 1)), Math.floor(v * (height - 1)));
    assert.ok(a > 230 && b > r && r >= g && b < 130, `${label}: plum interior corner at ${u},${v}`);
  }
}
test('every ICNS representation decodes through Apple iconutil with the Kitestring artwork', { skip: process.platform !== 'darwin' }, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'kitestring-icons-'));
  const iconset = path.join(directory, 'decoded.iconset');
  try {
    execFileSync('/usr/bin/iconutil', ['-c', 'iconset', path.join(root, 'desktop/build/icon.icns'), '-o', iconset]);
    const files = readdirSync(iconset).filter(file => file.endsWith('.png'));
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const file = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
        assert.ok(files.includes(file), `Missing ${file}`);
        assert.deepEqual(pngSize(readFileSync(path.join(iconset, file))), [size * scale, size * scale]);
      }
    }
    // Include every exported slot, even unexpected/optional legacy sizes.
    for (const file of files) assertKitestring(readFileSync(path.join(iconset, file)), file);
    assert.deepEqual(pngSize(read('desktop/build/icon.png')), [1024, 1024]);
    assertKitestring(read('desktop/build/icon.png'), '1024px master');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('Icon Composer bundle uses solid-colour kite and line layers that macOS can render', () => {
  const icon = JSON.parse(read('desktop/build/Kitestring.icon/icon.json'));
  const layers = icon.groups.flatMap(group => group.layers);
  assert.deepEqual(layers.map(layer => layer.name), ['Kite left', 'Kite right', 'Line'], 'kite halves are listed above the line');
  for (const layer of layers) {
    const source = read(`desktop/build/Kitestring.icon/Assets/${layer['image-name']}`).toString();
    assert.match(source, /viewBox="0 0 1024 1024"/);
    // macOS drops url(#...) gradients in icon layers; that blanked the Dock icon.
    assert.doesNotMatch(source, /url\(#|<defs|Gradient/, `${layer['image-name']} must use solid colours`);
  }
  assert.match(read('desktop/build/Kitestring.icon/Assets/kite-left.svg').toString(), /fill="#F29E7C"/);
  assert.match(read('desktop/build/Kitestring.icon/Assets/kite-right.svg').toString(), /fill="#F7CF7E"/);
  assert.match(read('desktop/build/Kitestring.icon/Assets/line.svg').toString(), /stroke="#E7E2FF"/);
  assert.ok(!('color-space-for-untagged-svg-colors' in icon), 'actool rejects this key');
  const dark = icon['fill-specializations'].find(entry => entry.appearance === 'dark');
  assert.ok(dark?.value?.['linear-gradient'], 'Dark style keeps the plum body');
  const config = JSON.parse(read('desktop/package.json'));
  assert.equal(config.build.mac.icon, 'build/Kitestring.icon');
  assert.ok(config.build.extraResources.some(entry => entry.from === 'build/icon.icns' && entry.to === 'icon.icns'));
  assert.doesNotMatch(config.scripts.dist, /build:icon/, 'artwork builder stays on-demand');
});
test('tray icons have transparent RGBA pixels at 18px and 36px', () => {
  for (const [file, size] of [['trayTemplate.png', 18], ['trayTemplate@2x.png', 36]]) {
    const png = read(`desktop/build/${file}`);
    assert.deepEqual(pngSize(png), [size, size]);
    assert.equal(png[25], 6, 'RGBA image retains the transparent background');
  }
});
