import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { companies } from "@/db/schema";
import { AuthCard } from "../login/AuthCard";
import { WelcomeForm } from "./WelcomeForm";

export const dynamic = "force-dynamic";

/**
 * First-run setup in the browser: exists only while no company has been set up
 * and a SETUP_TOKEN is configured on the hosting side. Afterwards it is gone (404).
 */
export default async function Welcome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  if ((process.env.SETUP_TOKEN ?? "").length < 24) notFound();
  const [existing] = await getDb().select({ id: companies.id }).from(companies).limit(1);
  if (existing) notFound();
  const t = await getTranslations({ locale, namespace: "Welcome" });
  return (
    <AuthCard locale={locale} title={t("title")} path="/welcome">
      <WelcomeForm locale={locale} />
    </AuthCard>
  );
}
