"use client";
import { useTranslations } from "next-intl";
import { type FormEvent, startTransition, useActionState } from "react";
import { type UploadState, uploadTripSheet } from "./actions";

/** Choose the loading sheet (.xlsx) and go to its preview. */
export function ImportUpload({ locale, jobId, idempotencyKey }: { locale: string; jobId: string; idempotencyKey: string }) {
  const t = useTranslations("Import");
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadTripSheet, {});
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
      <label>{t("file")}<input type="file" name="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required /></label>
      {state.error && <div className="form-msg error" role="alert">{t.has(`err_${state.error}`) ? t(`err_${state.error}`) : state.error}</div>}
      <div className="form-actions"><button type="submit" className="primary" disabled={pending}>{pending ? t("reading") : t("preview")}</button></div>
    </form>
  );
}
