const CONTROL = "button[aria-label], a[aria-label]";

/** Fit a measured tooltip inside the viewport, preferring above the control. */
export function tooltipPosition(anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom">, width: number, height: number, viewport: { width: number; height: number }) {
  const edge = 8, gap = 8;
  const above = anchor.top - height - gap;
  const top = above >= edge ? above : anchor.bottom + gap;
  return {
    left: Math.max(edge, Math.min((anchor.left + anchor.right - width) / 2, viewport.width - width - edge)),
    top: Math.max(edge, Math.min(top, viewport.height - height - edge)),
  };
}

/** One delegated tooltip layer covers dashboard controls, drawers and new panel content. */
export function installTooltips(doc: Document = document): () => void {
  const win = doc.defaultView!;
  const tip = doc.createElement("div");
  tip.className = "control-tooltip";
  tip.setAttribute("role", "tooltip");
  // The control already has this exact accessible name; don't announce it twice.
  tip.setAttribute("aria-hidden", "true");
  tip.setAttribute("popover", "manual");
  tip.hidden = true;
  doc.body.append(tip);
  let anchor: HTMLElement | null = null;
  let pending: ReturnType<typeof setTimeout> | undefined;

  const prepare = (control: HTMLElement) => {
    const label = control.getAttribute("aria-label")?.trim();
    if (!label) { control.removeAttribute("data-tip"); return; }
    control.dataset.tip = label;
    control.removeAttribute("title");
  };
  const scan = (root: ParentNode) => root.querySelectorAll<HTMLElement>(CONTROL).forEach(prepare);
  scan(doc);

  const hide = () => {
    clearTimeout(pending);
    pending = undefined;
    if (tip.matches(":popover-open")) tip.hidePopover();
    tip.hidden = true;
    anchor = null;
  };
  const usable = (control: HTMLElement) => control.isConnected && !control.closest('[hidden], [inert], .app.idle .chrome') && control.getClientRects().length > 0;
  const show = () => {
    pending = undefined;
    if (win.matchMedia?.("(pointer: coarse)").matches || !anchor || !usable(anchor)) return hide();
    prepare(anchor);
    if (!anchor.dataset.tip) return hide();
    tip.textContent = anchor.dataset.tip;
    tip.hidden = false;
    // The top layer avoids clipping inside scrollable panels and modal dialogs.
    if (typeof tip.showPopover === "function" && !tip.matches(":popover-open")) tip.showPopover();
    const viewport = win.visualViewport;
    const width = viewport?.width ?? win.innerWidth, height = viewport?.height ?? win.innerHeight;
    const offsetLeft = viewport?.offsetLeft ?? 0, offsetTop = viewport?.offsetTop ?? 0;
    tip.style.maxWidth = `${Math.max(0, width - 16)}px`;
    tip.style.maxHeight = `${Math.max(0, height - 16)}px`;
    const rect = anchor.getBoundingClientRect();
    const position = tooltipPosition({ left: rect.left - offsetLeft, right: rect.right - offsetLeft, top: rect.top - offsetTop, bottom: rect.bottom - offsetTop }, tip.offsetWidth, tip.offsetHeight, { width, height });
    tip.style.left = `${position.left + (viewport?.offsetLeft ?? 0)}px`;
    tip.style.top = `${position.top + (viewport?.offsetTop ?? 0)}px`;
  };
  const find = (target: EventTarget | null) => target instanceof win.Element ? target.closest<HTMLElement>(CONTROL) : null;
  const enter = (event: Event) => {
    if ((event as PointerEvent).pointerType === "touch" || win.matchMedia?.("(pointer: coarse)").matches) return hide();
    const control = find(event.target);
    if (!control) return;
    if (control === anchor) {
      if (event.type === "focusin" && control.matches(":focus-visible")) { clearTimeout(pending); show(); }
      return;
    }
    hide();
    prepare(control);
    anchor = control;
    if (event.type === "focusin") {
      if (control.matches(":focus-visible")) show();
      else anchor = null;
    } else pending = setTimeout(show, 300);
  };
  const leave = (event: Event) => {
    const next = (event as MouseEvent).relatedTarget;
    if (anchor && event.target instanceof win.Node && anchor.contains(event.target) && !(next instanceof win.Node && anchor.contains(next))) {
      if (event.type === "pointerout" && doc.activeElement === anchor && anchor.matches(":focus-visible")) return;
      hide();
    }
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !anchor) return;
    hide();
    // Dismiss the tip first; a second Escape can close its panel or dialog.
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const observer = new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === "childList") {
        change.addedNodes.forEach((node) => {
          if (!(node instanceof win.HTMLElement)) return;
          if (node.matches(CONTROL)) prepare(node);
          scan(node);
        });
      } else if (change.target instanceof win.HTMLElement && change.target.matches("button, a")) prepare(change.target);
    }
    if (anchor) {
      if (!usable(anchor) || !anchor.dataset.tip) hide();
      else if (!tip.hidden && tip.textContent !== anchor.dataset.tip) show();
    }
  });
  observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-label", "title", "hidden", "inert", "class"] });
  doc.addEventListener("pointerover", enter, true);
  doc.addEventListener("pointerout", leave, true);
  doc.addEventListener("focusin", enter, true);
  doc.addEventListener("focusout", leave, true);
  doc.addEventListener("pointerdown", hide, true);
  doc.addEventListener("scroll", hide, true);
  win.addEventListener("keydown", escape, true);
  win.addEventListener("blur", hide);
  win.addEventListener("resize", hide);
  win.visualViewport?.addEventListener("resize", hide);
  win.visualViewport?.addEventListener("scroll", hide);
  return () => {
    hide();
    observer.disconnect();
    doc.removeEventListener("pointerover", enter, true);
    doc.removeEventListener("pointerout", leave, true);
    doc.removeEventListener("focusin", enter, true);
    doc.removeEventListener("focusout", leave, true);
    doc.removeEventListener("pointerdown", hide, true);
    doc.removeEventListener("scroll", hide, true);
    win.removeEventListener("keydown", escape, true);
    win.removeEventListener("blur", hide);
    win.removeEventListener("resize", hide);
    win.visualViewport?.removeEventListener("resize", hide);
    win.visualViewport?.removeEventListener("scroll", hide);
    tip.remove();
  };
}
