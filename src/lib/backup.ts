import { isRecoveryBoundary, isSessionContext } from "../state/recoveryPolicy";
import { withSyncPaused } from "./sync";
import { parseIntentDocument } from "./intent";
import "../state/intent";
import { isParkedItem, PARKED_LIMIT } from "./parked";
import { RADIO_STATIONS } from "../data/radio";
import { backgroundDimensions, BACKGROUND_LIMITS, customBgs, prepareBackground } from "../data/themes";
import type { CustomBackground } from "../data/themes";
import { dbGet } from "./db";
import { canWriteClockStore, flushReadyStores, requestClockAction, restoreStoreEntries } from "./store";
import { isNotesValue, migrateNotes, notesInterruptionPreference } from "../state/notesModel";
import { DEFAULT_SETTINGS, sanitizeSettings, settings } from "../state/settings";
import { captureTimerRestore, hardModeLocked } from "../state/timer";
// Backup format + strict validation. Nothing from a file reaches storage until the whole file passes.

export const BACKUP_FORMAT = "kitestring-backup";
export const BACKUP_VERSION = 2;
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

export const BACKUP_SECTIONS = ["settings", "sounds", "device", "focus", "images"] as const;
export type BackupSection = (typeof BACKUP_SECTIONS)[number];
type StoreClass = { class: "shared" | "device" | "content" | "internal"; section: BackupSection | null };
/** Every persistent store has an explicit portability decision. Internal stores never travel. */
export const STORE_CLASS = {
  settings: { class: "shared", section: "settings" },
  timer: { class: "device", section: "focus" },
  tasks: { class: "content", section: "focus" },
  focusPick: { class: "content", section: "focus" },
  stats: { class: "content", section: "focus" },
  notes: { class: "content", section: "focus" },
  mixer: { class: "shared", section: "sounds" },
  parked: { class: "content", section: "focus" },
  radio: { class: "shared", section: "sounds" },
  intent: { class: "content", section: "focus" },
  devicePreferences: { class: "device", section: "device" },
  floatingGlass: { class: "device", section: "device" },
  customBgs: { class: "content", section: "images" },
  deviceCalmPreset: { class: "internal", section: null },
  clockPresence: { class: "internal", section: null },
  returnActivity: { class: "internal", section: null },
  tinyStarts: { class: "internal", section: null },
  parkingReview: { class: "internal", section: null },
  rewardMoment: { class: "internal", section: null },
} as const satisfies Record<string, StoreClass>;
type ClassifiedKey = keyof typeof STORE_CLASS;
export type BackupKey = { [K in ClassifiedKey]: (typeof STORE_CLASS)[K]["section"] extends null | "images" ? never : K }[ClassifiedKey];
/** Image metadata travels with validated image bytes, never as an ordinary data entry. */
export const BACKUP_KEYS = (Object.keys(STORE_CLASS) as ClassifiedKey[]).filter(
  (key): key is BackupKey => STORE_CLASS[key].section !== null && STORE_CLASS[key].section !== "images",
);
function keysForSections(sections: readonly BackupSection[]): BackupKey[] {
  return BACKUP_KEYS.filter(key => sections.includes(STORE_CLASS[key].section));
}
// v1 predates the device section. Derive its original allowlist from the same table.
const V1_KEYS = BACKUP_KEYS.filter(key => STORE_CLASS[key].section !== "device");

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
const isNum = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const optional = (v: unknown, check: (x: unknown) => boolean) => v === undefined || check(v);
export const isHexColor = (v: unknown): v is string => typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);

const DAY = 86_400_000;
const EPOCH_MIN = Date.UTC(2015, 0, 1);
const EPOCH_MAX = Date.UTC(2100, 0, 1);

function checkTask(t: unknown): string | null {
  if (!isObj(t)) return "task is not an object";
  if (!isStr(t.id, 64) || !t.id) return "task id";
  if (!isStr(t.title, 500)) return "task title";
  if (typeof t.done !== "boolean") return "task done flag";
  if (!isNum(t.createdAt, EPOCH_MIN, EPOCH_MAX)) return "task createdAt";
  if (!optional(t.emoji, (x) => isStr(x, 16))) return "task emoji";
  if (!optional(t.color, isHexColor)) return "task colour";
  if (!optional(t.etaMin, (x) => isNum(x, 0, 600))) return "task estimate";
  if (!optional(t.parentId, (x) => isStr(x, 64))) return "task parent";
  return null;
}

