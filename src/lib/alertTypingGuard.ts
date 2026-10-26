const QUIET_MS = 1500;

type Key = Pick<KeyboardEvent, "key" | "metaKey" | "preventDefault" | "stopImmediatePropagation">;

/** Transient, shared by every alert surface. Pointer actions never enter this guard. */
export function createAlertTypingGuard(now = () => performance.now()) {
  let quietSince: number | null = null;
  const handled = new WeakMap<Key, boolean>();
  const swallowed = new Set<string>();
  const pending = () => quietSince !== null && now() - quietSince < QUIET_MS;
  const blocks = (stopSound: boolean) => {
    const guarded = pending();
    if (quietSince !== null) quietSince = guarded ? now() : null;
    return guarded && !stopSound;
  };
  return {
    begin() { quietSince = now(); },
    pending,
    accelerator(stopSound = false) { return blocks(stopSound); },
    keydown(event: Key) {
      const previous = handled.get(event);
      if (previous !== undefined) return previous;
      const block = blocks(event.metaKey && event.key === ".");
      handled.set(event, block);
      if (block) {
        swallowed.add(event.key);
        event.preventDefault();
        event.stopImmediatePropagation();
      } else {
        swallowed.delete(event.key);
      }
      return block;
    },
    keyup(event: Key) {
      // Space activates buttons on release. A swallowed press must never become a click.
      const blockedPress = swallowed.delete(event.key);
      if (blockedPress || pending() && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
  };
}

export const alertTypingGuard = createAlertTypingGuard();
