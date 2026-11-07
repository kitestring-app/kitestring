import type { ChildProcess } from "node:child_process";

/** Only for disposable test browsers. Muting leaves Web Audio state observable. */
export function chromeArgs(profile: string, extra: string[] = []) {
  return [
    "--headless=new", "--mute-audio", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update", "--disable-sync",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, ...extra, "about:blank",
  ];
}

/** Spawn options for a test Chrome: its own process group, so cleanup can stop every helper process. */
export const chromeSpawn = { detached: true } as const;

/**
 * Killing only the main process leaves GPU/utility helpers writing to the profile,
 * which makes the profile cleanup fail with ENOTEMPTY. Kill the whole group instead.
 */
export function killChromeTree(child: ChildProcess) {
  try { if (child.pid) { process.kill(-child.pid, "SIGKILL"); return; } } catch { /* not a group leader */ }
  child.kill("SIGKILL");
}

/** A test runner that dies early must not leave a detached Chrome behind. */
export function guardChromeTree<T extends ChildProcess>(child: T): T {
  const stop = () => killChromeTree(child);
  process.once("exit", stop);
  child.once("exit", () => process.off("exit", stop));
  return child;
}