function checkChunk(c: unknown): string | null {
  if (!isObj(c)) return "stats entry is not an object";
  if (!isStr(c.id, 64)) return "stats id";
  if (c.kind !== "focus" && c.kind !== "break") return "stats kind";
  if (c.segment !== "focus" && c.segment !== "short" && c.segment !== "long") return "stats segment";
  if (!isNum(c.start, EPOCH_MIN, EPOCH_MAX)) return "stats start";
  if (!optional(c.away, x => typeof x === "boolean") || (c.away === true && c.kind !== "break")) return "away flag";
  if (!isNum(c.ms, 0, c.kind === "break" ? Number.MAX_SAFE_INTEGER : DAY)) return "stats duration";
  if (!optional(c.earlyEndReason, (x) => isStr(x, 500) && (x as string).trim().length >= 3 && !/[\r\n]/.test(x as string))) return "session exit reason";
  if (typeof c.completed !== "boolean") return "stats completed flag";
  if (!optional(c.segId, (x) => isStr(x, 64)) || !optional(c.taskId, (x) => isStr(x, 64))) return "stats ids";
  return null;
}

const checks: Record<BackupKey, (v: unknown) => string | null> = {
  devicePreferences: value => isObj(value) && Object.values(value).every(v => typeof v === "boolean") ? null : "device preferences",
  floatingGlass: value => isObj(value) && isNum(value.opacity, 0, 1) ? null : "floating timer opacity",
  intent: value => parseIntentDocument(value) ? null : "next action",
  settings: (v) => (isObj(v) ? null : "settings"), // shape and ranges are enforced by sanitizeSettings on load
  timer: (v) => (isObj(v) && ["focus", "short", "long"].includes(v.segment as string) && isNum(v.elapsedBefore, 0, DAY) && isNum(v.round, 0, 1000) &&
    optional(v.context, isSessionContext) && optional(v.boundary, isRecoveryBoundary) && optional(v.reentry, x => isStr(x, 64)) ? null : "timer"),
  tasks: (v) => {
    if (!Array.isArray(v) || v.length > 5000) return "tasks list";
    for (const t of v) {
      const e = checkTask(t);
      if (e) return e;
    }
    return null;
  },
  focusPick: (v) => (v === null || isStr(v, 64) ? null : "focus pick"),
  stats: (v) => {
    if (!isObj(v) || !Array.isArray(v.chunks) || !Array.isArray(v.tasksDone)) return "stats";
    if (v.chunks.length > 250_000 || v.tasksDone.length > 250_000) return "stats size";
    for (const c of v.chunks) {
      const e = checkChunk(c);
      if (e) return e;
    }
    for (const t of v.tasksDone) if (!isObj(t) || !isNum(t.at, EPOCH_MIN, EPOCH_MAX) || !isStr(t.taskId, 64)) return "completed task entry";
    return null;
  },
  parked: (v) => (Array.isArray(v) && v.length <= PARKED_LIMIT && v.every(isParkedItem) && new Set(v.map(item => item.id)).size === v.length ? null : "parked thoughts"),
  notes: (v) => {
    try { return isNotesValue(migrateNotes(v)) ? null : "notes"; }
    catch { return "notes"; }
  },
  radio: (v) => {
    const validId = (id: unknown) => typeof id === "string" && RADIO_STATIONS.some(station => station.id === id);
    return isObj(v) && Array.isArray(v.pinned) && v.pinned.length <= RADIO_STATIONS.length &&
      v.pinned.every(validId) && new Set(v.pinned).size === v.pinned.length && validId(v.lastStation) && isNum(v.volume, 0, 1)
      ? null : "radio preferences";
  },
  mixer: (v) => (isObj(v) ? null : "sound mixes"), // the mixer store sanitizes its own shape on load
};

export interface ParsedBackup {
  version?: 1 | 2;
  exportedAt?: string;
  sections?: BackupSection[];
  data: Partial<Record<BackupKey, unknown>>;
  images?: BackupImage[];
}

