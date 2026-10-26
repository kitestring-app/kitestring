import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
vi.hoisted(() => { vi.stubGlobal("navigator", {}); vi.stubGlobal("BroadcastChannel", undefined); });
import { BACKUP_FORMAT, createBackup, parseBackup } from "./backup";

it.each([1, 2])("imports old and new named v%s fixtures with identical migrated data", version => {
  const fixture = JSON.parse(readFileSync(new URL(`./fixtures/backup-v${version}.json`, import.meta.url), "utf8"));
  expect(fixture.format).toBe("custom-pomodoro-backup");
  const old = parseBackup(JSON.stringify(fixture));
  const renamed = parseBackup(JSON.stringify({ ...fixture, format: "kitestring-backup" }));
  expect(renamed).toEqual(old);
  expect(old.data.tasks).toMatchObject([{ title: "Open the draft" }]);
  expect(old.data.notes).toBe("Earlier effort stays here.");
  expect(old.data.settings).toMatchObject({ timer: { lengths: { pomodoro: 42 } } });
});
it("exports only the new name", async () => {
  expect(BACKUP_FORMAT).toBe("kitestring-backup");
  const file = JSON.parse(await createBackup());
  expect(file.format).toBe("kitestring-backup");
  expect(file.version).toBe(2);
  expect(parseBackup(JSON.stringify(file)).version).toBe(2);
});
