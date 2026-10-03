import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";

export default function Home({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale(use(params).locale);
  const t = useTranslations("App");
  return (
    <main>
      <h1>{t("title")}</h1>
      <p>{t("status")}</p>
    </main>
  );
}
