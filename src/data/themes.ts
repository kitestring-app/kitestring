import { dbDel, dbGet, dbSet } from "../lib/db";
import { createStore, uid } from "../lib/store";
import { settings, settingsUpdate } from "../state/settings";

// Theme library. Gradients/animated themes are pure CSS (no licensing questions).
// Photo themes hotlink curated Unsplash CDN images (Unsplash license: free use; we don't bundle the files).

export type ThemeCategory = "gradients" | "abstract" | "scenic" | "nature" | "urban" | "interior" | "animated";

export interface ThemeDef {
  id: string;
  name: string;
  category: ThemeCategory;
  background: string; // any CSS `background` value
  animated?: string; // CSS class for animated themes
  credit?: string; // photographer credit for photo themes
  light?: boolean; // light background: dashboard text switches to dark
}

export const THEME_CATEGORIES: { id: ThemeCategory; label: string }[] = [
  { id: "gradients", label: "Gradients & Colors" },
  { id: "abstract", label: "Abstract" },
  { id: "scenic", label: "Scenic" },
  { id: "nature", label: "Nature" },
  { id: "urban", label: "Urban" },
  { id: "interior", label: "Interior" },
  { id: "animated", label: "Animated" },
];

export const THEMES: ThemeDef[] = [
  {
    id: "dusk-glass",
    name: "Dusk Glass",
    category: "gradients",
    background:
      "radial-gradient(60vmax 60vmax at 15% 10%, #3b2f6e 0%, transparent 60%), radial-gradient(55vmax 55vmax at 90% 80%, #5a2c4f 0%, transparent 60%), radial-gradient(50vmax 50vmax at 60% 30%, #1f3b46 0%, transparent 60%), #14121C",
  },
  { id: "thermal", name: "Thermal", category: "gradients", background: "radial-gradient(120% 120% at 100% 100%, #f7c6a3 0%, #e96f5b 28%, #6a1fd1 62%, #12062e 100%)" },
  { id: "cotton", light: true, name: "Cotton", category: "gradients", background: "radial-gradient(70% 60% at 30% 40%, #f6c9e4 0%, transparent 60%), radial-gradient(60% 70% at 70% 60%, #9fb9f2 0%, transparent 60%), #eef0fb" },
  { id: "autumn", light: true, name: "Autumn", category: "gradients", background: "radial-gradient(50% 50% at 60% 55%, #3a1408 0%, transparent 55%), radial-gradient(70% 70% at 20% 30%, #c95d2a 0%, transparent 60%), linear-gradient(120deg, #bfe3d0, #f2c89b)" },
  { id: "midnight", name: "Midnight", category: "gradients", background: "linear-gradient(160deg, #0b1026 0%, #1b1f4b 55%, #3a2d6b 100%)" },
  { id: "forest-dusk", name: "Forest Dusk", category: "gradients", background: "linear-gradient(170deg, #0f2a22 0%, #1d4b3a 50%, #9cc39b 100%)" },
  { id: "blue-flare", name: "Blue Flare", category: "gradients", background: "radial-gradient(80% 80% at 80% 20%, #4cc9f0 0%, transparent 55%), linear-gradient(135deg, #0b132b, #1c2541)" },
  { id: "pink-flare", name: "Pink Flare", category: "gradients", background: "radial-gradient(80% 80% at 20% 80%, #ff7eb6 0%, transparent 55%), linear-gradient(135deg, #1a0b1e, #3b1240)" },
  { id: "aurora", name: "Aurora", category: "animated", animated: "anim-aurora", background: "linear-gradient(125deg, #0b1d2e, #133b3a, #2b1f4f, #0b1d2e)" },
  { id: "lava", name: "Lava Lamp", category: "animated", animated: "anim-lava", background: "linear-gradient(125deg, #2b0f3a, #6a1fd1, #e96f5b, #2b0f3a)" },
  { id: "ink", name: "Ink", category: "gradients", background: "linear-gradient(145deg, #111827, #243145, #11111e)" },
  { id: "sage", name: "Sage", category: "gradients", background: "radial-gradient(ellipse at 20% 80%, #9aac88, transparent 70%), linear-gradient(130deg, #16382d, #476956)" },
  { id: "sandstone", name: "Sandstone", category: "gradients", background: "radial-gradient(ellipse at 80% 10%, #d4ad88, transparent 70%), linear-gradient(140deg, #4d3440, #a17e68)" },
  { id: "twilight", name: "Twilight", category: "gradients", background: "linear-gradient(175deg, #1c284d, #715b87 65%, #d7a393)" },
  { id: "tidal", name: "Tidal", category: "gradients", background: "radial-gradient(ellipse at 10% 10%, #529a9b, transparent 65%), linear-gradient(160deg, #143e54, #102435)" },
  { id: "plum", name: "Plum", category: "gradients", background: "radial-gradient(ellipse at 70% 70%, #91627e, transparent 65%), linear-gradient(120deg, #291b3c, #50314e)" },
  { id: "honey", name: "Honey", category: "gradients", background: "radial-gradient(ellipse at 30% 20%, #d3ab5b, transparent 70%), linear-gradient(135deg, #4b352a, #987346)" },
  { id: "moonstone", name: "Moonstone", category: "gradients", background: "radial-gradient(ellipse at 80% 20%, #939eb9, transparent 65%), linear-gradient(130deg, #262c43, #536379)" },
  { id: "frosted-glass", name: "Frosted Glass", category: "abstract", background: "linear-gradient(115deg, transparent 25%, #b4d6e833 26%, transparent 52%), radial-gradient(ellipse at 80% 80%, #799eae, transparent 65%), #223a50" },
  { id: "silk-waves", name: "Silk Waves", category: "abstract", background: "repeating-radial-gradient(ellipse at 0% 140%, transparent 0 8%, #bfa6df22 9% 14%, transparent 15% 22%), linear-gradient(130deg, #302440, #6b527c)" },
  { id: "prism", name: "Prism", category: "abstract", background: "conic-gradient(from 25deg at 30% 70%, #272648, #57677d, #b18d98, #4c3e64, #272648)" },
  { id: "soft-orbit", name: "Soft Orbit", category: "abstract", background: "radial-gradient(ellipse at 75% 70%, #152d3e 30%, #87a9ad 31%, #334e60 33%, transparent 65%), #1d2c40" },
  { id: "paper-fold", name: "Paper Fold", category: "abstract", background: "conic-gradient(from 45deg at 65% 35%, #434863, #737088, #333747, #434863)" },
  { id: "ripple", name: "Ripple", category: "abstract", background: "repeating-radial-gradient(ellipse at 70% 110%, #1f3c46 0 10%, #2b4e57 12% 20%, #42616a 23% 25%)" },
  { id: "drift", name: "Drift", category: "animated", animated: "anim-drift", background: "radial-gradient(ellipse at 20% 30%, #798cbd, transparent 55%), radial-gradient(ellipse at 80% 70%, #786288, transparent 60%), #202b48" },
  { id: "northern-lights", name: "Northern Lights", category: "animated", animated: "anim-northern-lights", background: "linear-gradient(120deg, #0b162c, #286765, #51668b, #27334e, #0b162c)" },
  { id: "ocean-glow", name: "Ocean Glow", category: "animated", animated: "anim-ocean-glow", background: "radial-gradient(ellipse at 25% 75%, #367f91, transparent 65%), linear-gradient(150deg, #0c243b, #24536b, #102b43)" },
  { id: "ember", name: "Ember", category: "animated", animated: "anim-ember", background: "radial-gradient(ellipse at 70% 80%, #ae663c, transparent 55%), linear-gradient(120deg, #291c30, #633b48, #291c30)" },
  {"id": "lakeside-night", "name": "Lakeside Night", "category": "scenic", "credit": "Luca Bravo", "background": "url(\"https://images.unsplash.com/photo-1588426651288-7e828a77f413?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "moonlit-shore", "name": "Moonlit Shore", "category": "scenic", "credit": "Luca Bravo", "background": "url(\"https://images.unsplash.com/photo-1590418606746-018840f9cd0f?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "alpine-cabins", "name": "Alpine Cabins", "category": "scenic", "credit": "Luca Bravo", "background": "url(\"https://images.unsplash.com/photo-1756156263665-8e4aa121b642?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "forest-mist", "name": "Forest Mist", "category": "nature", "credit": "Luca Bravo", "background": "url(\"https://images.unsplash.com/photo-1756155129837-4291ad0e89c0?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "quiet-pines", "name": "Quiet Pines", "category": "nature", "credit": "Luca Bravo", "background": "url(\"https://images.unsplash.com/photo-1756155003566-d42bf1785a40?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "cloud-forest", "name": "Cloud Forest", "category": "nature", "credit": "Luca Bravo", "background": "url(\"https://images.unsplash.com/photo-1756155160750-42354f02c1b7?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "city-dusk", "name": "City Dusk", "category": "urban", "credit": "Luca Bravo", "background": "url(\"https://images.unsplash.com/photo-1601235116901-2dc694b4cb1b?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "night-tower", "name": "Night Tower", "category": "urban", "credit": "Luca Bravo", "background": "url(\"https://images.unsplash.com/photo-1585340609407-effd320e125f?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "white-lines", "name": "White Lines", "category": "urban", "credit": "Luca Bravo", "background": "url(\"https://images.unsplash.com/photo-1591912046924-b10112411591?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "reading-light", "name": "Reading Light", "category": "interior", "credit": "Karolina Grabowska", "background": "url(\"https://images.unsplash.com/photo-1667312939978-64cf31718a6e?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "quiet-corner", "name": "Quiet Corner", "category": "interior", "credit": "Hutomo Abrianto", "background": "url(\"https://images.unsplash.com/photo-1519710164239-da123dc03ef4?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "slow-living", "name": "Slow Living", "category": "interior", "credit": "Katja Rooke", "background": "url(\"https://images.unsplash.com/photo-1605774337664-7a846e9cdf17?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  // Job 26: original CSS compositions and credited Unsplash photographs.
  {"id": "carbon-night", "name": "Carbon Night", "category": "gradients", "background": "linear-gradient(150deg, #121720, #28313b, #151923)"},
  {"id": "violet-horizon", "name": "Violet Horizon", "category": "gradients", "background": "linear-gradient(175deg, #17152e, #4c3867 65%, #976879)"},
  {"id": "moss-pool", "name": "Moss Pool", "category": "gradients", "background": "radial-gradient(ellipse at 25% 75%, #487564, transparent 70%), linear-gradient(130deg, #122e30, #253e32)"},
  {"id": "rust-bloom", "name": "Rust Bloom", "category": "gradients", "background": "radial-gradient(ellipse at 80% 20%, #9b5949, transparent 65%), linear-gradient(135deg, #301e29, #63372e)"},
  {"id": "pacific-ink", "name": "Pacific Ink", "category": "gradients", "background": "linear-gradient(140deg, #101d31, #24505c 55%, #102b3e)"},
  {"id": "porcelain-sky", "name": "Porcelain Sky", "category": "gradients", "background": "linear-gradient(145deg, #e5edf5, #d1e0eb 55%, #eef2f6)", "light": true},
  {"id": "apricot-mist", "name": "Apricot Mist", "category": "gradients", "background": "radial-gradient(ellipse at 20% 30%, #f7d5b7, transparent 65%), linear-gradient(120deg, #f5e9d9, #ead5d6)", "light": true},
  {"id": "garnet", "name": "Garnet", "category": "gradients", "background": "radial-gradient(ellipse at 75% 75%, #814a62, transparent 65%), linear-gradient(145deg, #24182c, #4d263b)"},
  {"id": "interference", "name": "Interference", "category": "abstract", "background": "repeating-linear-gradient(118deg, #698ca312 0 2px, transparent 3px 18px), radial-gradient(ellipse at 30% 65%, #425a77, transparent 65%), #172437"},
  {"id": "paper-arcs", "name": "Paper Arcs", "category": "abstract", "background": "repeating-radial-gradient(ellipse at 110% 130%, #e8dfcf 0 8%, #f1ebdf 9% 18%, #d9cebd 19% 20%)", "light": true},
  {"id": "glass-blocks", "name": "Glass Blocks", "category": "abstract", "background": "linear-gradient(35deg, transparent 35%, #88b8c222 35% 65%, transparent 65%), linear-gradient(145deg, transparent 40%, #b19bc522 40% 70%, transparent 70%), #24374c"},
  {"id": "contour", "name": "Contour", "category": "abstract", "background": "repeating-radial-gradient(ellipse at 15% 110%, #172f36 0 7%, #50726c 7.4% 7.8%, #213e43 8% 16%)"},
  {"id": "amber-ribbon", "name": "Amber Ribbon", "category": "abstract", "background": "conic-gradient(from 210deg at 80% 25%, #2b2437, #785444, #ba8d57, #463044, #2b2437)"},
  {"id": "lattice", "name": "Lattice", "category": "abstract", "background": "repeating-linear-gradient(45deg, #a5b6cb12 0 1px, transparent 2px 45px), repeating-linear-gradient(-45deg, #a5b6cb12 0 1px, transparent 2px 45px), linear-gradient(130deg, #1c2840, #3c455f)"},
  {"id": "tide-pools", "name": "Tide Pools", "category": "animated", "background": "radial-gradient(ellipse at 20% 30%, #487e81, transparent 60%), radial-gradient(ellipse at 80% 75%, #516e95, transparent 60%), #132b40", "animated": "anim-tide-pools"},
  {"id": "solitary-field", "name": "Solitary Field", "category": "scenic", "credit": "Johannes Plenio", "background": "url(\"https://images.unsplash.com/photo-1761509382926-a706ef9edd48?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "evening-grasses", "name": "Evening Grasses", "category": "scenic", "credit": "Johannes Plenio", "background": "url(\"https://images.unsplash.com/photo-1710283387268-cbb5b299d405?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "snow-summit", "name": "Snow Summit", "category": "scenic", "credit": "Johannes Plenio", "background": "url(\"https://images.unsplash.com/photo-1708641511713-d50fe7563120?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "valley-haze", "name": "Valley Haze", "category": "scenic", "credit": "Johannes Plenio", "background": "url(\"https://images.unsplash.com/photo-1708285861027-19d38d2c1d58?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "hill-road", "name": "Hill Road", "category": "scenic", "credit": "Johannes Plenio", "background": "url(\"https://images.unsplash.com/photo-1708171448944-077ff4120e1a?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "mountain-railway", "name": "Mountain Railway", "category": "scenic", "credit": "Johannes Plenio", "background": "url(\"https://images.unsplash.com/photo-1708171448902-afc2e41fe0d1?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "far-fields", "name": "Far Fields", "category": "scenic", "credit": "Johannes Plenio", "background": "url(\"https://images.unsplash.com/photo-1708128097661-7f2c1e6d3982?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "autumn-walk", "name": "Autumn Walk", "category": "scenic", "credit": "Johannes Plenio", "background": "url(\"https://images.unsplash.com/photo-1761509437705-974195f18202?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "sunlit-stalk", "name": "Sunlit Stalk", "category": "scenic", "credit": "Johannes Plenio", "background": "url(\"https://images.unsplash.com/photo-1761509403385-3310e24c2b7f?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "hillside-shelter", "name": "Hillside Shelter", "category": "scenic", "credit": "Luca Bravo", "background": "url(\"https://images.unsplash.com/photo-1756155146124-7011cd4fcd4f?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "blue-hour-clouds", "name": "Blue Hour Clouds", "category": "scenic", "credit": "Luca Bravo", "background": "url(\"https://images.unsplash.com/photo-1600717779912-7feb262afbac?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "last-light", "name": "Last Light", "category": "scenic", "credit": "Luca Bravo", "background": "url(\"https://images.unsplash.com/photo-1598538525643-60eda13b82fd?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "cloud-study", "name": "Cloud Study", "category": "scenic", "credit": "Luca Bravo", "background": "url(\"https://images.unsplash.com/photo-1591911133855-f9eeb83c1793?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "open-sky", "name": "Open Sky", "category": "scenic", "credit": "Luca Bravo", "background": "url(\"https://images.unsplash.com/photo-1585517342886-1f076085742a?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "soft-ridges", "name": "Soft Ridges", "category": "scenic", "credit": "Lukasz Szmigiel", "background": "url(\"https://images.unsplash.com/photo-1760132562597-dd9c467cd9cf?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "yellow-fields", "name": "Yellow Fields", "category": "scenic", "credit": "Lukasz Szmigiel", "background": "url(\"https://images.unsplash.com/photo-1746868220316-dffbbf8198ae?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "green-expanse", "name": "Green Expanse", "category": "scenic", "credit": "Lukasz Szmigiel", "background": "url(\"https://images.unsplash.com/photo-1687419212935-275c9fe86138?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "woodland-cascade", "name": "Woodland Cascade", "category": "scenic", "credit": "Lukasz Szmigiel", "background": "url(\"https://images.unsplash.com/photo-1683123224886-3f35dbef6771?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "country-lane", "name": "Country Lane", "category": "scenic", "credit": "Lukasz Szmigiel", "background": "url(\"https://images.unsplash.com/photo-1683123031981-b8d2fcee671e?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "wheat-season", "name": "Wheat Season", "category": "scenic", "credit": "Lukasz Szmigiel", "background": "url(\"https://images.unsplash.com/photo-1657308506536-61fc10484fa0?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "foggy-footpath", "name": "Foggy Footpath", "category": "scenic", "credit": "Lukasz Szmigiel", "background": "url(\"https://images.unsplash.com/photo-1648884738520-39bf62fdec8e?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "cherry-branch", "name": "Cherry Branch", "category": "nature", "credit": "Lukasz Szmigiel", "background": "url(\"https://images.unsplash.com/photo-1750100672254-419589a1c9ca?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "lilac-canopy", "name": "Lilac Canopy", "category": "nature", "credit": "Lukasz Szmigiel", "background": "url(\"https://images.unsplash.com/photo-1746868219954-9c9e424db33d?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "grass-light", "name": "Grass Light", "category": "nature", "credit": "Lukasz Szmigiel", "background": "url(\"https://images.unsplash.com/photo-1746868395159-500294ceb4d7?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "white-blossom", "name": "White Blossom", "category": "nature", "credit": "Lukasz Szmigiel", "background": "url(\"https://images.unsplash.com/photo-1746868218406-312bdf91ba06?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "theater-lights", "name": "Theater Lights", "category": "urban", "credit": "Luca Bravo", "background": "url(\"https://images.unsplash.com/photo-1593510080161-4f612c78583b?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "neon-reflections", "name": "Neon Reflections", "category": "urban", "credit": "Luca Bravo", "background": "url(\"https://images.unsplash.com/photo-1591911913225-b4f65b23a475?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "balcony-house", "name": "Balcony House", "category": "urban", "credit": "Johannes Plenio", "background": "url(\"https://images.unsplash.com/photo-1761509426771-741e4ddd2d53?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "bicycle-stop", "name": "Bicycle Stop", "category": "urban", "credit": "Johannes Plenio", "background": "url(\"https://images.unsplash.com/photo-1710283387370-5e1917a52785?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "plant-room", "name": "Plant Room", "category": "interior", "credit": "Spacejoy", "background": "url(\"https://images.unsplash.com/photo-1634547588713-edd93045b9f1?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "soft-seating", "name": "Soft Seating", "category": "interior", "credit": "Spacejoy", "background": "url(\"https://images.unsplash.com/photo-1634547532213-a4b8d7ff8927?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "window-room", "name": "Window Room", "category": "interior", "credit": "Spacejoy", "background": "url(\"https://images.unsplash.com/photo-1634547476021-c1155c01616c?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "afternoon-lounge", "name": "Afternoon Lounge", "category": "interior", "credit": "Spacejoy", "background": "url(\"https://images.unsplash.com/photo-1633505899118-4ca6bd143043?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "restful-bedroom", "name": "Restful Bedroom", "category": "interior", "credit": "Spacejoy", "background": "url(\"https://images.unsplash.com/photo-1633505765486-e404bbbec654?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "table-for-two", "name": "Table for Two", "category": "interior", "credit": "Spacejoy", "background": "url(\"https://images.unsplash.com/photo-1633505528166-407a12a88a04?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "window-table", "name": "Window Table", "category": "interior", "credit": "Spacejoy", "background": "url(\"https://images.unsplash.com/photo-1633505412556-82c0921e8f4a?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "slow-afternoon", "name": "Slow Afternoon", "category": "interior", "credit": "Spacejoy", "background": "url(\"https://images.unsplash.com/photo-1632830196000-d8a1abf32691?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "indoor-garden", "name": "Indoor Garden", "category": "interior", "credit": "Spacejoy", "background": "url(\"https://images.unsplash.com/photo-1632830025328-cce71800b9ec?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "fireside-room", "name": "Fireside Room", "category": "interior", "credit": "Spacejoy", "background": "url(\"https://images.unsplash.com/photo-1632829882891-5047ccc421bc?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "blue-bedroom", "name": "Blue Bedroom", "category": "interior", "credit": "Spacejoy", "background": "url(\"https://images.unsplash.com/photo-1632829401795-2745c905ac77?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
  {"id": "dark-retreat", "name": "Dark Retreat", "category": "interior", "credit": "Spacejoy", "background": "url(\"https://images.unsplash.com/photo-1632210702485-e1841e30752a?auto=format&fit=crop&w=2400&q=80\") center / cover no-repeat"},
];

export const findTheme = (id: string) => THEMES.find((t) => t.id === id);

// Local custom-background metadata and image processing.
export interface CustomBackground { id: string; name: string; size?: number }
export const customBgs = createStore<CustomBackground[]>("customBgs", []);
const MAX_BYTES = 15 * 1024 * 1024;

export function validateBackgroundFile(file: Pick<File, "type" | "size">): string | null {
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) return "Choose a JPG, PNG, WebP, or GIF image.";
  if (file.size > MAX_BYTES) return "Choose an image no larger than 15 MB.";
  if (!file.size) return "This image is empty. Choose another file.";
  return null;
}

export function fitBackgroundSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("This image has invalid dimensions.");
  const scale = Math.min(1, 2560 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Read encoded headers only: never allocate a bitmap until its dimensions pass. */
export function backgroundDimensions(bytes: ArrayBuffer): { width: number; height: number } {
  const data = new DataView(bytes), u8 = new Uint8Array(bytes);
  const ascii = (offset: number, length: number) => String.fromCharCode(...u8.subarray(offset, offset + length));
  const invalid = () => new Error("Could not read image dimensions. Choose a valid JPG, PNG, WebP, or GIF.");
  const check = (width: number, height: number) => {
    if (!width || !height) throw invalid();
    if (width > 12000 || height > 12000 || width * height > 50_000_000) throw new Error("Image exceeds 12000 × 12000 pixels or 50 megapixels. Resize it before uploading.");
    return { width, height };
  };
  if (u8.length >= 24 && data.getUint32(0) === 0x89504e47 && data.getUint32(4) === 0x0d0a1a0a && ascii(12, 4) === "IHDR") {
    return check(data.getUint32(16), data.getUint32(20));
  }
  if (u8.length >= 10 && ["GIF87a", "GIF89a"].includes(ascii(0, 6))) return check(data.getUint16(6, true), data.getUint16(8, true));
  if (u8.length >= 4 && data.getUint16(0) === 0xffd8) {
    let offset = 2;
    while (offset + 1 < u8.length) {
      if (u8[offset++] !== 0xff) throw invalid();
      while (u8[offset] === 0xff) offset++;
      const marker = u8[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > u8.length) break;
      const size = data.getUint16(offset);
      if (size < 2 || offset + size > u8.length) break;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && size >= 7) {
        return check(data.getUint16(offset + 5), data.getUint16(offset + 3));
      }
      offset += size;
    }
    throw invalid();
  }
  if (u8.length >= 20 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    let dimensions: { width: number; height: number } | undefined;
    const uint24 = (offset: number) => u8[offset] + u8[offset + 1] * 256 + u8[offset + 2] * 65536;
    for (let offset = 12; offset + 8 <= u8.length;) {
      const kind = ascii(offset, 4), size = data.getUint32(offset + 4, true), start = offset + 8;
      if (start + size > u8.length) throw invalid();
      let next: { width: number; height: number } | undefined;
      if (kind === "VP8X" && size >= 10) next = check(1 + uint24(start + 4), 1 + uint24(start + 7));
      if (kind === "VP8 " && size >= 10 && ascii(start + 3, 3) === "\x9d\x01\x2a") next = check(data.getUint16(start + 6, true) & 0x3fff, data.getUint16(start + 8, true) & 0x3fff);
      if (kind === "VP8L" && size >= 5 && u8[start] === 0x2f) {
        const bits = data.getUint32(start + 1, true);
        next = check((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      }
      if (kind === "ANMF" && size >= 16) check(1 + uint24(start + 6), 1 + uint24(start + 9));
      if (next) dimensions ??= next;
      offset = start + size + (size % 2);
    }
    if (dimensions) return dimensions;
  }
  throw invalid();
}

export const BACKGROUND_LIMITS = { count: 12, bytes: 60 * 1024 * 1024, reserve: 20 * 1024 * 1024 };

export function backgroundCapacityError(items: CustomBackground[], bytes: number, estimate?: StorageEstimate): string | null {
  if (items.length >= BACKGROUND_LIMITS.count) return "You can save up to 12 backgrounds. Delete an image before uploading another.";
  if (items.reduce((total, item) => total + (item.size ?? 0), 0) + bytes > BACKGROUND_LIMITS.bytes) return "Saved backgrounds are limited to 60 MB total. Delete an image or upload a smaller one.";
  if (Number.isFinite(estimate?.quota) && Number.isFinite(estimate?.usage) && estimate!.quota! - estimate!.usage! - bytes < BACKGROUND_LIMITS.reserve) return "Not enough browser storage: uploads must leave at least 20 MB free. Free some space and try again.";
  return null;
}

async function storageEstimate(): Promise<StorageEstimate | undefined> {
  try { return typeof navigator !== "undefined" ? await navigator.storage?.estimate?.() : undefined; }
  catch { return undefined; } // Browsers may disable quota reporting; IndexedDB still checks the write.
}

let uploadQueue: Promise<unknown> = Promise.resolve();
/** Serialize uploads and count legacy backgrounds using their stored blob sizes. */
export function saveCustomBackground(file: File): Promise<CustomBackground> {
  const save = uploadQueue.then(async () => {
    await customBgs.ready;
    const items = await Promise.all(customBgs.get().map(async (item) => ({
      ...item, size: (await dbGet<Blob>(`custom-bg:${item.id}`))?.size ?? 0,
    })));
    customBgs.set((current) => current.map((item) => ({ ...item, size: items.find((saved) => saved.id === item.id)?.size ?? item.size })));
    const early = backgroundCapacityError(customBgs.get(), 0, await storageEstimate());
    if (early) throw new Error(early);
    const blob = await prepareBackground(file);
    const error = backgroundCapacityError(customBgs.get(), blob.size, await storageEstimate());
    if (error) throw new Error(error);
    const bg = { id: uid(), name: file.name.replace(/\.[^.]+$/, "") || "Untitled image", size: blob.size };
    try {
      await dbSet(`custom-bg:${bg.id}`, blob);
      const stored = await dbGet<Blob>(`custom-bg:${bg.id}`);
      if (!(stored instanceof Blob) || stored.size !== blob.size) throw new Error("Could not save the image. Free some browser storage and try again.");
      customBgs.set((current) => [...current, bg]);
      return bg;
    } catch (cause) {
      await dbDel(`custom-bg:${bg.id}`);
      throw cause;
    }
  });
  uploadQueue = save.catch(() => {});
  return save;
}

export async function prepareBackground(file: File): Promise<Blob> {
  const error = validateBackgroundFile(file);
  if (error) throw new Error(error);
  backgroundDimensions(await file.arrayBuffer());
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth > 12000 || image.naturalHeight > 12000 || image.naturalWidth * image.naturalHeight > 50_000_000) throw new Error("Image exceeds 12000 × 12000 pixels or 50 megapixels. Resize it before uploading.");
    const { width, height } = fitBackgroundSize(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is unavailable in this browser.");
    context.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Could not resize this image. Try a different one.")), "image/webp", 0.9,
    ));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A deleted upload must never leave dangling references in any dashboard mode. */
export async function removeCustomBackground(id: string) {
  const themes = { ...settings.get().themes };
  for (const mode of ["home", "focus", "ambient"] as const) {
    if (themes[mode].kind === "custom" && themes[mode].id === id) themes[mode] = { kind: "library", id: "dusk-glass" };
  }
  settingsUpdate("themes", themes);
  await dbDel(`custom-bg:${id}`);
  if (await dbGet(`custom-bg:${id}`) !== undefined) throw new Error("Could not delete this image. Please try again.");
  customBgs.set((items) => items.filter((item) => item.id !== id));
}
