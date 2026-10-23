"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type FormEvent, startTransition, useActionState, useEffect, useState } from "react";
import { adoptLinkSession, type AuthFormState, requestPasswordReset, setPassword, signIn } from "./actions";

/**
 * Submit without React's automatic form reset, so a failed attempt keeps what
 * the person typed (they only correct the password, not retype the e-mail).
 */
function keepValues(action: (f: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  };
}

function Message({ state }: { state: AuthFormState }) {
  const t = useTranslations("Login");
  if (state.error) return <div className="form-msg error" role="alert">{t(`err_${state.error}`)}</div>;
  if (state.sent) return <div className="form-msg ok" role="status">{t("sent")}</div>;
  return null;
}

export function SignInForm({ locale }: { locale: string }) {
  const t = useTranslations("Login");
  const [state, action, pending] = useActionState(signIn, {});
  return (
    <form onSubmit={keepValues(action)} className="form">
      <input type="hidden" name="locale" value={locale} />
      <label>{t("email")}<input name="email" type="email" autoComplete="username" required dir="ltr" /></label>
      <label>{t("password")}<input name="password" type="password" autoComplete="current-password" required dir="ltr" /></label>
      <Message state={state} />
      <button type="submit" className="primary !py-2.5" disabled={pending}>{pending ? t("signingIn") : t("signIn")}</button>
      <Link href={`/${locale}/login?view=forgot`} className="text-center text-[13.5px] font-bold">{t("forgot")}</Link>
    </form>
  );
}

export function ResetForm({ locale }: { locale: string }) {
  const t = useTranslations("Login");
  const [state, action, pending] = useActionState(requestPasswordReset, {});
  return (
    <form onSubmit={keepValues(action)} className="form">
      <input type="hidden" name="locale" value={locale} />
      <p className="muted !m-0">{t("forgotHint")}</p>
      <label>{t("email")}<input name="email" type="email" autoComplete="username" required dir="ltr" /></label>
      <Message state={state} />
      <button type="submit" className="primary !py-2.5" disabled={pending || state.sent}>{t("sendLink")}</button>
      <Link href={`/${locale}/login`} className="text-center text-[13.5px] font-bold">{t("back")}</Link>
    </form>
  );
}

export function SetPasswordForm({ locale }: { locale: string }) {
  const t = useTranslations("Login");
  const [state, action, pending] = useActionState(setPassword, {});
  return (
    <form onSubmit={keepValues(action)} className="form">
      <input type="hidden" name="locale" value={locale} />
      <label>{t("newPassword")}<input name="password" type="password" autoComplete="new-password" minLength={10} required dir="ltr" /></label>
      <label>{t("confirm")}<input name="confirm" type="password" autoComplete="new-password" minLength={10} required dir="ltr" /></label>
      <Message state={state} />
      <button type="submit" className="primary !py-2.5" disabled={pending}>{t("savePassword")}</button>
    </form>
  );
}

/** Finishes an e-mail link whose session arrived in the address fragment; otherwise the link was not valid. */
export function LinkSession({ locale }: { locale: string }) {
  const t = useTranslations("Login");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access = hash.get("access_token");
    const refresh = hash.get("refresh_token");
    history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!access || !refresh) return setFailed(true);
    adoptLinkSession(locale, access, refresh).then((r) => r?.error && setFailed(true), () => setFailed(true));
  }, [locale]);
  if (failed) return <div className="form-msg error" role="alert">{t("err_link")}</div>;
  return <p className="muted !m-0" role="status">{t("signingIn")}</p>;
}
