// Writes every sound/phase WAV using the same samples as page previews.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALERT_KINDS, ALERT_SOUNDS, renderSelectedAlert, toWav } from "../src/audio/alertSynth.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(root, "public/alerts");
mkdirSync(dir, { recursive: true });
for (const sound of ALERT_SOUNDS) {
  for (const kind of ALERT_KINDS) {
    const wav = toWav(renderSelectedAlert(sound, kind));
    writeFileSync(resolve(dir, `${sound}-${kind}.wav`), wav);
    console.log(`${sound}-${kind}.wav ${(wav.length / 1024).toFixed(0)} KB`);
  }
}
