import { useClock } from "./ClockView";
import { useStore } from "../lib/store";
import { settings } from "../state/settings";
import { dailyQuoteCategory, quoteForDay } from "../data/quotes";

/** One quote per day (stable across reloads), filtered by the chosen category. */
export function QuoteLine() {
  const quotes = useStore(settings, s => s.quotes);
  const now = useClock(false);
  const category = dailyQuoteCategory(quotes.category, now, quotes.randomCategory);
  const q = quoteForDay(category, now);
  if (!q) return null;
  return (
    <blockquote className="quote chrome">
      “{q.text}”<cite>— {q.author}</cite>
    </blockquote>
  );
}
