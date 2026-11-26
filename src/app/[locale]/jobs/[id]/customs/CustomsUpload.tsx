"use client";
import { useTranslations } from "next-intl";
import { type FormEvent, startTransition, useActionState } from "react";
import { type UploadState, uploadCustomsSheet } from "./actions";

/** Choose the border person's statement and go to the truck-by-truck comparison. */
export function CustomsUpload({ locale, jobId, idempotencyKey }: { locale: string; jobId: string; idempotencyKey: string }) {
  const t = useTranslations("Customs");
  const c = useTranslations("Claims");
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadCustomsSheet, {});
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  };
  return (
    <form onSubmit={onSubmit} className="form">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="key" value={idempotencyKey} />
      <p className="muted !m-0">{t("uploadHelp")}</p>
      <label>{c("file")}<input type="file" name="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required /></label>
      {state.error && <div className="form-msg error" role="alert">{c.has(`err_${state.error}`) ? c(`err_${state.error}`) : state.error}</div>}
      <div className="form-actions"><button type="submit" className="primary" disabled={pending}>{pending ? c("reading") : c("compare")}</button></div>
    </form>
  );
}