/** Keep an active block local, and publish restored values before any unload banking. */
export async function restoreBackup(
  backup: ParsedBackup,
  metadata: (keys: string[]) => Promise<[string, unknown]>,
  selected?: readonly BackupSection[],
): Promise<boolean> {
  // Forward the file and selection before consulting any follower replica.
  // Only the owner prepares images, metadata and timer accounting, and owns
  // the sync queue. A promotion during forwarding must not nest that queue.
  if (!canWriteClockStore("timer")) {
    const result = await requestClockAction("restore-backup", { backup, selected });
    if (!result.ok) throw new Error("The active timer changed. Try importing again.");
    return result.keptTimer === true;
  }
  return withSyncPaused(async () => {
    const available = backup.sections ?? BACKUP_SECTIONS.filter(section => keysForSections([section]).some(key => key in backup.data) || (section === "images" && backup.images !== undefined));
    const sections = available.filter(section => !selected || selected.includes(section));
    if (!sections.length) throw new Error("Choose at least one section to import.");
    const data = Object.fromEntries(keysForSections(sections).filter(key => key in backup.data).map(key => [key, backup.data[key]]));
    const images = sections.includes("images") ? backup.images : undefined;
    const prepare = captureTimerRestore();
    await flushReadyStores();
    const imageEntries = await prepareBackupImageEntries(images);
    const stamp = await metadata(Object.keys(data));
    return restoreStoreEntries(() => {
      const liveImageEntries = imageEntries(customBgs.get());
      const { entries, keptTimer } = prepare(Object.entries(data));
      // Restoring tasks can bank the running block. Apply stats first so that credit survives.
      entries.sort(([a], [b]) => Number(b === "stats") - Number(a === "stats"));
      return { entries: [...entries, ...liveImageEntries, stamp], keptTimer };
    });
  });
}

/** Validate a backup file's text. Returns the restorable entries or throws with a human-readable reason. */
export function parseBackup(text: string): ParsedBackup & { version: 1 | 2; sections: BackupSection[] } {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error("File is too large to be a backup.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("File is not valid JSON.");
  }
  if (!isObj(parsed) || (parsed.format !== BACKUP_FORMAT && parsed.format !== "custom-pomodoro-backup")) throw new Error("Not a Kitestring backup.");
  if (parsed.version !== 1 && parsed.version !== BACKUP_VERSION) throw new Error(`Unsupported backup version ${String(parsed.version)}.`);
  if (!isObj(parsed.data)) throw new Error("Backup has no data.");
  const version = parsed.version as 1 | 2;
  let sections: BackupSection[];
  if (version === 2) {
    if (!Array.isArray(parsed.sections) || !parsed.sections.includes("settings") ||
      parsed.sections.some(value => !BACKUP_SECTIONS.includes(value)) || new Set(parsed.sections).size !== parsed.sections.length ||
      !isObj(parsed.data.settings)) throw new Error("Backup rejected: invalid sections.");
    sections = BACKUP_SECTIONS.filter(section => (parsed.sections as unknown[]).includes(section));
    if (BACKUP_KEYS.some(key => key in (parsed.data as object) && !keysForSections(sections).includes(key)) ||
      (parsed.images !== undefined && !sections.includes("images"))) throw new Error("Backup rejected: data outside its sections.");
  } else {
    sections = BACKUP_SECTIONS.filter(section => V1_KEYS.some(key => STORE_CLASS[key].section === section && key in (parsed.data as object)) ||
      (section === "images" && parsed.images !== undefined));
  }
  const data: Partial<Record<BackupKey, unknown>> = {};
  for (const k of version === 1 ? V1_KEYS : keysForSections(sections)) {
    if (!(k in parsed.data) || parsed.data[k] === undefined) continue;
    const err = checks[k](parsed.data[k]);
    if (err) throw new Error(`Backup rejected: invalid ${err}.`);
    data[k] = k === "intent" ? parseIntentDocument(parsed.data[k]) : parsed.data[k];
  }
  if (!Object.keys(data).length) throw new Error("Backup is empty.");
  if (data.notes !== undefined) {
    const prompt = notesInterruptionPreference(data.notes);
    data.notes = migrateNotes(data.notes);
    if (prompt !== undefined) {
      const imported = data.settings as { timer?: { interruptionPrompt?: unknown } } | undefined;
      if (typeof imported?.timer?.interruptionPrompt !== "boolean") {
        const current = sanitizeSettings(data.settings ?? settings.get());
        data.settings = { ...current, timer: { ...current.timer, interruptionPrompt: prompt } };
      }
    }
  }
  if (data.settings !== undefined) data.settings = sanitizeSettings(data.settings);
  const images = parsed.images === undefined ? undefined : validateBackupImages(parsed.images);
  // A v1 notes migration may synthesize settings, which must be selectable in the preview.
  if (data.settings !== undefined && !sections.includes("settings")) sections.unshift("settings");
  const exportedAt = typeof parsed.exportedAt === "string" && Number.isFinite(Date.parse(parsed.exportedAt)) ? parsed.exportedAt : undefined;
  return { version, sections, ...(exportedAt ? { exportedAt } : {}), data, ...(images === undefined ? {} : { images }) };
}


