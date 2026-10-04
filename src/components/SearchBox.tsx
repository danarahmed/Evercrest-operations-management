"use client";
import { useEffect, useRef } from "react";
import { Icon } from "./icons";

/** The one search box at the top of every page. Ctrl+K (or /) jumps to it from anywhere. */
export function SearchBox({ action, placeholder, label, defaultValue }: { action: string; placeholder: string; label: string; defaultValue?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form action={action} method="get" role="search" className="flex min-w-0 max-w-[560px] flex-1 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 text-slate-500 transition focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary-500/12">
      <Icon name="search" />
      <input
        ref={ref}
        name="q"
        type="search"
        defaultValue={defaultValue}
        aria-label={label}
        placeholder={placeholder}
        className="!min-w-0 flex-1 !border-0 !bg-transparent !px-0 !py-2.5 !shadow-none !ring-0"
      />
      <kbd className="hidden rounded-md border border-slate-200 bg-slate-100 px-1.5 text-[11.5px] font-bold text-slate-500 sm:inline">Ctrl K</kbd>
    </form>
  );
}
