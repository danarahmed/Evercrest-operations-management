import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";
import { formatMoney, formatQty } from "@/lib/format";
import { customsStatementPage } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../../../shell";

export const dynamic = "force-dynamic";

/**
 * The border person's customs statement compared with the system, truck by truck (by manifest). Only the
 * differences need attention; for trucks not yet booked, his MT can be taken in one step (recorded in each
 * trip's history).
 */
export default async function CustomsStatementPage({ params }: { params: Promise<{ locale: string; id: string; sid: string }> }) {
  const { locale, id, sid } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Customs" });
  const { statement, job, lines, missing, totals, counts, canUse } = await customsStatementPage(db, actor, sid);
  const base = `/${locale}/jobs/${id}`;
  const cur = lines.map((l) => ("currency" in l ? l.currency : null)).find((c): c is string => !!c);
  const m = (a: string | null | undefined) => (!a ? "—" : cur ? formatMoney(a, cur, locale) : a);
  const q = (a: string | null | undefined) => (!a ? "—" : formatQty(a, "MT", locale));
  const tone: Record<string, "success" | "warning" | "danger" | "neutral"> = { match: "success", qty_differs: "warning", amount_differs: "warning", not_found: "danger", duplicate: "danger", no_rate: "danger" };
  const takeable = lines.filter((l) => l.status === "qty_differs" && "tripId" in l && !l.booked);

  return (
    <Shell wide permissions={actor.permissions} locale={locale} userName={user.displayName} path={`/jobs/${id}`} crumb={`${job.jobNo} · ${t("compareTitle")}`}>
      <PageHeader back={{ href: `${base}?tab=customs`, label: job.jobNo }} eyebrow={<span className="ltr">{statement.fileName}</span>} title={t("compareTitle")} subtitle={t("compareSubtitle", { rows: lines.length })} />
      <div className="stats">
        <Stat icon="checkCircle" label={t("cmp_match")} value={counts.match} tone="success" />
        <Stat icon="alert" label={t("cmp_differs")} value={counts.qty_differs + counts.amount_differs} tone={counts.qty_differs + counts.amount_differs ? "warning" : undefined} />
        <Stat icon="alert" label={t("cmp_unknown")} value={counts.not_found + counts.duplicate + counts.no_rate} tone={counts.not_found + counts.duplicate + counts.no_rate ? "danger" : undefined} />
        <Stat icon="truck" label={t("theirTotal")} value={q(totals.theirQty)} hint={t("ourTotal", { qty: q(totals.ourQty) })} />
      </div>

      <Card title={t("linesTitle")} icon="list" flush>
        {(() => {
          const table = (
            <div className="table-wrap"><table className="dense">
              <thead><tr>{canUse && takeable.length > 0 && <th />}<th>#</th><th>{t("manifest")}</th><th className="num">{t("theirMt")}</th><th className="num">{t("ourMt")}</th><th className="num">{t("theirAmount")}</th><th className="num">{t("ourAmount")}</th><th>{t("what")}</th></tr></thead>
              <tbody>{lines.map((l) => {
                const our = "ourQty" in l ? (l.ourQty as string | null) : null;
                const ourAmt = "ourAmount" in l ? (l.ourAmount as string | null) : null;
                const booked = "booked" in l ? (l.booked as string | null) : null;
                const canTake = canUse && l.status === "qty_differs" && "tripId" in l && !booked;
                return (
                  <tr key={l.rowNo} className={l.status === "not_found" || l.status === "duplicate" ? "row-danger" : undefined}>
                    {canUse && takeable.length > 0 && <td>{canTake && <input type="checkbox" name="tripIds[]" value={(l as { tripId: string }).tripId} defaultChecked aria-label={l.manifest ?? ""} />}</td>}
                    <td className="ltr muted">{l.rowNo}</td>
                    <td className="ltr"><strong>{l.manifest ?? "—"}</strong></td>
                    <td className="num">{q(l.theirQty)}</td>
                    <td className={`num ${l.status === "qty_differs" ? "warn" : ""}`}>{q(our)}</td>
                    <td className="num">{m(l.theirAmount)}</td>
                    <td className={`num ${l.status === "amount_differs" ? "warn" : ""}`}>{m(ourAmt)}</td>
                    <td className="wrap"><Badge tone={tone[l.status]}>{t(`line_${l.status}`)}</Badge>{booked && <span className="small muted"> · {t("bookedOn", { no: booked })}</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          );
          return canUse && takeable.length > 0 ? (
            <ActionForm command="customs_statements.use_quantities" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("useTheirMt", { count: takeable.length })} variant="secondary">
              <input type="hidden" name="statementId" value={statement.id} />
              {table}
              <div className="border-t border-slate-200 px-5 py-4"><p className="muted small !m-0">{t("useTheirMtHelp")}</p></div>
            </ActionForm>
          ) : table;
        })()}
      </Card>

      {missing.length > 0 && (
        <Card title={t("missingTitle", { count: missing.length })} subtitle={t("missingHelp")} icon="alert" flush>
          <div className="table-wrap"><table className="dense">
            <thead><tr><th>{t("manifest")}</th><th>{t("loadingDate")}</th><th className="num">{t("ourMt")}</th></tr></thead>
            <tbody>{missing.map((x) => <tr key={x.tripId}><td className="ltr">{x.manifest}</td><td className="ltr">{x.loadingDate ?? "—"}</td><td className="num">{q(x.qty)}</td></tr>)}</tbody>
          </table></div>
        </Card>
      )}
    </Shell>
  );
}
