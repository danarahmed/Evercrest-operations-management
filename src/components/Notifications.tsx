"use client";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";

export type NotificationItem = { href: string; icon: IconName; title: string; tone: "warning" | "info" | "danger" };

const TONE: Record<NotificationItem["tone"], string> = {
  warning: "bg-amber-50 text-amber-600",
  info: "bg-sky-50 text-sky-600",
  danger: "bg-rose-50 text-rose-600",
};

/** A small popover that closes on outside click or Escape. */
function usePopover() {
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
  return { open, setOpen, ref };
}

/** Bell in the top bar: what is waiting for this user, one click away. */
export function Notifications({ items, label, empty }: { items: NotificationItem[]; label: string; empty: string }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div ref={ref} className="relative">
      <button type="button" className="relative !rounded-xl !p-2.5" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="bell" />
        {items.length > 0 && <span className="absolute top-2 end-2 size-2 rounded-full bg-amber-500 ring-2 ring-white" />}
      </button>
      {open && (
        <div className="absolute end-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop">
          <div className="border-b border-slate-100 px-4 py-3 text-[14px] font-extrabold text-slate-900">{label}</div>
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13.5px] text-slate-500">
              <Icon name="checkCircle" className="mx-auto mb-2 !size-6 text-emerald-600" />
              {empty}
            </div>
          ) : (
            <ul className="m-0 list-none p-2">
              {items.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-[13.5px] font-bold text-slate-800 hover:bg-slate-50 hover:text-slate-900">
                    <span className={`grid size-9 flex-none place-items-center rounded-[10px] ${TONE[n.tone]}`}><Icon name={n.icon} size={16} /></span>
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

/** "+ New" in the side menu: the common things to start, from anywhere. */
export function NewMenu({ label, items }: { label: ReactNode; items: { href: string; icon: IconName; label: string }[] }) {
  const { open, setOpen, ref } = usePopover();
  if (!items.length) return null;
  return (
    <div ref={ref} className="relative mb-2">
      <button type="button" className="primary w-full !py-2.5" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="plus" />
        {label}
      </button>
      {open && (
        <ul className="absolute inset-x-0 top-full z-50 m-0 mt-2 list-none overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-pop">
          {items.map((n) => (
            <li key={n.href}>
              <Link href={n.href} onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-bold text-slate-800 hover:bg-slate-50 hover:text-slate-900">
                <span className="grid size-8 flex-none place-items-center rounded-[10px] bg-primary-50 text-primary-500"><Icon name={n.icon} size={16} /></span>
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
