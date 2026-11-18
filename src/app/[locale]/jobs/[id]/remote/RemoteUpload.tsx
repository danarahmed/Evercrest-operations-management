"use client";
import { useTranslations } from "next-intl";
import { type FormEvent, startTransition, useActionState } from "react";
import { type UploadState, uploadRemoteSheet } from "./actions";

/** Choose the site's settlement sheet, say when and from which box the drivers were paid, and go to the comparison. */
export function RemoteUpload({ locale, jobId, idempotencyKey, moneyAccounts }: { locale: string; jobId: string; idempotencyKey: string; moneyAccounts: { id: string; name: string; currency: string }[] }) {
  const t = useTranslations("Claims");
  const f = useTranslations("Forms");
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadRemoteSheet, {});
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
      <p className="muted !m-0">{t("remoteUploadHelp")}</p>
      <label>{t("file")}<input type="file" name="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required /></label>
      <div className="grid2">
        <label>{t("remoteDate")}<input type="date" name="settlementDate" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
        <label>{t("paidFrom")}<select name="moneyAccountId" required defaultValue="">{[<option key="" value="">{t("chooseBox")}</option>, ...moneyAccounts.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)]}</select></label>
      </div>
      {state.error && <div className="form-msg error" role="alert">{t.has(`err_${state.error}`) ? t(`err_${state.error}`) : state.error}</div>}
      <div className="form-actions"><button type="submit" className="primary" disabled={pending}>{pending ? t("reading") : t("compare")}</button></div>
    </form>
  );
}
