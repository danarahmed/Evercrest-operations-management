import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { documentsToVerify } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../shell";

export const dynamic = "force-dynamic";

export default async function Documents({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Verify" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const list = await documentsToVerify(db, actor);
  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path="/documents">
      <h1>{t("title")}</h1>
      {list.length === 0 && <p className="card muted">{t("empty")}</p>}
      <div className="stack">
        {list.map((d) => (
          <div key={d.id} className="card stack">
            <div>
              <strong>{d.type}</strong> {d.reference && <span dir="ltr">{d.reference}</span>} · {d.jobId ? <Link href={`/${locale}/jobs/${d.jobId}`}>{d.target}</Link> : d.target}
            </div>
            <div className="muted">{t("receivedBy", { name: d.receivedBy })}</div>
            <ActionForm command="documents.review" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={f("save")}>
              <input type="hidden" name="documentId" value={d.id} />
              <div className="grid2">
                <label>{t("decision")}
                  <select name="decision" required defaultValue="verified">
                    <option value="verified">{t("verify")}</option>
                    <option value="rejected">{t("reject")}</option>
                  </select>
                </label>
                <label>{t("note")}<input name="note" /></label>
              </div>
            </ActionForm>
          </div>
        ))}
      </div>
    </Shell>
  );
}
