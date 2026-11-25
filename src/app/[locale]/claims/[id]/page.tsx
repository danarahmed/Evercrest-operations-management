import { eq } from "drizzle-orm";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { Modal } from "@/components/Modal";
import { PrintButton } from "@/components/PrintButton";
import { Badge, Card, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { dec } from "@/domain/money";
import { formatMoney, formatNumber, formatQty } from "@/lib/format";
import { can } from "@/server/authz";
import { claimView } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../shell";

export const dynamic = "force-dynamic";

/** A claim like the owner's settlement form: every trip with its figures, the total, the payments, and the actions. */
export default async function ClaimPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Claims" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const v = await claimView(db, actor, id);
  const c = v.claim;
  const cur = c.currency;
  const m = (a: string) => formatMoney(a, cur, locale);
  const today = new Date().toISOString().slice(0, 10);
  const open = dec(v.open);
  const active = v.lines.filter((l) => l.active);
  const sum = (pick: (l: (typeof active)[number]) => string) => active.reduce((a, l) => a.plus(dec(pick(l))), dec("0")).toString();
  const unit = active[0]?.calc.unit ?? "MT";
  const neg = (x: string) => (x === "0" ? "—" : `−${m(x)}`);
  /** A fine is stored negative; show it like the other deductions: a minus sign, then the amount. */
  const minus = (x: string) => (dec(x).isZero() ? "—" : `−${m(dec(x).abs().toString())}`);
  const hasWaiver = active.some((l) => l.calc.carrier.fineWaived && l.calc.carrier.fineWaived !== "0");
  const hasDem = active.some((l) => l.calc.carrier.demurrage !== "0");
  const hasCut = active.some((l) => l.calc.carrier.transporterCut !== "0");
  const hasOther = active.some((l) => l.calc.carrier.otherDeduction !== "0");
  // Deductions the company keeps as income (claims made before they existed have none).
  const kept = (l: (typeof active)[number]) => l.calc.carrier.companyDeductions ?? "0";
  const hasKept = active.some((l) => kept(l) !== "0");
  const hasReward = active.some((l) => l.calc.carrier.reward !== "0");
  const methods = ["cash", "bank_transfer", "cheque", "other"];
  const canReverse = can(actor, "payments.reverse");

  const actions = (
    <>
      <PrintButton label={t("print")} />
      {c.status === "posted" && !open.isZero() && v.canPay && v.payFrom.length > 0 && (
        <Modal label={open.gt(0) ? t("pay") : t("collect")} variant="primary" size="sm">
          <p className="muted">{open.gt(0) ? t("payHelp", { amount: m(v.open), claimant: c.claimant }) : t("collectHelp", { amount: m(open.abs().toString()), claimant: c.claimant })}</p>
          <ActionForm command="claims.pay" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={open.gt(0) ? t("paySubmit") : t("collectSubmit")} summary={`${c.claimNo} · ${c.claimant}`}>
            <input type="hidden" name="claimId" value={c.id} />
            <div className="grid2">
              <label>{t("amount")} <span className="hint">{t("amountHint")}</span><input name="amount" inputMode="decimal" placeholder={open.abs().toString()} dir="ltr" /></label>
              <label>{open.gt(0) ? t("payFrom") : t("collectInto")}<select name="moneyAccountId" required>{v.payFrom.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}</select></label>
              <label>{f("date")}<input type="date" name="paymentDate" required defaultValue={today} /></label>
              <label>{t("method")}<select name="method" defaultValue="cash">{methods.map((x) => <option key={x} value={x}>{t(`method_${x}`)}</option>)}</select></label>
            </div>
            <label>{t("reference")}<input name="reference" /></label>
          </ActionForm>
        </Modal>
      )}
      {c.status !== "cancelled" && v.payments.length === 0 && v.canManage && (
        <Modal label={t("cancelTitle")} variant="danger" size="sm">
          <p className="muted">{t("cancelHelp")}</p>
          <ActionForm command="claims.cancel" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("cancelSubmit")} variant="danger">
            <input type="hidden" name="claimId" value={c.id} />
            <input type="hidden" name="cancelDate" value={today} />
            <label>{t("reason")}<input name="reason" required /></label>
          </ActionForm>
        </Modal>
      )}
    </>
  );

  return (
    <Shell wide permissions={actor.permissions} locale={locale} userName={user.displayName} path="/claims" crumb={c.claimNo}>
      <PageHeader
        back={{ href: `/${locale}/claims`, label: t("pageTitle") }}
        eyebrow={<><span className="ltr">{c.claimNo}</span><span>·</span><Link href={`/${locale}/jobs/${c.jobId}?tab=claims`}>{c.jobNo}</Link><StatusBadge status={c.status} label={t(`status_${c.status}`)} />{c.source === "remote" && <Badge tone="violet">{t("source_remote")}</Badge>}</>}
        title={can(actor, "reports.financial.view") ? <Link href={`/${locale}/finance/partners/${c.claimantId}`} className="title-link">{c.claimant}</Link> : c.claimant}
        subtitle={<>{c.jobName} · {c.claimDate}{c.notes ? <> · <em>{c.notes}</em></> : null}</>}
        actions={actions}
      />
      <div className="stats">
        <Stat emphasis icon="clock" label={open.gt(0) ? t("weOweName", { name: c.claimant }) : open.lt(0) ? t("nameOwes", { name: c.claimant }) : t("settled")} value={open.isZero() ? t("nothingOpen") : m(open.abs().toString())} flag={open.lt(0) ? t("claimantOwes") : undefined} hint={open.gt(0) && dec(v.paid).gt(0) ? `${t("paidLabel")}: ${m(v.paid)}` : undefined} />
        <Stat icon="wallet" label={t("claimTotalLabel")} value={m(c.totalFinal)} tone={dec(c.totalFinal).lt(0) ? "danger" : undefined} hint={c.total !== c.totalFinal ? t("roundedFrom", { amount: m(c.total) }) : `${active.length} ${t("trips").toLowerCase()} · ${formatNumber(sum((l) => l.calc.net), locale)} ${unit}`} />
        <Stat icon="checkCircle" label={t("earned")} value={m(sum((l) => l.calc.carrier.total))} />
        <Stat icon="truck" label={t("advancesTaken")} value={m(sum((l) => l.calc.carrier.advance))} />
      </div>

      <Card flush title={t("linesTitle")} icon="list">
        <div className="table-wrap"><table className="dense trips">
          <thead><tr>
            <th>{t("manifest")}</th><th>{t("driver")}</th><th>{t("transporterAtLoading")}</th><th>{t("loadedOn")}<br />{t("dischargedOn")}</th>
            <th className="num">{t("loaded")}<br />{t("discharged")}</th><th className="num">{t("net")} ({unit})</th><th className="num">{t("freight")}</th>
            {hasReward && <th className="num">{t("reward")}</th>}<th className="num">{t("fine")}</th>{hasWaiver && <th className="num">{t("waived")}</th>}{hasDem && <th className="num">{t("demurrage")}</th>}
            <th className="num">{t("feesDeducted")}</th>{hasOther && <th className="num">{t("otherDeduction")}</th>}{hasKept && <th className="num">{t("keptByCompany")}</th>}{hasCut && <th className="num">{t("transporterCut")}</th>}
            <th className="num">{t("earned")}</th><th className="num">{t("advance")}</th><th className="num">{t("toPay")}</th>
          </tr></thead>
          <tbody>{active.map((l) => {
            const k = l.calc;
            return (
              <tr key={l.tripId}>
                <td className="ltr"><Link href={`/${locale}/jobs/${c.jobId}?tab=trips&trip=${l.tripId}`} className="cell-title">{l.manifestNo ?? l.tripNo}</Link></td>
                <td className="clip" title={`${l.driver} · ${l.plate}`}>{l.driver}<div className="cell-sub ltr">{l.plate}</div></td>
                <td className="clip" title={l.transporter ?? undefined}>{l.transporter ?? <span className="muted">{t("direct")}</span>}</td>
                <td className="ltr">{l.loadingDate}<div className="cell-sub">{l.dischargeDate}</div></td>
                <td className="num">{formatNumber(k.loaded, locale)}<div className="cell-sub">{k.discharged ? formatNumber(k.discharged, locale) : "—"}</div></td>
                <td className="num">{formatNumber(k.net, locale)}</td>
                <td className="num" title={k.carrier.price ? `${formatNumber(k.net, locale)} × ${m(k.carrier.price)}` : undefined}>{m(k.carrier.freight)}</td>
                {hasReward && <td className="num">{m(k.carrier.reward)}</td>}
                <td className="num neg">{minus(k.carrier.fine)}</td>
                {hasWaiver && <td className="num">{k.carrier.fineWaived && k.carrier.fineWaived !== "0" ? m(k.carrier.fineWaived) : "—"}</td>}
                {hasDem && <td className="num">{k.carrier.demurrage !== "0" ? m(k.carrier.demurrage) : "—"}</td>}
                <td className="num">{k.carrier.feeDeductions !== "0" ? `−${m(k.carrier.feeDeductions)}` : "—"}</td>
                {hasOther && <td className="num">{k.carrier.otherDeduction !== "0" ? `−${m(k.carrier.otherDeduction)}` : "—"}</td>}
                {hasKept && <td className="num">{(k.carrier.companyDeductions ?? "0") !== "0" ? `−${m(k.carrier.companyDeductions!)}` : "—"}</td>}
                {hasCut && <td className="num">{k.carrier.transporterCut !== "0" ? `−${m(k.carrier.transporterCut)}` : "—"}</td>}
                <td className="num"><strong>{m(k.carrier.total)}</strong></td>
                <td className="num">{k.carrier.advance !== "0" ? `−${m(k.carrier.advance)}` : "—"}</td>
                <td className={`num ${dec(l.amount).lt(0) ? "neg" : ""}`}><strong>{m(l.amount)}</strong></td>
              </tr>
            );
          })}</tbody>
          <tfoot><tr className="subtotal">
            <td colSpan={4}><strong>{t("claimTotal", { count: active.length })}</strong></td>
            <td className="num"><strong>{formatNumber(sum((l) => l.calc.loaded), locale)}</strong></td><td className="num"><strong>{formatNumber(sum((l) => l.calc.net), locale)}</strong></td>
            <td className="num"><strong>{m(sum((l) => l.calc.carrier.freight))}</strong></td>
            {hasReward && <td className="num"><strong>{m(sum((l) => l.calc.carrier.reward))}</strong></td>}
            <td className="num neg"><strong>{minus(sum((l) => l.calc.carrier.fine))}</strong></td>
            {hasWaiver && <td className="num"><strong>{m(sum((l) => l.calc.carrier.fineWaived ?? "0"))}</strong></td>}
            {hasDem && <td className="num"><strong>{m(sum((l) => l.calc.carrier.demurrage))}</strong></td>}
            <td className="num"><strong>{neg(sum((l) => l.calc.carrier.feeDeductions))}</strong></td>
            {hasOther && <td className="num"><strong>{neg(sum((l) => l.calc.carrier.otherDeduction))}</strong></td>}
            {hasKept && <td className="num"><strong>{neg(sum(kept))}</strong></td>}
            {hasCut && <td className="num"><strong>{neg(sum((l) => l.calc.carrier.transporterCut))}</strong></td>}
            <td className="num"><strong>{m(sum((l) => l.calc.carrier.total))}</strong></td>
            <td className="num"><strong>{neg(sum((l) => l.calc.carrier.advance))}</strong></td>
            <td className="num"><strong>{m(c.total)}</strong></td>
          </tr>
          {c.total !== c.totalFinal && <tr className="net"><td colSpan={99}>{t("rounding")}</td><td className="num"><strong>{m(c.totalFinal)}</strong></td></tr>}
          </tfoot>
        </table></div>
      </Card>

      <div className="grid side mb-5">
        <Card title={t("howTitle")} icon="list">
          <div className="grid items-start gap-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))" }}>
          <p className="m-0 max-w-[340px] text-[13.5px] text-slate-600">{t("howHelp")}</p>
          <div>
            <div className="amount-line"><span className="text-slate-600">{t("freight")}</span><span>{m(sum((l) => l.calc.carrier.freight))}</span></div>
            {hasReward && <div className="amount-line"><span className="text-slate-600">{t("reward")}</span><span>{m(sum((l) => l.calc.carrier.reward))}</span></div>}
            <div className="amount-line"><span className="text-slate-600">{t("fine")}</span><span className="neg">{minus(sum((l) => l.calc.carrier.fine))}</span></div>
            {hasWaiver && <div className="amount-line"><span className="text-slate-600">{t("waived")}</span><span>{m(sum((l) => l.calc.carrier.fineWaived ?? "0"))}</span></div>}
            {hasDem && <div className="amount-line"><span className="text-slate-600">{t("demurrage")}</span><span>{m(sum((l) => l.calc.carrier.demurrage))}</span></div>}
            <div className="amount-line"><span className="text-slate-600">{t("feesDeducted")}</span><span>{neg(sum((l) => l.calc.carrier.feeDeductions))}</span></div>
            {hasOther && <div className="amount-line"><span className="text-slate-600">{t("otherDeduction")}</span><span>{neg(sum((l) => l.calc.carrier.otherDeduction))}</span></div>}
            {hasKept && <div className="amount-line"><span className="text-slate-600">{t("keptByCompany")}</span><span>{neg(sum(kept))}</span></div>}
            {hasCut && <div className="amount-line"><span className="text-slate-600">{t("transporterCut")}</span><span>{neg(sum((l) => l.calc.carrier.transporterCut))}</span></div>}
            <div className="amount-line total"><span>{t("earned")}</span><span>{m(sum((l) => l.calc.carrier.total))}</span></div>
            <div className="amount-line"><span className="text-slate-600">{t("advancesTaken")}</span><span>{neg(sum((l) => l.calc.carrier.advance))}</span></div>
            {c.total !== c.totalFinal && <div className="amount-line"><span className="text-slate-600">{t("rounding")}</span><span>{m(dec(c.totalFinal).minus(dec(c.total)).toString())}</span></div>}
            {dec(v.paid).gt(0) ? <>
              <div className="amount-line total"><span>{t("claimTotalLabel")}</span><span>{m(c.totalFinal)}</span></div>
              <div className="amount-line"><span className="text-slate-600">{t("paidLabel")}</span><span>{neg(v.paid)}</span></div>
              <div className="amount-line final"><span>{open.lt(0) ? t("claimantOwes") : open.isZero() ? t("settled") : t("stillToPay")} · {cur}</span><span>{open.isZero() ? "—" : m(open.abs().toString())}</span></div>
            </> : <div className="amount-line final"><span>{t("claimTotalLabel")} · {cur}</span><span>{m(c.totalFinal)}</span></div>}
          </div>
          </div>
        </Card>
        {v.ledger.length > 0 && (
          <Card title={t("ledgerTitle")} icon="book" flush>
            <div className="table-wrap"><table className="dense">
              <thead><tr><th>{t("account")}</th><th className="num">{t("debit")}</th><th className="num">{t("credit")}</th></tr></thead>
              <tbody>{v.ledger.map((x, i) => <tr key={i}><td className="wrap"><span className="ltr text-slate-500">{x.code}</span> {x.name}</td><td className="num">{dec(x.debit).isZero() ? "" : m(x.debit)}</td><td className="num">{dec(x.credit).isZero() ? "" : m(x.credit)}</td></tr>)}</tbody>
              <tfoot><tr className="subtotal"><td>{t("balanced")}</td><td className="num">{m(v.ledger.reduce((a, x) => a.plus(dec(x.debit)), dec("0")).toString())}</td><td className="num">{m(v.ledger.reduce((a, x) => a.plus(dec(x.credit)), dec("0")).toString())}</td></tr></tfoot>
            </table></div>
          </Card>
        )}
      </div>

      <Card title={t("paymentsTitle")} icon="wallet" flush>
        {v.payments.length === 0 ? <div className="card-body muted">{c.status === "posted" ? t("noPaymentsYet") : t("noPayments")}</div> : (
          <div className="table-wrap"><table className="dense">
            <thead><tr><th>{t("number")}</th><th>{t("date")}</th><th>{t("method")}</th><th className="num">{t("amount")}</th><th /></tr></thead>
            <tbody>{v.payments.map((p) => <tr key={p.id}><td className="ltr">{p.paymentNo}</td><td className="ltr">{p.date}</td><td>{t(`method_${p.method}`)}{p.direction === "in" && <span className="muted"> · {t("moneyIn")}</span>}</td><td className={`num ${p.direction === "in" ? "neg" : ""}`}><strong>{p.direction === "in" ? "−" : ""}{m(p.amount)}</strong></td>
              <td className="num">{canReverse && (
                <Modal label={t("reversePayment")} variant="ghost" size="sm">
                  <p className="muted">{t("reverseHelp", { no: p.paymentNo })}</p>
                  <ActionForm command="payments.reverse" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("reverseSubmit")} variant="danger">
                    <input type="hidden" name="paymentId" value={p.id} />
                    <div className="grid2"><label>{f("date")}<input type="date" name="reversalDate" required defaultValue={today} /></label><label>{t("reason")}<input name="reason" required /></label></div>
                  </ActionForm>
                </Modal>
              )}</td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
    </Shell>
  );
}
