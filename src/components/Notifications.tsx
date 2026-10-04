"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";

export type NotificationItem = { href: string; icon: IconName; title: string; tone: "warning" | "info" | "danger" };

const TONE: Record<NotificationItem["tone"], string> = {
  warning: "bg-amber-50 text-amber-600 ring-amber-100",
  info: "bg-primary-50 text-primary-600 ring-primary-100",
  danger: "bg-rose-50 text-rose-600 ring-rose-100",
};

/** Bell in the top bar: what is waiting for this user, one click away. */
export function Notifications({ items, label, empty }: { items: NotificationItem[]; label: string; empty: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" className="ghost icon-btn relative !rounded-full" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="bell" />
        {items.length > 0 && <span className="absolute top-1 end-1 size-2 rounded-full bg-rose-500 ring-2 ring-white" />}
      </button>
      {open && (
        <div className="absolute end-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop">
          <div className="border-b border-slate-100 px-4 py-3 text-[13px] font-semibold text-slate-900">{label}</div>
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-slate-500">
              <Icon name="checkCircle" className="mx-auto mb-2 !size-6 text-emerald-500" />
              {empty}
            </div>
          ) : (
            <ul className="m-0 list-none p-1.5">
              {items.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900">
                    <span className={`grid size-8 flex-none place-items-center rounded-lg ring-1 ring-inset ${TONE[n.tone]}`}><Icon name={n.icon} size={16} /></span>
                    <span className="min-w-0 flex-1">{n.title}</span>
                    <Icon name="chevronRight" size={15} className="text-slate-300" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
