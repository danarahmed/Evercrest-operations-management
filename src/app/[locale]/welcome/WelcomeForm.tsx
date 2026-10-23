"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type FormEvent, startTransition, useActionState } from "react";
import { runFirstSetup } from "./actions";

export function WelcomeForm({ locale }: { locale: string }) {
  const t = useTranslations("Welcome");
  const [state, action, pending] = useActionState(runFirstSetup, {});
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  };
  if (state.done)
    return (
      <div className="grid gap-4">
        <div className="form-msg ok" role="status">{state.done.passwordSet ? t("doneReady", { email: state.done.email }) : state.done.invited ? t("doneInvited", { email: state.done.email }) : t("doneNoInvite", { email: state.done.email })}</div>
        <Link href={`/${locale}/login${state.done.passwordSet || state.done.invited ? "" : "?view=forgot"}`} className="btn primary">{t("toSignIn")}</Link>
      </div>
    );
  return (
    <form onSubmit={submit} className="form">
      <p className="muted !m-0">{t("intro")}</p>
      <label>{t("code")} <span className="hint">{t("codeHint")}</span><input name="code" type="password" required autoComplete="off" dir="ltr" /></label>
      <label>{t("companyName")}<input name="companyName" required defaultValue="Evercrest" /></label>
      <label>{t("adminName")}<input name="adminName" required autoComplete="name" /></label>
      <label>{t("adminEmail")}<input name="adminEmail" type="email" required autoComplete="email" dir="ltr" /></label>
      <label>{t("password")} <span className="hint">{t("passwordHint")}</span><input name="password" type="password" required minLength={10} autoComplete="new-password" dir="ltr" /></label>
      <label>{t("confirm")}<input name="confirm" type="password" required minLength={10} autoComplete="new-password" dir="ltr" /></label>
      <label>{t("adminLocale")}
        <select name="adminLocale" defaultValue={locale}><option value="ckb">کوردی</option><option value="ar">العربية</option><option value="en">English</option></select>
      </label>
      {state.error && <div className="form-msg error" role="alert">{t(`err_${state.error}`)}{state.detail ? ` (${state.detail})` : ""}</div>}
      <button type="submit" className="primary !py-2.5" disabled={pending}>{pending ? t("working") : t("create")}</button>
    </form>
  );
}