// Images are opt-in and travel separately from the ordinary data keys. No URLs or SVG are accepted.
export const MAX_BACKUP_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_BACKUP_IMAGES_BYTES = 10 * 1024 * 1024;
export interface BackupImage { id: string; name: string; type: string; base64: string }
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function imageBytes(image: BackupImage): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(image.base64), char => char.charCodeAt(0));
}
function validateImageBytes(bytes: Uint8Array<ArrayBuffer>, type: string): void {
  const header = String.fromCharCode(...bytes.subarray(0, 12));
  const detected = bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" :
    header.startsWith("\x89PNG\r\n\x1a\n") ? "image/png" :
    ["GIF87a", "GIF89a"].some(value => header.startsWith(value)) ? "image/gif" :
    header.startsWith("RIFF") && header.slice(8, 12) === "WEBP" ? "image/webp" : null;
  if (detected !== type) throw new Error("Backup rejected: image content does not match its type.");
  backgroundDimensions(bytes.buffer);
}
function validateBackupImages(value: unknown): BackupImage[] {
  if (!Array.isArray(value) || value.length > BACKGROUND_LIMITS.count) throw new Error("Backup rejected: invalid background image list.");
  const ids = new Set<string>();
  let total = 0;
  return value.map(item => {
    if (!isObj(item) || typeof item.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) || ids.has(item.id) ||
      !isStr(item.name, 500) || !IMAGE_TYPES.includes(item.type as string) || typeof item.base64 !== "string" || !item.base64.length ||
      item.base64.length > 4 * Math.ceil(MAX_BACKUP_IMAGE_BYTES / 3) ||
      (item.base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(item.base64) || !/^[^=]*={0,2}$/.test(item.base64))) {
      throw new Error("Backup rejected: invalid background image.");
    }
    const image = { id: item.id, name: item.name as string, type: item.type as string, base64: item.base64 };
    const bytes = imageBytes(image);
    total += bytes.length;
    if (bytes.length > MAX_BACKUP_IMAGE_BYTES || total > MAX_BACKUP_IMAGES_BYTES) throw new Error("Background images exceed the backup limit (5 MB each, 10 MB total).");
    validateImageBytes(bytes, image.type);
    ids.add(image.id);
    return image;
  });
}

async function assertImageDecodes(blob: Blob, name: string): Promise<void> {
  // Byte limits and encoded dimensions pass before allocating any bitmap.
  if (typeof createImageBitmap === "function") {
    try { const bitmap = await createImageBitmap(blob); bitmap.close(); }
    catch { throw new Error(`The background image “${name}” could not be decoded.`); }
  } else if (typeof Image !== "undefined") {
    const url = URL.createObjectURL(blob);
    try { const decoded = new Image(); decoded.src = url; await decoded.decode(); }
    catch { throw new Error(`The background image “${name}” could not be decoded.`); }
    finally { URL.revokeObjectURL(url); }
  }
}

