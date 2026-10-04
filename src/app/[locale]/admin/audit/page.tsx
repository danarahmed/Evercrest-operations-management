import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { Icon } from "@/components/icons";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { summarize } from "@/domain/management/history";
import { auditView } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../shell";

export const dynamic = "force-dynamic";

/** Who did what and when (append-only; nothing here can be edited or deleted). */
export default async function AuditPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ from?: string; to?: string; action?: string; user?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [me] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Admin" });
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = sp.from ?? new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const to = sp.to ?? today;
  const v = await auditView(db, actor, { from, to, action: sp.action || undefined, userId: sp.user || undefined });
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  return (
    <Shell wide permissions={actor.permissions} locale={locale} userName={me.displayName} path="/admin/audit">
      <PageHeader title={t("auditLog")} subtitle={t("auditHelp")} back={{ href: `/${locale}/admin`, label: t("title") }} />
      <form className="filters no-print" method="get">
        <label>{t("from")}<input type="date" name="from" defaultValue={from} /></label>
        <label>{t("to")}<input type="date" name="to" defaultValue={to} /></label>
        <label>{t("user")}<select name="user" defaultValue={sp.user ?? ""}><option value="">{t("everyone")}</option>{v.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
        <label>{t("action")}<input name="action" defaultValue={sp.action ?? ""} placeholder="payments" dir="ltr" /></label>
        <button type="submit"><Icon name="search" size={16} />{t("show")}</button>
      </form>
      <Card flush title={t("auditLog")} icon="history">
        {v.events.length === 0 ? <EmptyState icon="history" title={t("noEvents")} /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("when")}</th><th>{t("user")}</th><th>{t("action")}</th><th>{t("details")}</th><th>{t("reason")}</th></tr></thead>
            <tbody>{v.events.map(({ e, by }) => (
              <tr key={e.id}>
                <td className="nowrap">{fmt.format(e.createdAt)}</td><td>{by ?? "—"}</td>
                <td><code className="ltr">{e.action}</code><div className="cell-sub ltr">{e.entityType}</div></td>
                <td className="wrap muted small" dir="auto">{summarize(e.after)}</td><td className="wrap">{e.reason ?? ""}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </Shell>
  );
}
