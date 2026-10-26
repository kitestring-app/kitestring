import { useState } from "react";
import { QUOTE_CATEGORIES, QUOTES, dailyQuoteCategory, quoteForDay } from "../../data/quotes";
import { useStore } from "../../lib/store";
import { settings, settingsUpdate } from "../../state/settings";
import { useClock } from "../ClockView";
import { Toggle } from "./SettingsDrawer";

export function QuotesTab() {
  const quotes = useStore(settings, (s) => s.quotes);
  const [preview, setPreview] = useState({ category: quotes.category, offset: 0 });
  const offset = preview.category === quotes.category ? preview.offset : 0;
  const now = useClock(false);
  const category = dailyQuoteCategory(quotes.category, now, quotes.randomCategory);
  const quote = quoteForDay(category, now, offset);
  const poolSize = category === "all" ? QUOTES.length : QUOTES.filter((q) => q.category === category).length;
  return (
    <>
      <h1>Quotes</h1>
      <p className="lede">A few words to come back to.</p>
      <section className="card" aria-labelledby="quote-settings-heading">
        <h3 id="quote-settings-heading">Your daily quote</h3>
        <p className="help">A new quote each day, chosen from your category.</p>
        <label htmlFor="quote-category">Category</label>
        <select id="quote-category" disabled={quotes.randomCategory} className="input" style={{ margin: "8px 0 16px" }} value={quotes.category} onChange={(e) => {
          settingsUpdate("quotes", { category: e.target.value }); setPreview({ category: e.target.value, offset: 0 });
        }}>
          {QUOTE_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <Toggle title="Shuffle quote categories daily" help="Pick a category each day. Turn this off to return to your chosen category." checked={quotes.randomCategory} onChange={(randomCategory) => { settingsUpdate("quotes", { randomCategory }); setPreview({ category: quotes.category, offset: 0 }); }} />
        {quotes.randomCategory && <p className="help">Today: {QUOTE_CATEGORIES.find(c => c.id === category)?.label}</p>}
        <Toggle title="Show quotes in Focus mode" checked={quotes.inFocus} onChange={(inFocus) => settingsUpdate("quotes", { inFocus })} />
        <Toggle title="Show quotes in Home" checked={quotes.inHome} onChange={(inHome) => settingsUpdate("quotes", { inHome })} />
      </section>
      <section className="card" aria-labelledby="quote-preview-heading">
        <h3 id="quote-preview-heading">{offset ? "Shuffle preview" : "Today's quote"}</h3>
        <div aria-live="polite" aria-atomic="true">
          {quote ? <blockquote style={{ margin: "24px 0", maxWidth: 640 }}>
            <p style={{ fontSize: 21, lineHeight: 1.6 }}>“{quote.text}”</p>
            <footer className="muted">— {quote.author}<cite className="small" style={{ display: "block", marginTop: 4 }}>{quote.source}</cite></footer>
          </blockquote> : <p className="muted">Choose a category to preview a quote.</p>}
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button className="btn" disabled={poolSize < 2} onClick={() => setPreview({ category: quotes.category, offset: offset + 1 + Math.floor(Math.random() * (poolSize - 1)) })}>Shuffle preview</button>
          {offset !== 0 && <button className="btn small" onClick={() => setPreview({ category: quotes.category, offset: 0 })}>Back to today's quote</button>}
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>Shuffling changes this preview only. Your dashboard keeps today's quote.</p>
      </section>
    </>
  );
}
