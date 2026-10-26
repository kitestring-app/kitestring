// Talks to the local companion (scripts/companion.mjs) when the app is served from it on localhost.
// The companion rings a native macOS notification + loud sound at the end of a segment, even if Chrome is closed.
// When it's reachable the page doesn't chime itself, so you never hear the alert twice.
import type { AlertKind, AlertSound } from "./alertSynth";

const HEADERS = { "Content-Type": "application/json", "X-Custom-Pomodoro": "1" };
let available: boolean | null = null;
let checking: Promise<boolean> | null = null;
let alarmVersion = 0;
let alarmRequests: Promise<unknown> = Promise.resolve();
function queueAlarm<T>(request: () => Promise<T>): Promise<T> {
  const result = alarmRequests.then(request);
  alarmRequests = result.catch(() => undefined);
  return result;
}

const isLocal = () => typeof location !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

/** True once we've confirmed the companion answers on this origin. Cached; re-checked after failures. */
export function companionAvailable(): Promise<boolean> {
  if (typeof window !== "undefined" && window.desktop?.armAlarm) return Promise.resolve(true);
  if (!isLocal()) return Promise.resolve(false);
  if (available !== null) return Promise.resolve(available);
  checking ??= fetch("/api/health", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { ok?: boolean } | null) => (available = !!j?.ok))
    .catch(() => (available = false))
    .finally(() => (checking = null));
  return checking;
}
export const companionKnownUp = () => (typeof window !== "undefined" && !!window.desktop?.armAlarm) || available === true;

export async function armCompanion(at: number, kind: AlertKind, volume: number, alertSound: AlertSound = "signature"): Promise<boolean> {
  return armCompanionWithSpeech(at, kind, volume, false, alertSound);
}

/** Arms the transition announcement as well as the native chime. Zero volume means speech only. */
export async function armCompanionWithSpeech(at: number, kind: AlertKind, volume: number, speak: boolean, alertSound: AlertSound = "signature"): Promise<boolean> {
  if (typeof window !== "undefined" && window.desktop?.armAlarm) return window.desktop.armAlarm({ at, kind, volume, speak, alertSound });
  const version = ++alarmVersion;
  if (!(await companionAvailable()) || version !== alarmVersion) return false;
  try {
    const r = await queueAlarm(() => version === alarmVersion ? fetch("/api/alarm", { method: "POST", headers: HEADERS, body: JSON.stringify({ at, kind, volume, speak, alertSound }) }) : Promise.resolve(null));
    if (!r) return false;
    if (!r.ok) throw new Error(String(r.status));
    return true;
  } catch {
    available = null;
    return false;
  }
}

/** Stops the current announcement without disarming an auto-started segment's next alarm. */
export async function cancelCompanionSpeech(): Promise<void> {
  if (typeof window !== "undefined" && window.desktop?.cancelSpeech) return window.desktop.cancelSpeech();
  if (!available) return;
  await fetch("/api/speech", { method: "DELETE", headers: HEADERS }).catch(() => undefined);
}

export async function disarmCompanion(): Promise<void> {
  if (typeof window !== "undefined" && window.desktop?.disarmAlarm) return window.desktop.disarmAlarm();
  alarmVersion++;
  if (checking) await checking;
  if (!available) return;
  try {
    await queueAlarm(() => fetch("/api/alarm", { method: "DELETE", headers: HEADERS }));
  } catch {
    available = null;
  }
}

export async function testCompanion(kind: AlertKind, volume: number, alertSound: AlertSound = "signature"): Promise<boolean> {
  if (typeof window !== "undefined" && window.desktop?.armAlarm) return false;
  if (!(await companionAvailable())) return false;
  const r = await fetch("/api/test", { method: "POST", headers: HEADERS, body: JSON.stringify({ kind, volume, alertSound }) }).catch(() => null);
  return !!r?.ok;
}
