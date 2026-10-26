import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AboutTab } from "../settings/AboutTab";
it("describes local storage, optional sync and network features on both platforms", () => {
  try {
    for (const desktop of [undefined, {}]) {
      vi.stubGlobal("window", { desktop });
      const html = renderToStaticMarkup(<AboutTab />);
      for (const text of ["local-first", "Optional account sync sends", "Internet radio", "music embeds", "photo themes use the network"]) expect(html).toContain(text);
      expect(html).not.toMatch(/Everything works offline|nothing is sent anywhere/);
    }
  } finally { vi.unstubAllGlobals(); }
});

it("shows in-app keys on both platforms and native menu shortcuts only on Mac", () => {
  try {
    for (const desktop of [undefined, {}]) {
      vi.stubGlobal("window", { desktop });
      const html = renderToStaticMarkup(<AboutTab />);
      for (const key of ["⌘.", "Stop Sound", "Space", "Reset segment", "Skip / finish", "Tasks", "Sounds &amp; music", "Settings"]) expect(html).toContain(key);
      expect(html.includes("Mac menu shortcuts")).toBe(!!desktop);
      if (desktop) for (const key of ["⌘,", "⌘Return", "⇧⌘T", "⇧⌘M", "⇧⌘N", "⇧⌘F", "⌥⌘P"]) expect(html).toContain(key);
    }
  } finally { vi.unstubAllGlobals(); }
});
