import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { Badge, Card, EmptyState, StatusBadge } from "@/components/ui";
import type { ClaimPreview } from "@/domain/transport/claims";
import { dec } from "@/domain/money";
import { formatMoney, formatQty } from "@/lib/format";
import type { FormOptions, jobClaims } from "@/server/queries";
import { RemoteUpload } from "./remote/RemoteUpload";

type Data = Awaited<ReturnType<typeof jobClaims>>;

/**
 * The job's Claims tab: a transporter (or a driver) brings manifests, staff
 * type or scan the numbers, the system checks each one and shows the claim
 * exactly as the settlement form, then one click posts it. Site settlements
 * made with the site's own figures are imported here and compared.
 */
export async function ClaimsSection({ locale, basePath, data, options, check, draft }: {
  locale: string;
  basePath: string;
  data: Data;
  options: FormOptions;
  /** The check of the manifests typed in the New claim step, if any. */
  check: ClaimPreview | null;
  draft: { claimantId: string; claimantName: string; manifests: string; bringing: string[]; claimDate: string; feeReceipts: boolean } | null;
}) {
  const t = await getTranslations({ locale, namespace: "Claims" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const today = new Date().toISOString().slice(0, 10);
  const m = (a: string, c: string) => formatMoney(a, c, locale);
  const claimants = [...options.transporters.map((x) => ({ ...x, role: "transporter" })), ...options.drivers.map((x) => ({ ...x, role: "driver" }))];
  const statusTone: Record<string, "success" | "warning" | "danger" | "neutral"> = { ok: "success", not_discharged: "warning", papers_missing: "warning", already_claimed: "danger", settled_old_way: "danger", waiver_pending: "warning", fee_receipt_missing: "warning", not_found: "danger", duplicate: "danger", cancelled: "neutral", no_rule: "danger", other_currency: "danger" };

  const newClaimForm = (
    <form method="get" className="form" action={basePath}>
      <input type="hidden" name="tab" value="claims" />
      <div className="grid2">
        <label>{t("claimant")} <span className="hint">{t("claimantHint")}</span>
          <input name="claimant" list="claimants" defaultValue={draft?.claimantName ?? ""} required autoComplete="off" />
          <datalist id="claimants">{claimants.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        </label>
        <label>{f("date")}<input type="date" name="claimDate" defaultValue={draft?.claimDate ?? today} required /></label>
      </div>
      <label>{t("manifests")} <span className="hint">{t("manifestsHint")}</span>
        <textarea name="m" rows={6} defaultValue={draft?.manifests ?? ""} dir="ltr" required placeholder={"H-356\nH-357\nH-358"} />
      </label>
      {data.tripPapers.length > 0 && (
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>{t("bringing")}</div>
          <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
            {data.tripPapers.map((p) => <label key={p.id} className="check"><input type="checkbox" name="bring" value={p.id} defaultChecked={draft ? draft.bringing.includes(p.id) : true} />{p.name}</label>)}
          </div>
        </div>
      )}
      <label className="check"><input type="checkbox" name="rc" value="1" defaultChecked={draft?.feeReceipts ?? false} />{t("feeReceiptsCame")}</label>
      <div className="form-actions"><button type="submit" className="primary"><Icon name="search" size={16} />{t("checkManifests")}</button></div>
    </form>
  );

  return (
    <div className="stack">
      {check && draft && (
        <Card title={t("checkTitle", { count: check.lines.length })} icon="clipboard" flush
          actions={<Link href={`${basePath}?tab=claims`} className="btn ghost sm">{t("startOver")}</Link>}>
          <div className="table-wrap"><table className="dense">
            <thead><tr><th>{t("manifest")}</th><th>{t("driver")}</th><th>{t("plate")}</th><th>{t("transporterAtLoading")}</th><th className="num">{t("net")}</th><th className="num">{t("fine")}</th><th className="num">{t("advance")}</th><th className="num">{t("toPay")}</th><th>{t("what")}</th></tr></thead>
            <tbody>{check.lines.map((l, i) => {
              const c = l.calc;
              return (
                <tr key={i} className={l.status !== "ok" ? "row-danger" : undefined}>
                  <td className="ltr"><strong>{l.manifest}</strong></td>
                  <td>{l.driver ?? "—"}</td>
                  <td className="ltr">{l.plate ?? "—"}</td>
                  <td>{l.transporter ?? (l.tripId ? <span className="muted">{t("direct")}</span> : "—")}</td>
                  <td className="num">{c ? formatQty(c.net, c.unit, locale) : "—"}</td>
                  <td className="num neg">{c && c.carrier.fine !== "0" ? m(c.carrier.fine, c.currency) : "—"}</td>
                  <td className="num">{c && c.carrier.advance !== "0" ? m(c.carrier.advance, c.currency) : "—"}</td>
                  <td className="num"><strong>{l.amount ? m(l.amount, c!.currency) : "—"}</strong></td>
                  <td className="wrap">
                    <Badge tone={statusTone[l.status]}>{t(`line_${l.status}`)}</Badge>
                    {l.claimNo && <span className="small muted"> {l.claimNo}</span>}
                    {l.missingPapers && <div className="small warn">{t("waitingFor", { papers: l.missingPapers.join(", ") })}</div>}
                    {l.unverifiedPapers && <div className="small muted">{t("unverified", { papers: l.unverifiedPapers.join(", ") })}</div>}
                    {l.broughtNow && <div className="small muted">{t("broughtNow", { papers: l.broughtNow.map((b) => b.name).join(", ") })}</div>}
                    {l.missingReceipts && <div className="small warn">{t("receiptsMissing", { fees: l.missingReceipts.join(", ") })}</div>}
                    {l.receiptsNow && <div className="small muted">{t("receiptsNow")}</div>}
                  </td>
                </tr>
              );
            })}</tbody>
            {check.currency && (
              <tfoot><tr className="net"><td colSpan={7}><strong>{t("claimTotal", { count: check.ok.length })}</strong>{check.rounding !== "0" && <span className="muted small"> · {t("rounding")} {m(check.rounding, check.currency)}</span>}</td><td className="num"><strong>{m(check.totalFinal, check.currency)}</strong></td><td /></tr></tfoot>
            )}
          </table></div>
          <div className="card-body" style={{ paddingTop: 0 }}>
            {check.ok.length === check.lines.length && check.ok.length > 0 ? (
              <ActionForm command="claims.create" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("createAndPost", { count: check.ok.length })} redirectTo={`/${locale}/claims/{id}`} summary={`${draft.claimantName} · ${check.ok.length}`}>
                <input type="hidden" name="jobId" value={data.job.id} />
                {draft.claimantId ? <input type="hidden" name="claimantId" value={draft.claimantId} /> : <input type="hidden" name="claimantName" value={draft.claimantName} />}
                <input type="hidden" name="claimDate" value={draft.claimDate} />
                {check.ok.map((l) => <input key={l.manifest} type="hidden" name="manifests[]" value={l.manifest} />)}
                {draft.bringing.map((b) => <input key={b} type="hidden" name="bringing[]" value={b} />)}
                {draft.feeReceipts && <input type="hidden" name="feeReceipts" value="on" />}
                <label>{t("notes")}<input name="notes" /></label>
                <p className="muted small">{t("postHelp", { claimant: draft.claimantName })}</p>
              </ActionForm>
            ) : check.ok.length > 0 ? (
              <div className="banner"><Icon name="alert" /><div><div className="banner-label">{t("someCannot", { count: check.lines.length - check.ok.length })}</div><div>{t("someCannotHelp")}</div>
                <form method="get" action={basePath} style={{ marginTop: 8 }}>
                  <input type="hidden" name="tab" value="claims" /><input type="hidden" name="claimant" value={draft.claimantName} /><input type="hidden" name="claimDate" value={draft.claimDate} />
                  {draft.bringing.map((b) => <input key={b} type="hidden" name="bring" value={b} />)}
                  {draft.feeReceipts && <input type="hidden" name="rc" value="1" />}
                  <input type="hidden" name="m" value={check.ok.map((l) => l.manifest).join("\n")} />
                  <button type="submit" className="sm">{t("keepOnlyOk", { count: check.ok.length })}</button>
                </form>
              </div></div>
            ) : (
              <div className="banner"><Icon name="alert" /><div>{t("nothingToClaim")}</div></div>
            )}
          </div>
        </Card>
      )}

      <Card title={t("title")} icon="clipboard" flush actions={<>
        {data.canManage && (
          <Modal label={t("importRemote")} icon={<Icon name="upload" size={16} />} small>
            <RemoteUpload locale={locale} jobId={data.job.id} idempotencyKey={crypto.randomUUID()} moneyAccounts={options.moneyAccounts} />
          </Modal>
        )}
        {data.canManage && !check && <Modal label={t("newClaim")} icon={<Icon name="plus" size={16} />} variant="primary">{newClaimForm}</Modal>}
      </>}>
        {data.claims.length === 0 ? <EmptyState icon="clipboard" title={t("none")} hint={data.canManage ? t("noneHint") : undefined} /> : (
          <div className="table-wrap"><table className="dense">
            <thead><tr><th>{t("number")}</th><th>{t("date")}</th><th>{t("claimant")}</th><th className="num">{t("trips")}</th><th className="num">{t("total")}</th><th>{t("status")}</th><th>{t("source")}</th></tr></thead>
            <tbody>{data.claims.map((c) => (
              <tr key={c.id}>
                <td className="ltr"><Link href={`/${locale}/claims/${c.id}`} className="cell-title">{c.claimNo}</Link></td>
                <td className="ltr">{c.claimDate}</td>
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

      {data.remote.length > 0 && (
        <Card title={t("remoteTitle")} subtitle={t("remoteHelp")} icon="upload" flush>
          <div className="table-wrap"><table className="dense">
            <thead><tr><th>{t("file")}</th><th>{t("date")}</th><th>{t("paidFrom")}</th><th className="num">{t("rows")}</th><th>{t("status")}</th><th /></tr></thead>
            <tbody>{data.remote.map((r) => (
              <tr key={r.id}>
                <td className="ltr">{r.fileName}</td><td className="ltr">{r.settlementDate}</td><td>{r.money}</td><td className="num">{(r.rows as unknown[]).length}</td>
                <td><StatusBadge status={r.status} label={t(`remote_${r.status}`)} /></td>
                <td><Link href={`${basePath}/remote/${r.id}`} className="btn ghost sm">{r.status === "staged" ? t("compare") : t("view")}</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
      )}
    </div>
  );
}
