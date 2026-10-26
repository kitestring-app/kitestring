import "./Credits.css";
import { Glyph } from "./Glyph";

// Same support links as praxstack/markdown-viewer-app's README.
// The Mac app opens https links from target=_blank in the default browser.
export const SUPPORT_LINKS = [
  { href: "https://github.com/kitestring-app/kitestring", label: "GitHub" },
  { href: "https://github.com/sponsors/PrakharMNNIT", label: "Sponsor" },
  { href: "https://ko-fi.com/praxlannister", label: "Buy me a coffee" },
  { href: "https://razorpay.me/@prakharshekharparthasarthi", label: "UPI" },
];

export function Credits() {
  return (
    <p className="credits">
      <span className="credits-made">
        Made with <span className="credits-heart"><Glyph name="heart" size={12} filled title="love" /></span> by{" "}
        <a href="https://github.com/praxstack" target="_blank" rel="noopener noreferrer">Prax</a>
      </span>
      <span className="credits-links">
        {SUPPORT_LINKS.map((l) => (
          <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
        ))}
      </span>
    </p>
  );
}
