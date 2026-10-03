"use client";

/** Prints the current page (navigation and forms are hidden by the print styles). */
export function PrintButton({ label }: { label: string }) {
  return <button type="button" className="no-print" onClick={() => window.print()}>{label}</button>;
}
