import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { formatMoney } from "@/lib/format";
import { pendingApprovals } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../shell";

export const dynamic = "force-dynamic";

export default async function Approvals({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Approvals" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const list = await pendingApprovals(db, actor);
  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path="/approvals">
      <h1>{t("title")}</h1>
      {list.length === 0 && <p className="card muted">{t("empty")}</p>}
      <div className="stack">
        {list.map((r) => (
          <div key={r.id} className="card stack">
            <div>
              <strong>{r.summary}</strong>
              {r.amount && r.currency && <> · <strong>{formatMoney(r.amount, r.currency, locale)}</strong></>}
            </div>
            <div className="muted">{t("requestedBy", { name: r.requester })} · {r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</div>
            {r.own ? (
              <p className="muted">{t("ownRequest")}</p>
            ) : (
              <ActionForm command="approvals.decide" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={f("save")}>
                <input type="hidden" name="requestId" value={r.id} />
                <div className="grid2">
                  <label>{t("decision")}
                    <select name="decision" required defaultValue="approve">
                      <option value="approve">{t("approve")}</option>
                      <option value="reject">{t("reject")}</option>
                    </select>
                  </label>
                  <label>{t("note")}<input name="note" /></label>
                </div>
              </ActionForm>
            )}
          </div>
        ))}
      </div>
    </Shell>
  );
}
