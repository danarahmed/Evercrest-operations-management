import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { documentsToVerify } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../shell";

export const dynamic = "force-dynamic";

/** Documents received but not yet checked: verify or reject each one. */
export default async function Documents({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Verify" });
  const list = await documentsToVerify(db, actor);
  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path="/documents">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Card flush title={t("waiting", { count: list.length })} icon="file">
        {list.length === 0 ? <EmptyState icon="checkCircle" title={t("empty")} /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("document")}</th><th>{t("for")}</th><th>{t("receivedByCol")}</th><th /></tr></thead>
            <tbody>{list.map((d) => (
              <tr key={d.id}>
                <td><div className="cell-title">{d.type}</div>{d.reference && <div className="cell-sub ltr">{d.reference}</div>}</td>
                <td className="ltr">{d.jobId ? <Link href={`/${locale}/jobs/${d.jobId}?tab=documents`}>{d.target}</Link> : d.target}</td>
                <td>{d.receivedBy}</td>
                <td>
                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    <ActionForm command="documents.review" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("verify")} inline>
                      <input type="hidden" name="documentId" value={d.id} />
                      <input type="hidden" name="decision" value="verified" />
                    </ActionForm>
                    <Modal label={t("reject")} variant="danger" small size="sm" icon={<Icon name="x" size={15} />}>
                      <ActionForm command="documents.review" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("reject")} variant="danger">
                        <input type="hidden" name="documentId" value={d.id} />
                        <input type="hidden" name="decision" value="rejected" />
                        <label>{t("whyReject")}<input name="note" required /></label>
                      </ActionForm>
                    </Modal>
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </Shell>
  );
}