export interface BackupOptions { sections?: readonly BackupSection[]; includeName?: boolean }
/** The boolean overload keeps existing full-backup callers working. Images stay opt-in. */
export async function createBackup(options: BackupOptions | boolean = false): Promise<string> {
  const requested = typeof options === "boolean" ? BACKUP_SECTIONS.filter(section => section !== "images" || options) : options.sections ?? ["settings"];
  const sections = BACKUP_SECTIONS.filter(section => section === "settings" || requested.includes(section));
  const includeImages = sections.includes("images");
  const includeName = typeof options === "object" && options.includeName === true;
  await flushReadyStores();
  const images: BackupImage[] = [];
  if (includeImages) {
    const saved = await dbGet<CustomBackground[]>("customBgs") ?? [];
    let total = 0;
    for (const item of saved) {
      const blob = await dbGet<Blob>(`custom-bg:${item.id}`);
      if (!(blob instanceof Blob)) throw new Error(`The saved image “${item.name}” is missing. Remove it in Themes or export without images.`);
      total += blob.size;
      if (blob.size > MAX_BACKUP_IMAGE_BYTES || total > MAX_BACKUP_IMAGES_BYTES) throw new Error("Background images exceed the backup limit (5 MB each, 10 MB total). Export without images or remove some in Themes.");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      validateImageBytes(bytes, blob.type);
      await assertImageDecodes(blob, item.name);
      let binary = "";
      for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
      images.push({ id: item.id, name: item.name, type: blob.type, base64: btoa(binary) });
    }
  }
  // Include changes made while images decoded, including a completed block and its settled timer.
  if (includeImages) await flushReadyStores();
  const data: Partial<Record<BackupKey, unknown>> = {};
  for (const key of keysForSections(sections)) {
    const value = await dbGet(key);
    if (value !== undefined) data[key] = value;
  }
  if (hardModeLocked()) delete data.timer;
  const savedSettings = sanitizeSettings(data.settings ?? settings.get());
  data.settings = { ...savedSettings, extras: { ...savedSettings.extras,
    displayName: includeName ? savedSettings.extras.displayName : DEFAULT_SETTINGS.extras.displayName } };
  const text = JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, sections, exportedAt: new Date().toISOString(), data,
    ...(includeImages ? { images } : {}) }, null, 2);
  const parsed = parseBackup(text);
  return JSON.stringify({ ...JSON.parse(text), data: parsed.data }, null, 2);
}

/** Build all image writes before the caller's single import transaction. Preserve unrelated uploads. */
export async function backupImageEntries(images?: BackupImage[]): Promise<[string, unknown][]> {
  if (!images?.length) return [];
  const entries = await prepareBackupImageEntries(images);
  return entries(await dbGet<CustomBackground[]>("customBgs") ?? []);
}

/** Prepare immutable blobs now; merge the live upload list only when the restore applies. */
async function prepareBackupImageEntries(images?: BackupImage[]): Promise<(current: CustomBackground[]) => [string, unknown][]> {
  if (!images?.length) return () => [];
  const validated = validateBackupImages(images);
  const importedIds = new Set(validated.map(image => image.id));
  const previous = await dbGet<CustomBackground[]>("customBgs") ?? [];
  const sizes = new Map(await Promise.all(previous.map(async item =>
    [item.id, (await dbGet<Blob>(`custom-bg:${item.id}`))?.size ?? 0] as const)));
  const blobs: (BackupImage & { blob: Blob })[] = [];
  for (const image of validated) {
    const file = new File([imageBytes(image)], image.name, { type: image.type });
    blobs.push({ ...image, blob: await prepareBackground(file) });
  }
  // Quota estimates are optional; IndexedDB still enforces quota on the transaction.
  let estimate: StorageEstimate | undefined;
  try { estimate = typeof navigator === "undefined" ? undefined : await navigator.storage?.estimate?.(); } catch { /* unavailable */ }
  const added = blobs.reduce((sum, image) => sum + image.blob.size, 0);
  if (Number.isFinite(estimate?.quota) && Number.isFinite(estimate?.usage) && estimate!.quota! - estimate!.usage! - added < BACKGROUND_LIMITS.reserve) {
    throw new Error("Not enough storage for these images. Free some space before importing.");
  }
  return current => {
    const kept = current.filter(item => !importedIds.has(item.id)).map(item => ({ ...item, size: item.size ?? sizes.get(item.id) ?? 0 }));
    const metadata = [...kept, ...blobs.map(image => ({ id: image.id, name: image.name, size: image.blob.size }))];
    const bytes = metadata.reduce((sum, image) => sum + image.size, 0);
    if (metadata.length > BACKGROUND_LIMITS.count || bytes > BACKGROUND_LIMITS.bytes) throw new Error("These images would exceed your saved background limit. Remove some in Themes before importing.");
    return [["customBgs", metadata], ...blobs.map(image => [`custom-bg:${image.id}`, image.blob] as [string, unknown])];
  };
}
