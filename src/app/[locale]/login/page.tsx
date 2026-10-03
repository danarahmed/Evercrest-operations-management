import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { devSignIn } from "./actions";

export const dynamic = "force-dynamic";

export default async function Login({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Login" });
  const list = process.env.AUTH_MODE === "dev" ? await getDb().select().from(users).where(eq(users.active, true)) : [];
  return (
    <main>
      <h1>{t("title")}</h1>
      <p className="muted">{t("devNotice")}</p>
      <div className="stack">
        {list.length === 0 && <p>{t("noUsers")}</p>}
        {list.map((u) => (
          <form key={u.id} action={devSignIn.bind(null, locale, u.id)}>
            <button className="primary" type="submit">{t("as", { name: u.displayName })}</button>
          </form>
        ))}
      </div>
    </main>
  );
}
