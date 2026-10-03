"use client";

/** Shown when a page fails (e.g. missing permission). Details stay in the server log. */
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main>
      <h1>Something went wrong · هەڵەیەک ڕوویدا · حدث خطأ</h1>
      <p className="muted">You may not have access to this page, or the record does not exist.</p>
      <button onClick={reset}>↻</button>
    </main>
  );
}
