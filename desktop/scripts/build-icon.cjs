// Original Kitestring artwork. On-demand only: librsvg, ImageMagick and Apple iconutil.
const { execFileSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, rmSync, copyFileSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const root = path.join(__dirname, '..', '..');
const build = path.join(root, 'desktop', 'build');
const web = path.join(root, 'public');
const masters = path.join(root, 'brand');
const temporary = mkdtempSync(path.join(tmpdir(), 'kitestring-icon-'));
const iconset = path.join(temporary, 'icon.iconset');
function render(source, output, size) {
  execFileSync('rsvg-convert', ['--width', String(size), '--height', String(size), '--output', output, source]);
}
mkdirSync(iconset, { recursive: true });
try {
  const app = path.join(masters, 'app.svg');
  const favicon = path.join(masters, 'favicon.svg');
  const tray = path.join(masters, 'tray.svg');
  copyFileSync(app, path.join(web, 'icon.svg'));
  copyFileSync(favicon, path.join(web, 'favicon.svg'));
  render(app, path.join(build, 'icon.png'), 1024);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      render(app, path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`), size * scale);
    }
  }
  // Apple owns the small-slot ARGB encoding. PNG payloads in those slots
  // can look valid to a PNG reader but decode as noise in macOS.
  buildLayeredIcon();
  execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(temporary, 'icon.icns')]);
  copyFileSync(path.join(temporary, 'icon.icns'), path.join(build, 'icon.icns'));
  for (const scale of [1, 2]) render(tray, path.join(build, `trayTemplate${scale === 2 ? '@2x' : ''}.png`), 18 * scale);
  render(favicon, path.join(web, 'icon-32.png'), 32);
  for (const size of [192, 512]) render(app, path.join(web, `icon-${size}.png`), size);
  render(app, path.join(web, 'apple-touch-icon.png'), 180);
  // The complete mark fits within the central 80% maskable safe zone.
  const padded = path.join(temporary, 'maskable.svg');
  const artwork = readFileSync(app, 'utf8').replace(/<svg[^>]*>/, '').replace('</svg>', '');
  writeFileSync(padded, `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#121124"/><g transform="translate(102.4 102.4) scale(.8)">${artwork}</g></svg>`);
  render(padded, path.join(web, 'icon-maskable-512.png'), 512);
  const card = path.join(temporary, 'og.png');
  execFileSync('rsvg-convert', ['--output', card, path.join(root, 'design/og/og-card.svg')]);
  execFileSync('magick', [card, '-quality', '92', path.join(web, 'og.jpg')]);

  const icoInputs = [16, 32, 48].map(size => {
    const file = path.join(iconset, `favicon-${size}.png`);
    render(favicon, file, size);
    return file;
  });
  execFileSync('magick', [...icoInputs, path.join(web, 'favicon.ico')]);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function buildLayeredIcon() {
  // Icon Composer layers must be plain solid shapes. macOS (checked on 26/27)
  // drops gradient fills and strokes that use url(#...), which left the Dock
  // and Raycast showing an empty square. The system adds the glass, shadow
  // and squircle itself, so the layers stay flat and simple.
  const bundle = path.join(build, 'Kitestring.icon');
  const assets = path.join(bundle, 'Assets');
  rmSync(assets, { recursive: true, force: true });
  mkdirSync(assets, { recursive: true });
  const canvas = content => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${content}</svg>\n`;
  writeFileSync(path.join(assets, 'kite-left.svg'), canvas('<path d="M512 196 L340 404 L512 612 Z" fill="#F29E7C"/>'));
  writeFileSync(path.join(assets, 'kite-right.svg'), canvas('<path d="M512 196 L684 404 L512 612 Z" fill="#F7CF7E"/>'));
  writeFileSync(path.join(assets, 'line.svg'), canvas('<path d="M512 612 C512 690 446 700 446 760 C446 822 532 830 560 782" fill="none" stroke="#E7E2FF" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>'));
  const plum = { 'linear-gradient': ['srgb:0.21961,0.18824,0.26667,1.00000', 'srgb:0.07843,0.07059,0.10980,1.00000'] };
  const group = (name, file) => ({
    name,
    layers: [{ 'image-name': file, name }],
    shadow: { kind: 'neutral', opacity: 0.5 },
    translucency: { enabled: true, value: 0.3 },
  });
  const icon = {
    // Keep the plum body in the Dark icon style instead of the system black.
    'fill-specializations': [{ value: plum }, { appearance: 'dark', value: plum }],
    // Kite halves are above their solid curved line.
    groups: [group('Kite left', 'kite-left.svg'), group('Kite right', 'kite-right.svg'), group('Line', 'line.svg')],
    'supported-platforms': { squares: 'shared' },
  };
  writeFileSync(path.join(bundle, 'icon.json'), `${JSON.stringify(icon, null, 2)}\n`);
}
