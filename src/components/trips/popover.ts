"use client";
import { useEffect, useRef } from "react";

/**
 * Keeps a <details> popover usable inside a scrolling table: the panel is
 * fixed-positioned under its summary so the table's overflow cannot clip it,
 * only one is open at a time, and it closes on an outside click, Escape, or
 * follows its summary when the page or the table scrolls.
 */
export function usePopover() {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    const pop = details.querySelector<HTMLElement>(":scope > .pop");
    const summary = details.querySelector<HTMLElement>(":scope > summary");
    if (!pop || !summary) return;

    const place = () => {
      const r = summary.getBoundingClientRect();
      const rtl = getComputedStyle(details).direction === "rtl";
      const width = Math.min(320, window.innerWidth - 16);
      let left = rtl ? r.right - width : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 240 && above > below;
      pop.style.position = "fixed";
      pop.style.left = `${left}px`;
      pop.style.right = "auto";
      pop.style.width = `${width}px`;
      if (up) {
        pop.style.top = "auto";
        pop.style.bottom = `${window.innerHeight - r.top + 4}px`;
        pop.style.maxHeight = `${Math.min(360, above)}px`;
      } else {
        pop.style.bottom = "auto";
        pop.style.top = `${r.bottom + 4}px`;
        pop.style.maxHeight = `${Math.min(360, Math.max(160, below))}px`;
      }
    };
    const close = () => { details.open = false; };
    const onToggle = () => {
      if (!details.open) return;
      document.querySelectorAll<HTMLDetailsElement>("details.pop-host[open]").forEach((d) => { if (d !== details) d.open = false; });
      place();
    };
    const onDown = (e: PointerEvent) => { if (details.open && !details.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && details.open) close(); };
    // The page or the table may scroll under an open panel: follow the summary instead of closing.
    const onScroll = (e: Event) => { if (details.open && !(pop.contains(e.target as Node))) place(); };
    details.addEventListener("toggle", onToggle);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      details.removeEventListener("toggle", onToggle);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, []);

  return ref;
}
