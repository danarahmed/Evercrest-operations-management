"use client";
import { type ReactNode, useEffect, useRef } from "react";

/**
 * A button that opens a dialog with a form. The dialog closes by itself after
 * the form inside saves successfully (ActionForm announces it), so the user
 * sees the updated page right away.
 */
export function Modal({ label, title, icon, variant = "secondary", size, children, small }: {
  label: ReactNode;
  title?: ReactNode;
  icon?: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "lg";
  small?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const done = () => setTimeout(() => d.close(), 350);
    d.addEventListener("actionform:success", done);
    return () => d.removeEventListener("actionform:success", done);
  }, []);
  const cls = `${variant === "secondary" ? "" : variant}${small ? " sm" : ""}`.trim();
  return (
    <>
      <button type="button" className={cls || undefined} onClick={() => ref.current?.showModal()}>
        {icon}
        {label}
      </button>
      <dialog ref={ref} className={`modal${size ? ` ${size}` : ""}`} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
        <div className="modal-head">
          <div className="modal-title">{title ?? label}</div>
          <button type="button" className="ghost icon-btn" aria-label="Close" onClick={() => ref.current?.close()}>
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </dialog>
    </>
  );
}
