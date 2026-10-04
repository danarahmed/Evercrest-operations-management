import { eq } from "drizzle-orm";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { Icon } from "@/components/icons";
import { initials } from "@/components/ui";
import { routing } from "@/i18n/routing";
import { devSignIn } from "./actions";

export const dynamic = "force-dynamic";
const LANG_NAMES: Record<string, string> = { en: "English", ar: "العربية", ckb: "کوردی" };

export default async function Login({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Login" });
  const app = await getTranslations({ locale, namespace: "App" });
  const list = process.env.AUTH_MODE === "dev" ? await getDb().select().from(users).where(eq(users.active, true)).orderBy(users.displayName) : [];
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-mark">E</span>
          <span>
            <span className="brand-name">{app("title")}</span>
            <br />
            <span className="brand-sub">{app("tagline")}</span>
          </span>
        </div>
        <h1 style={{ fontSize: 20 }}>{t("title")}</h1>
        <p className="muted small" style={{ marginBlock: "6px 18px" }}><Icon name="info" size={14} /> {t("devNotice")}</p>
        <div className="stack">
          {list.length === 0 && <p>{t("noUsers")}</p>}
          {list.map((u) => (
            <form key={u.id} action={devSignIn.bind(null, locale, u.id)}>
              <button type="submit" className="user-option">
                <span className="avatar">{initials(u.displayName)}</span>
                <span style={{ textAlign: "start" }}>
                  <span style={{ display: "block" }}>{t("as", { name: u.displayName })}</span>
                  <span className="small muted ltr" style={{ fontWeight: 400 }}>{u.email}</span>
                </span>
              </button>
            </form>
          ))}
        </div>
        <div className="row" style={{ justifyContent: "center", marginBlockStart: 20 }}>
          {routing.locales.map((l) => <Link key={l} href={`/${l}/login`} className={l === locale ? "chip" : "small"} lang={l}>{LANG_NAMES[l]}</Link>)}
        </div>
      </div>
    </div>
  );
}
