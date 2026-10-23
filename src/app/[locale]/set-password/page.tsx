import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { authMode, supabaseServer } from "@/server/supabase";
import { SetPasswordForm } from "../login/AuthForms";
import { AuthCard } from "../login/AuthCard";

export const dynamic = "force-dynamic";

/** After an invitation or a password-reset link: the person chooses their password. */
export default async function SetPassword({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (authMode() === "dev") redirect(`/${locale}/login`);
  const { data } = await (await supabaseServer()).auth.getUser();
  if (!data.user) redirect(`/${locale}/login?error=link`);
  const t = await getTranslations({ locale, namespace: "Login" });
  return (
    <AuthCard locale={locale} title={t("setTitle")} path="/set-password">
      <p className="muted mb-4">{t("setHint", { email: data.user.email ?? "" })}</p>
      <SetPasswordForm locale={locale} />
    </AuthCard>
  );
}
