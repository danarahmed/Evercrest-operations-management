import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { Badge, Card, EmptyState, PageHeader, initials } from "@/components/ui";
import { formatMoney, intlLocale } from "@/lib/format";
import { pendingApprovals } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../shell";

export const dynamic = "force-dynamic";

/** Four-eyes: requests waiting for someone other than the requester to decide. */
export default async function Approvals({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Approvals" });
  const list = await pendingApprovals(db, actor);
  const dtf = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" });
  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path="/approvals">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {list.length === 0 ? <Card><EmptyState icon="checkCircle" title={t("empty")} /></Card> : (
        <div className="stack">
          {list.map((r) => (
            <Card key={r.id}>
              <div className="row between" style={{ alignItems: "flex-start" }}>
                <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
                  <span className="avatar">{initials(r.requester)}</span>
                  <div>
                    <div style={{ fontWeight: 650, fontSize: 15 }}>{r.summary}</div>
                    <div className="small muted">{t("requestedBy", { name: r.requester })} · {dtf.format(r.createdAt)}</div>
                  </div>
                </div>
                {r.amount && r.currency && <div style={{ fontSize: 20, fontWeight: 700 }} className="num">{formatMoney(r.amount, r.currency, locale)}</div>}
              </div>
              <div className="divider" />
              {r.own ? <Badge tone="warning">{t("ownRequest")}</Badge> : (
                <div className="row">
                  <ActionForm command="approvals.decide" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("approve")} inline>
                    <input type="hidden" name="requestId" value={r.id} />
                    <input type="hidden" name="decision" value="approve" />
                    <input name="note" placeholder={t("noteOptional")} />
                  </ActionForm>
                  <Modal label={t("reject")} variant="danger" small size="sm" icon={<Icon name="x" size={15} />}>
                    <ActionForm command="approvals.decide" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("reject")} variant="danger">
                      <input type="hidden" name="requestId" value={r.id} />
                      <input type="hidden" name="decision" value="reject" />
                      <label>{t("whyReject")}<input name="note" required /></label>
                    </ActionForm>
                  </Modal>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </Shell>
  );
}
