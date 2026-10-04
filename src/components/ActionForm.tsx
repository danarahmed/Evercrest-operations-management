"use client";
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, startTransition, useActionState, useEffect, useRef } from "react";
import { type FormState, submitCommand } from "@/app/[locale]/actions";

/**
 * Form for one server command. Carries a per-render idempotency key, disables
 * itself while submitting, shows errors in plain language, and offers
 * "send for approval" when a limit is exceeded. Inside a dialog it closes the
 * dialog after a successful save.
 */
export function ActionForm({ command, locale, idempotencyKey, submitLabel, summary, redirectTo, children, inline, variant = "primary", confirm }: {
  command: string;
  locale: string;
  idempotencyKey: string;
  submitLabel: string;
  summary?: string;
  /** After success go to this path; "{id}" is replaced by the new record's id. */
  redirectTo?: string;
  children?: ReactNode;
  /** Compact one-line form (row actions in tables). */
  inline?: boolean;
  variant?: "primary" | "secondary" | "danger";
  /** Ask before submitting (irreversible or money-moving actions). */
  confirm?: string;
}) {
  const t = useTranslations("Forms");
  const [state, action, pending] = useActionState<FormState, FormData>(submitCommand, {});
  const formRef = useRef<HTMLFormElement>(null);
  // Submit manually instead of via the form "action" prop: React would otherwise clear
  // the fields after every submission, losing what the user typed when a save fails.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (confirm && !window.confirm(confirm)) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const data = new FormData(e.currentTarget, submitter);
    startTransition(() => action(data));
  };
  // After a successful save: clear the fields and tell a surrounding dialog to close.
  useEffect(() => {
    if (!state.ok) return;
    formRef.current?.reset();
    formRef.current?.dispatchEvent(new CustomEvent("actionform:success", { bubbles: true }));
  }, [state]);
  // After a success, the next submission is a new operation and needs a new key.
  const key = state.nextKey ?? idempotencyKey;
  const btn = variant === "secondary" ? "" : variant;
  return (
    <form ref={formRef} onSubmit={onSubmit} className={`form${inline ? " inline" : ""}`}>
      <input type="hidden" name="__command" value={command} />
      <input type="hidden" name="__key" value={key} />
      <input type="hidden" name="__locale" value={locale} />
      <input type="hidden" name="__summary" value={summary ?? ""} />
      {redirectTo && <input type="hidden" name="__redirect" value={redirectTo} />}
      {children}
      {state.error && (
        <div className="form-msg error" role="alert">
          <strong>{t.has(`error_${state.error.code}`) ? t(`error_${state.error.code}`) : t("error_generic")}</strong>
          <div>{state.error.message}</div>
          {!!state.error.issues?.length && <ul>{state.error.issues.map((i) => <li key={i.path}>{i.message}</li>)}</ul>}
        </div>
      )}
      {state.ok && !inline && <div className="form-msg ok" role="status">{t("saved")}</div>}
      <div className="form-actions">
        <button className={`${btn}${inline ? " sm" : ""}`.trim() || undefined} type="submit" disabled={pending}>{pending ? t("saving") : submitLabel}</button>
        {state.approvalRequired && (
          // The clicked button's name/value is part of the submitted form data.
          <button type="submit" name="__mode" value="approval" disabled={pending} className={inline ? "sm" : undefined}>{t("sendForApproval")}</button>
        )}
      </div>
    </form>
  );
}
