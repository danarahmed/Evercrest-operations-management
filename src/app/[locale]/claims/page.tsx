import { eq } from "drizzle-orm";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ExportButton } from "@/components/ExportButton";
import { Card, EmptyState, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { dec, D } from "@/domain/money";
import { formatMoney } from "@/lib/format";
import { claimsOverview } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../shell";

export const dynamic = "force-dynamic";

/** Every claim in the company: who brought papers, for which job, what is owed and paid. */
export default async function ClaimsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ status?: string }> }) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Claims" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const status = ["posted", "paid", "cancelled", "draft"].includes(sp.status ?? "") ? sp.status! : "";
  const { list, canManage } = await claimsOverview(db, actor, status ? { status: [status] } : {});
  const base = `/${locale}/claims`;
  const m = (a: string, c: string) => formatMoney(a, c, locale);
  const openByCurrency = new Map<string, InstanceType<typeof D>>();
  for (const c of list) if (c.status === "posted") openByCurrency.set(c.currency, (openByCurrency.get(c.currency) ?? new D(0)).plus(dec(c.totalFinal)));

  return (
    <Shell wide permissions={actor.permissions} locale={locale} userName={user.displayName} path="/claims">
      <PageHeader title={t("pageTitle")} subtitle={t("pageIntro")} actions={<>{canManage && <Link href={`${base}/held`} className="btn">{t("heldCuts")}</Link>}<ExportButton label={f("export")} filename="evercrest-claims" /></>} />
      <div className="stats">
        <Stat icon="clipboard" label={t("status_posted")} value={list.filter((c) => c.status === "posted").length} href={`${base}?status=posted`} tone="warning" hint={[...openByCurrency].map(([c, a]) => m(a.toString(), c)).join(" · ") || undefined} />
        <Stat icon="checkCircle" label={t("status_paid")} value={list.filter((c) => c.status === "paid").length} href={`${base}?status=paid`} tone="success" />
        <Stat icon="list" label={t("allClaims")} value={list.length} href={base} />
      </div>
      <Card flush title={t("pageTitle")} icon="clipboard" actions={
        <div className="chips">
          {["", "posted", "paid", "cancelled"].map((s) => <Link key={s} href={s ? `${base}?status=${s}` : base} className={`chip${status === s ? " badge accent" : ""}`}>{s ? t(`status_${s}`) : t("all")}</Link>)}
        </div>
      }>
        {list.length === 0 ? <EmptyState icon="clipboard" title={t("none")} /> : (
          <div className="table-wrap"><table className="dense">
            <thead><tr><th>{t("number")}</th><th>{t("date")}</th><th>{t("job")}</th><th>{t("claimant")}</th><th className="num">{t("trips")}</th><th className="num">{t("total")}</th><th>{t("status")}</th><th>{t("source")}</th></tr></thead>
            <tbody>{list.map((c) => (
              <tr key={c.id}>
                <td className="ltr"><Link href={`${base}/${c.id}`} className="cell-title">{c.claimNo}</Link></td>
                <td className="ltr">{c.claimDate}</td>
                <td className="wrap"><Link href={`/${locale}/jobs/${c.jobId}?tab=claims`}>{c.jobNo}</Link><div className="cell-sub">{c.jobName}</div></td>
                <td>{c.claimant}</td>
                <td className="num">{c.tripCount}</td>
                <td className={`num ${dec(c.totalFinal).lt(0) ? "neg" : ""}`}><strong>{m(c.totalFinal, c.currency)}</strong></td>
                <td><StatusBadge status={c.status} label={t(`status_${c.status}`)} /></td>
                <td className="muted">{t(`source_${c.source}`)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </Shell>
  );
}
