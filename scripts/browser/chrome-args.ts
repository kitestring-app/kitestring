/** Only for disposable test browsers. Muting leaves Web Audio state observable. */
export function chromeArgs(profile: string, extra: string[] = []) {
  return [
    "--headless=new", "--mute-audio", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update", "--disable-sync",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, ...extra, "about:blank",
  ];
}
