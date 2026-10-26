import { expect } from "vitest";

/** Shared journey gate: assert real rendered geometry, including clipped/scrolling cards. */
export async function assertFocusFit(evaluate: (expression: string) => Promise<any>, pinMayScroll = false) {
  const layout = await evaluate(`(() => {
    const rect = e => { const r = e.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}; };
    const card = document.querySelector('.recovery-card');
    const content = card?.querySelector('.focus-card-body') ?? card;
    const blockers = ['.next-action', '.controls', '.dock', '.bottombar'].map(selector => ({selector, rect:rect(document.querySelector(selector))}));
    const r = card ? rect(card) : rect(document.querySelector('.start-support'));
    const intersects = b => r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
    return {look:document.documentElement.dataset.look, width:innerWidth, height:innerHeight,
      count:document.querySelectorAll('.recovery-card').length, rect:r,
      pinButtonsVisible:[...document.querySelectorAll('.next-action-buttons button')].every(b=>{const p=document.querySelector('.next-action').getBoundingClientRect(),r=b.getBoundingClientRect();return r.top>=p.top && r.bottom<=p.bottom+1}),
      hits:blockers.filter(b => intersects(b.rect)).map(b=>b.selector),
      quoteFits:[...document.querySelectorAll('.focus-center > .quote')].every(q=>{const r=q.getBoundingClientRect();return r.height===0 || r.bottom<=document.querySelector('.bottombar').getBoundingClientRect().top;}),
      cardButtonsVisible:!card || [...card.querySelectorAll('button')].every(b=>{const c=rect(card),r=rect(b);return r.top>=c.top && r.bottom<=c.bottom;}),
      flow:card ? getComputedStyle(card).position : 'static',
      quote:!!card && !![...document.querySelectorAll('.focus-center > .quote')].find(q=>q.getBoundingClientRect().height > 0),
      iconFilter:card ? getComputedStyle(card.querySelector('button[aria-label="Close"] svg')).filter : 'none',
      pageOverflow:document.documentElement.scrollHeight > innerHeight || document.documentElement.scrollWidth > innerWidth,
      scroll:card ? {client:content.clientHeight, content:content.scrollHeight, overflow:getComputedStyle(content).overflowY} : null};
  })()`);
  if (!pinMayScroll) expect(layout.pinButtonsVisible, JSON.stringify(layout)).toBe(true);
  expect(layout.hits, JSON.stringify(layout)).toEqual([]);
  expect(layout.cardButtonsVisible, JSON.stringify(layout)).toBe(true);
  expect(layout.count, JSON.stringify(layout)).toBeLessThanOrEqual(1);
  expect(["static", "relative"]).toContain(layout.flow);
  expect(layout.rect.top, JSON.stringify(layout)).toBeGreaterThanOrEqual(0);
  expect(layout.rect.bottom, JSON.stringify(layout)).toBeLessThanOrEqual(layout.height);
  expect(layout.rect.width, JSON.stringify(layout)).toBeLessThanOrEqual(460);
  expect(layout.rect.height, JSON.stringify(layout)).toBeGreaterThan(30);
  expect(layout.quoteFits, JSON.stringify(layout)).toBe(true);
  expect(layout.quote, JSON.stringify(layout)).toBe(false);
  expect(layout.pageOverflow, JSON.stringify(layout)).toBe(false);
  if (layout.scroll) expect(layout.scroll.client, JSON.stringify(layout)).toBeGreaterThanOrEqual(16);
  if (layout.look === "sketch") expect(layout.iconFilter, JSON.stringify(layout)).toBe("none");
  return layout;
}
