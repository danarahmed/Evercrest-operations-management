import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { formOptions, tripImportPreview } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../../../shell";

export const dynamic = "force-dynamic";

/** Preview of an uploaded trip sheet: what will be created or updated, what is wrong, and the button that applies it once. */
export default async function ImportPreviewPage({ params }: { params: Promise<{ locale: string; id: string; importId: string }> }) {
  const { locale, id, importId } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Import" });
  const { imp, job, plan, rows, currency } = await tripImportPreview(db, actor, importId);
  const options = await formOptions(db, actor);
  const base = `/${locale}/jobs/${id}`;
  const tone: Record<string, "success" | "warning" | "neutral" | "danger"> = { new: "success", update: "warning", same: "neutral", error: "danger" };
  const byRow = new Map(rows.map((r) => [r.rowNo, r]));
  const note = (n: { code: string; params?: Record<string, string> }) => (t.has(`note_${n.code}`) ? t(`note_${n.code}`, n.params ?? {}) : n.code);

  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path={`/jobs/${id}`} crumb={`${job.jobNo} · ${t("title")}`}>
      <PageHeader back={{ href: `${base}?tab=trips`, label: job.jobNo }} eyebrow={<span className="ltr">{imp.fileName}</span>} title={t("title")} subtitle={t("subtitle", { rows: rows.length, sheet: job.name })} />

      {imp.status !== "staged" || !plan ? (
        <Card title={t(`status_${imp.status}`)} icon="checkCircle">
          {imp.result ? <p>{t("resultLine", imp.result as Record<string, number>)}</p> : null}
          <Link href={`${base}?tab=trips`} className="btn primary">{t("backToTrips")}</Link>
        </Card>
      ) : (
        <>
          <div className="stats">
            <Stat icon="plus" label={t("newTrips")} value={plan.counts.new} tone="success" />
            <Stat icon="refresh" label={t("updates")} value={plan.counts.update} tone={plan.counts.update ? "warning" : undefined} hint={t("updatesHint")} />
            <Stat icon="checkCircle" label={t("unchanged")} value={plan.counts.same} />
            <Stat icon="alert" label={t("errors")} value={plan.counts.error} tone={plan.counts.error ? "danger" : undefined} hint={t("errorsHint")} />
            <Stat icon="wallet" label={t("advances")} value={plan.advanceRows ? (currency ? formatMoney(plan.advanceTotal, currency, locale) : plan.advanceTotal) : "—"} hint={t("advanceRows", { count: plan.advanceRows })} />
          </div>

          {(plan.newDrivers.length + plan.newTransporters.length + plan.newRoutes.length > 0) && (
            <Card title={t("newNames")} subtitle={t("newNamesHelp")} icon="users">
              <div className="grid cols-3">
                {plan.newTransporters.length > 0 && <div><div className="small muted">{t("transporters")}</div><div className="chips">{plan.newTransporters.map((x) => <span key={x} className="chip">{x}</span>)}</div></div>}
                {plan.newRoutes.length > 0 && <div><div className="small muted">{t("routes")}</div><div className="chips">{plan.newRoutes.map((x) => <span key={x} className="chip">{x}</span>)}</div></div>}
                {plan.newDrivers.length > 0 && <div><div className="small muted">{t("drivers", { count: plan.newDrivers.length })}</div><div className="chips">{plan.newDrivers.slice(0, 30).map((x) => <span key={x} className="chip">{x}</span>)}{plan.newDrivers.length > 30 && <span className="chip">+{plan.newDrivers.length - 30}</span>}</div></div>}
              </div>
            </Card>
          )}

          <Card title={t("apply")} icon="checkCircle">
            <div className="grid side">
              <ActionForm command="trip_imports.apply" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("applyButton", { count: plan.counts.new + plan.counts.update })} redirectTo={`${base}?tab=trips`} confirm={t("applyConfirm")}>
                <input type="hidden" name="importId" value={imp.id} />
                {plan.advanceRows > 0 && (
                  <label>{t("paidFrom")} <span className="hint">{t("paidFromHint")}</span>
                    <select name="moneyAccountId" required defaultValue="">
                      <option value="">{t("chooseBox")}</option>
                      {options.moneyAccounts.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.currency})</option>)}
                    </select>
                  </label>
                )}
                <p className="muted small">{t("applyHelp")}</p>
              </ActionForm>
              <ActionForm command="trip_imports.discard" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("discard")} variant="secondary" redirectTo={`${base}?tab=trips`}>
                <input type="hidden" name="importId" value={imp.id} />
              </ActionForm>
            </div>
          </Card>

          <Card title={t("rows")} icon="list" flush>
            <div className="table-wrap"><table className="dense">
              <thead><tr><th>#</th><th>{t("manifest")}</th><th>{t("driver")}</th><th>{t("plate")}</th><th>{t("loadingDate")}</th><th className="num">{t("loaded")}</th><th className="num">{t("discharged")}</th><th className="num">{t("advance")}</th><th>{t("what")}</th><th>{t("notes")}</th></tr></thead>
              <tbody>{plan.rows.map((p) => {
                const r = byRow.get(p.rowNo)!;
                return (
                  <tr key={p.rowNo} className={p.status === "error" ? "row-danger" : undefined}>
                    <td className="ltr muted">{p.rowNo}</td>
                    <td className="ltr"><strong>{p.manifest ?? "—"}</strong></td>
                    <td>{r.values.driver ?? "—"}</td>
                    <td className="ltr">{r.values.plate ?? "—"}</td>
                    <td className="ltr">{r.values.loadingDate ?? "—"}</td>
                    <td className="num">{r.values.loadedQty ?? "—"}</td>
                    <td className="num">{r.values.dischargedQty ?? "—"}</td>
                    <td className="num">{r.values.advance ?? "—"}</td>
                    <td><Badge tone={tone[p.status]}>{t(`row_${p.status}`)}</Badge></td>
                    <td className="wrap small">{p.notes.map((n, i) => <div key={i} className={n.level === "error" ? "neg" : n.level === "warning" ? "warn" : "muted"}><Icon name={n.level === "info" ? "info" : "alert"} size={12} /> {note(n)}</div>)}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          </Card>
        </>
      )}
    </Shell>
  );
}
