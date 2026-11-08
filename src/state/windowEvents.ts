import { windowEvents } from "./settings";

/** A focus block was started by the person (Start, resume, or a reminder's Start button). */
export function windowOnFocusStart() {
  const action = windowEvents.get().onStart;
  if (action !== "nothing") window.desktop?.windowEvent?.(action);
}

/** A focus block reached its end. A missed ending (sleep, quit) does not move windows. */
export function windowOnFocusEnd() {
  const action = windowEvents.get().onEnd;
  if (action !== "nothing") window.desktop?.windowEvent?.(action);
}
