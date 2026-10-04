"use client";

/** Prints the current page (navigation, buttons and forms are hidden by the print styles). */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className="no-print" onClick={() => window.print()}>
      <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" /></svg>
      {label}
    </button>
  );
}
