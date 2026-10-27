"use client";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";

/**
 * A dialog that is open because the URL says so (e.g. ?trip=<id>). Closing it
 * goes back to the same page without that parameter; a successful save inside
 * closes it too, so the refreshed list is visible right away.
 */
export function OpenDialog({ title, closeHref, size = "lg", children }: { title: ReactNode; closeHref: string; size?: "sm" | "lg"; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    const back = () => router.push(closeHref);
    const done = () => setTimeout(() => d.close(), 350);
    d.addEventListener("close", back);
    d.addEventListener("actionform:success", done);
    return () => {
      d.removeEventListener("close", back);
      d.removeEventListener("actionform:success", done);
    };
  }, [closeHref, router]);
  return (
    <dialog ref={ref} className={`modal ${size}`} onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
      <div className="modal-head">
        <div className="modal-title">{title}</div>
        <button type="button" className="ghost icon-btn" aria-label="Close" onClick={() => ref.current?.close()}>
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
