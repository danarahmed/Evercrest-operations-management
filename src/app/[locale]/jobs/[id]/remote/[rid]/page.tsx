import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";
import { dec } from "@/domain/money";
import { formatMoney } from "@/lib/format";
import { remoteSettlementView } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../../../shell";

export const dynamic = "force-dynamic";

/**
 * A site's settlement compared with the system, line by line. Only the
 * differences need the owner's eye; approving claims every paid trip for its
 * driver and records the payments from the site's box.
 */
export default async function RemoteSettlementPage({ params }: { params: Promise<{ locale: string; id: string; rid: string }> }) {
  const { locale, id, rid } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Claims" });
  const { rs, job, money, comparison: cmp, canApprove } = await remoteSettlementView(db, actor, rid);
  const base = `/${locale}/jobs/${id}`;
  const cur = cmp?.currency ?? money.currency;
  const m = (a: string | null | undefined) => (a === null || a === undefined ? "—" : formatMoney(a, cur, locale));
  const tone: Record<string, "success" | "warning" | "danger" | "neutral"> = { match: "success", amount_differs: "warning", not_found: "danger", duplicate: "danger", already_claimed: "danger", settled_old_way: "danger", waiver_pending: "warning", not_discharged: "warning", no_rule: "danger", cancelled: "neutral", no_amount: "danger" };
  const result = rs.result as null | { claims: { driver: string; claimId: string; claimNo: string; trips: number; system: string; sitePaid: string; recorded: string; difference: string; paymentNo: string | null }[]; skipped: { manifest: string; status: string; claimNo: string | null }[]; totals: { system: string; paid: string; difference: string } };

  return (
    <Shell wide permissions={actor.permissions} locale={locale} userName={user.displayName} path={`/jobs/${id}`} crumb={`${job.jobNo} · ${t("remoteTitle")}`}>
      <PageHeader back={{ href: `${base}?tab=claims`, label: job.jobNo }} eyebrow={<span className="ltr">{rs.fileName}</span>} title={t("remoteCompareTitle")} subtitle={t("remoteSubtitle", { date: rs.settlementDate, box: money.name })} />

      {rs.status !== "staged" || !cmp ? (
        <Card title={t(`remote_${rs.status}`)} icon="checkCircle">
          {result && (
            <div className="stack">
              <div className="table-wrap"><table className="dense">
                <thead><tr><th>{t("driver")}</th><th>{t("claim")}</th><th className="num">{t("trips")}</th><th className="num">{t("systemOwes")}</th><th className="num">{t("sitePaid")}</th><th className="num">{t("recorded")}</th><th className="num">{t("difference")}</th></tr></thead>
                <tbody>{result.claims.map((c) => (
                  <tr key={c.claimId}><td>{c.driver}</td><td className="ltr"><Link href={`/${locale}/claims/${c.claimId}`}>{c.claimNo}</Link></td><td className="num">{c.trips}</td><td className="num">{m(c.system)}</td><td className="num">{m(c.sitePaid)}</td><td className="num">{m(c.recorded)}</td><td className={`num ${c.difference !== "0" ? "warn" : ""}`}><strong>{m(c.difference)}</strong></td></tr>
                ))}</tbody>
              </table></div>
              {result.skipped.length > 0 && <p className="small muted">{t("skippedLines", { count: result.skipped.length })}: {result.skipped.map((s) => `${s.manifest} (${t(`remote_line_${s.status}`)}${s.claimNo ? ` ${s.claimNo}` : ""})`).join(" · ")}</p>}
              {result.totals.difference !== "0" && <div className="banner"><Icon name="alert" /><div><div className="banner-label">{t("differenceTotal", { amount: m(result.totals.difference) })}</div><div>{t("differenceHelp")}</div></div></div>}
            </div>
          )}
          <Link href={`${base}?tab=claims`} className="btn primary" style={{ marginTop: 12 }}>{t("backToClaims")}</Link>
        </Card>
      ) : (
        <>
          <div className="stats">
            <Stat icon="checkCircle" label={t("remote_line_match")} value={cmp.counts.match} tone="success" />
            <Stat icon="alert" label={t("remote_line_amount_differs")} value={cmp.counts.amount_differs} tone={cmp.counts.amount_differs ? "warning" : undefined} />
            <Stat icon="alert" label={t("cannotClaim")} value={cmp.lines.length - cmp.counts.match - cmp.counts.amount_differs} tone={cmp.lines.length - cmp.counts.match - cmp.counts.amount_differs ? "danger" : undefined} hint={t("cannotClaimHint")} />
            <Stat icon="wallet" label={t("systemOwes")} value={m(cmp.totals.system)} />
            <Stat icon="wallet" label={t("sitePaid")} value={m(cmp.totals.paid)} hint={cmp.totals.difference !== "0" ? t("differenceTotal", { amount: m(cmp.totals.difference) }) : t("noDifference")} tone={cmp.totals.difference !== "0" ? "warning" : undefined} />
          </div>

          {cmp.byDriver.length > 0 && (
            <Card title={t("perDriver")} icon="users" flush>
              <div className="table-wrap"><table className="dense">
                <thead><tr><th>{t("driver")}</th><th className="num">{t("trips")}</th><th className="num">{t("systemOwes")}</th><th className="num">{t("sitePaid")}</th><th className="num">{t("difference")}</th></tr></thead>
                <tbody>{cmp.byDriver.map((d) => (
                  <tr key={d.driverId}><td>{d.driver}</td><td className="num">{d.trips}</td><td className="num">{m(d.system)}</td><td className="num">{m(d.paid)}</td><td className={`num ${d.difference !== "0" ? (dec(d.difference).gt(0) ? "neg" : "warn") : ""}`}><strong>{m(d.difference)}</strong></td></tr>
                ))}</tbody>
              </table></div>
            </Card>
          )}

          <Card title={t("approveTitle")} icon="checkCircle">
            <div className="grid side">
              <div>
                <p className="muted small">{t("approveHelp")}</p>
                {canApprove ? (
                  <ActionForm command="remote_settlements.approve" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("approveButton", { count: cmp.byDriver.length })} confirm={t("approveConfirm")} summary={`${rs.fileName} · ${cmp.totals.paid} ${cur}`}>
                    <input type="hidden" name="remoteSettlementId" value={rs.id} />
                    <label>{t("notes")}<input name="notes" /></label>
                  </ActionForm>
                ) : <p className="warn small">{t("approveNoPermission")}</p>}
              </div>
              <ActionForm command="remote_settlements.discard" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("discard")} variant="secondary" redirectTo={`${base}?tab=claims`}>
                <input type="hidden" name="remoteSettlementId" value={rs.id} />
                <label>{t("reason")}<input name="reason" /></label>
              </ActionForm>
            </div>
          </Card>

          <Card title={t("lines")} icon="list" flush>
            <div className="table-wrap"><table className="dense">
              <thead><tr><th>#</th><th>{t("manifest")}</th><th>{t("sheetDriver")}</th><th>{t("driver")}</th><th>{t("plate")}</th><th className="num">{t("sheetFine")}</th><th className="num">{t("sheetAdvance")}</th><th className="num">{t("sitePaid")}</th><th className="num">{t("systemOwes")}</th><th className="num">{t("difference")}</th><th>{t("what")}</th></tr></thead>
              <tbody>{cmp.lines.map((l) => (
                <tr key={l.rowNo} className={l.status === "match" ? undefined : l.status === "amount_differs" ? undefined : "row-danger"}>
                  <td className="ltr muted">{l.rowNo}</td>
                  <td className="ltr"><strong>{l.manifest}</strong></td>
                  <td className="muted">{l.sheetDriver ?? "—"}</td>
                  <td>{l.driver ?? "—"}</td>
                  <td className="ltr">{l.plate ?? "—"}</td>
                  <td className="num muted">{l.fine ?? "—"}</td>
                  <td className="num muted">{l.advance ?? "—"}</td>
                  <td className="num">{m(l.paid)}</td>
                  <td className="num">{m(l.system)}</td>
                  <td className={`num ${l.difference && l.difference !== "0" ? "warn" : ""}`}><strong>{l.difference ? m(l.difference) : "—"}</strong></td>
                  <td><Badge tone={tone[l.status]}>{t(`remote_line_${l.status}`)}</Badge>{l.claimNo && <span className="small muted"> {l.claimNo}</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </Card>
        </>
      )}
    </Shell>
  );
}
