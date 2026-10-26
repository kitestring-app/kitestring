import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { ALERT_KINDS, ALERT_SAMPLE_RATE, ALERT_SOUNDS, renderAlert, renderSelectedAlert, toWav } from "./alertSynth";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../state/settings";

it("keeps generated choices aligned with the settings contract", () => {
  for (const alertSound of ALERT_SOUNDS) {
    expect(sanitizeSettings({ timer: { ...DEFAULT_SETTINGS.timer, alertSound } }).timer.alertSound).toBe(alertSound);
  }
});

it.each(ALERT_SOUNDS)("ships both %s phase WAVs from exactly the preview samples", (sound) => {
  for (const kind of ALERT_KINDS) {
    const samples = renderSelectedAlert(sound, kind);
    const wav = toWav(samples);
    const shipped = readFileSync(new URL(`../../public/alerts/${sound}-${kind}.wav`, import.meta.url));
    expect(Buffer.from(wav).equals(shipped)).toBe(true);
    expect(shipped.toString("ascii", 0, 4)).toBe("RIFF");
    expect(shipped.readUInt32LE(24)).toBe(ALERT_SAMPLE_RATE);
    expect(shipped.readUInt32LE(40)).toBe(samples.length * 2);
    let peak = 0;
    for (const sample of samples) {
      expect(Number.isFinite(sample)).toBe(true);
      peak = Math.max(peak, Math.abs(sample));
    }
    expect(peak).toBeLessThanOrEqual(1);
    expect(peak > 0).toBe(sound !== "none");
    if (sound === "signature") expect(samples).toEqual(renderAlert(kind));
  }
});

it("retains distinct signature phases and distinct selectable voices", () => {
  expect(toWav(renderSelectedAlert("signature", "focus-done"))).not.toEqual(toWav(renderSelectedAlert("signature", "break-over")));
  const waveforms = ALERT_SOUNDS.map(sound => Buffer.from(toWav(renderSelectedAlert(sound, "focus-done"))).toString("base64"));
  expect(new Set(waveforms).size).toBe(ALERT_SOUNDS.length);
});

it.each(ALERT_SOUNDS.filter(sound => sound !== "none"))("gives %s distinct focus and break waveforms", sound => {
  expect(toWav(renderSelectedAlert(sound, "focus-done"))).not.toEqual(toWav(renderSelectedAlert(sound, "break-over")));
});

it.each(ALERT_KINDS)("keeps Digital's two rests and three note slots for %s", kind => {
  const sr = 8000, data = renderSelectedAlert("digital", kind, sr);
  const energy = (from: number, to: number) => data.slice(Math.ceil(from * sr), Math.floor(to * sr)).reduce((sum, sample) => sum + sample * sample, 0);
  for (const start of [0, 0.24, 0.48]) expect(energy(start, start + 0.1)).toBeGreaterThan(0.001);
  for (const start of [0.18, 0.42]) expect(energy(start, start + 0.05)).toBe(0);
});
