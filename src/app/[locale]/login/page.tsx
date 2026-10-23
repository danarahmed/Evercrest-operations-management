import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { Icon } from "@/components/icons";
import { initials } from "@/components/ui";
import { authMode } from "@/server/supabase";
import { devSignIn } from "./actions";
import { AuthCard } from "./AuthCard";
import { ResetForm, SignInForm } from "./AuthForms";

export const dynamic = "force-dynamic";

export default async function Login({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ view?: string; error?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "Login" });
  const notice = sp.error === "no_access" || sp.error === "link" ? <div className="form-msg error mb-4" role="alert">{t(`err_${sp.error}`)}</div> : null;

  if (authMode() === "dev") {
    const list = await getDb().select().from(users).where(eq(users.active, true)).orderBy(users.displayName);
    return (
      <AuthCard locale={locale} title={t("title")} path="/login">
        <p className="muted small mb-4"><Icon name="info" size={14} /> {t("devNotice")}</p>
        <div className="stack !gap-2.5">
          {list.length === 0 && <p>{t("noUsers")}</p>}
          {list.map((u) => (
            <form key={u.id} action={devSignIn.bind(null, locale, u.id)}>
              <button type="submit" className="user-option">
                <span className="avatar">{initials(u.displayName)}</span>
                <span className="text-start">
                  <span className="block">{t("as", { name: u.displayName })}</span>
                  <span className="small muted ltr font-normal">{u.email}</span>
                </span>
              </button>
            </form>
          ))}
        </div>
      </AuthCard>
    );
  }

  const forgot = sp.view === "forgot";
  return (
    <AuthCard locale={locale} title={forgot ? t("forgotTitle") : t("title")} path={forgot ? "/login?view=forgot" : "/login"}>
      {notice}
      {forgot ? <ResetForm locale={locale} /> : <SignInForm locale={locale} />}
    </AuthCard>
  );
}
