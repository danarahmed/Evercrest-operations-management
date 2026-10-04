"use client";
import { type ReactNode, useEffect, useRef } from "react";

/**
 * A collapsible group in the side navigation. Remembers per browser which
 * groups the user closed; the group holding the current page always opens.
 */
export function NavSection({ id, label, active, children }: { id: string; label: string; active: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const storageKey = `nav:${id}`;
  useEffect(() => {
    if (active || !ref.current) return;
    try {
      if (localStorage.getItem(storageKey) === "closed") ref.current.open = false;
    } catch {}
  }, [active, storageKey]);
  return (
    <details
      ref={ref}
      open
      className="group/sec mt-5"
      onToggle={(e) => {
        try {
          localStorage.setItem(storageKey, (e.currentTarget as HTMLDetailsElement).open ? "open" : "closed");
        } catch {}
      }}
    >
      <summary className="nav-sec-label flex cursor-pointer list-none items-center justify-between rounded-md px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-slate-500 transition-colors select-none hover:text-slate-300 [&::-webkit-details-marker]:hidden">
        {label}
        <svg viewBox="0 0 24 24" className="size-3.5 fill-none stroke-current stroke-2 transition-transform duration-200 group-open/sec:rotate-90 rtl:-scale-x-100" aria-hidden="true">
          <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="mt-1 grid gap-0.5">{children}</div>
    </details>
  );
}
