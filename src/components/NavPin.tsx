"use client";
import { useState } from "react";
import { Icon } from "./icons";

/**
 * Pins the side menu open or lets it fold back into the icon rail. The
 * choice is a cookie so the server renders the right state on the next page.
 */
export function NavPin({ pinned, pinLabel, unpinLabel }: { pinned: boolean; pinLabel: string; unpinLabel: string }) {
  const [open, setOpen] = useState(pinned);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    document.cookie = `nav=${next ? "open" : "rail"}; path=/; max-age=31536000; samesite=lax`;
    document.querySelector(".app-shell")?.setAttribute("data-nav", next ? "open" : "rail");
  };
  return (
    <button type="button" className="nav-pin ghost icon-btn" onClick={toggle} title={open ? unpinLabel : pinLabel} aria-label={open ? unpinLabel : pinLabel} aria-pressed={open}>
      <Icon name={open ? "chevronLeft" : "chevronRight"} size={16} />
    </button>
  );
}
