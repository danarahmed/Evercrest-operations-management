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
import { formatMoney, formatQty } from "@/lib/format";
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
  const neg = (x: string) => (x === "0" ? "—" : `−${m(x)}`);
  const hasWaiver = active.some((l) => l.calc.carrier.fineWaived && l.calc.carrier.fineWaived !== "0");
  const hasDem = active.some((l) => l.calc.carrier.demurrage !== "0");
  const hasCut = active.some((l) => l.calc.carrier.transporterCut !== "0");
  const hasOther = active.some((l) => l.calc.carrier.otherDeduction !== "0");
  const hasReward = active.some((l) => l.calc.carrier.reward !== "0");
  const methods = ["cash", "bank_transfer", "cheque", "other"];

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
        title={c.claimant}
        subtitle={<>{c.jobName} · {c.claimDate}{c.notes ? <> · <em>{c.notes}</em></> : null}</>}
        actions={actions}
      />
      <div className="stats">
        <Stat icon="truck" label={t("trips")} value={active.length} />
        <Stat icon="wallet" label={t("claimTotalLabel")} value={m(c.totalFinal)} tone={dec(c.totalFinal).lt(0) ? "danger" : undefined} hint={c.total !== c.totalFinal ? t("roundedFrom", { amount: m(c.total) }) : undefined} />
        <Stat icon="checkCircle" label={t("paidLabel")} value={m(v.paid)} tone={dec(v.paid).gt(0) ? "success" : undefined} />
        <Stat icon="clock" label={open.gt(0) ? t("stillToPay") : open.lt(0) ? t("claimantOwes") : t("settled")} value={m(open.abs().toString())} tone={open.gt(0) ? "warning" : open.lt(0) ? "danger" : "success"} />
      </div>

      <Card flush title={t("linesTitle")} icon="list">
        <div className="table-wrap"><table className="dense trips">
          <thead><tr>
            <th>{t("manifest")}</th><th>{t("driver")}</th><th>{t("plate")}</th><th>{t("transporterAtLoading")}</th><th>{t("loadedOn")}</th><th>{t("dischargedOn")}</th>
            <th className="num">{t("loaded")}</th><th className="num">{t("discharged")}</th><th className="num">{t("net")}</th><th className="num">{t("price")}</th><th className="num">{t("freight")}</th>
            {hasReward && <th className="num">{t("reward")}</th>}<th className="num">{t("fine")}</th>{hasWaiver && <th className="num">{t("waived")}</th>}{hasDem && <th className="num">{t("demurrage")}</th>}
            <th className="num">{t("feesDeducted")}</th>{hasOther && <th className="num">{t("otherDeduction")}</th>}{hasCut && <th className="num">{t("transporterCut")}</th>}
            <th className="num">{t("earned")}</th><th className="num">{t("advance")}</th><th className="num">{t("toPay")}</th>
          </tr></thead>
          <tbody>{active.map((l) => {
            const k = l.calc;
            return (
              <tr key={l.tripId}>
                <td className="ltr"><Link href={`/${locale}/jobs/${c.jobId}?tab=trips&trip=${l.tripId}`} className="cell-title">{l.manifestNo ?? l.tripNo}</Link></td>
                <td>{l.driver}</td><td className="ltr">{l.plate}</td><td>{l.transporter ?? <span className="muted">{t("direct")}</span>}</td>
                <td className="ltr">{l.loadingDate}</td><td className="ltr">{l.dischargeDate}</td>
                <td className="num">{formatQty(k.loaded, k.unit, locale)}</td><td className="num">{k.discharged ? formatQty(k.discharged, k.unit, locale) : "—"}</td><td className="num">{formatQty(k.net, k.unit, locale)}</td>
                <td className="num">{k.carrier.price ? m(k.carrier.price) : "—"}</td><td className="num">{m(k.carrier.freight)}</td>
                {hasReward && <td className="num">{m(k.carrier.reward)}</td>}
                <td className="num neg">{k.carrier.fine !== "0" ? m(k.carrier.fine) : "—"}</td>
                {hasWaiver && <td className="num">{k.carrier.fineWaived && k.carrier.fineWaived !== "0" ? m(k.carrier.fineWaived) : "—"}</td>}
                {hasDem && <td className="num">{k.carrier.demurrage !== "0" ? m(k.carrier.demurrage) : "—"}</td>}
                <td className="num">{k.carrier.feeDeductions !== "0" ? `−${m(k.carrier.feeDeductions)}` : "—"}</td>
                {hasOther && <td className="num">{k.carrier.otherDeduction !== "0" ? `−${m(k.carrier.otherDeduction)}` : "—"}</td>}
                {hasCut && <td className="num">{k.carrier.transporterCut !== "0" ? `−${m(k.carrier.transporterCut)}` : "—"}</td>}
                <td className="num"><strong>{m(k.carrier.total)}</strong></td>
                <td className="num">{k.carrier.advance !== "0" ? `−${m(k.carrier.advance)}` : "—"}</td>
                <td className={`num ${dec(l.amount).lt(0) ? "neg" : ""}`}><strong>{m(l.amount)}</strong></td>
              </tr>
            );
          })}</tbody>
          <tfoot><tr className="net">
            <td colSpan={6}><strong>{t("claimTotal", { count: active.length })}</strong></td>
            <td className="num"><strong>{formatQty(sum((l) => l.calc.loaded), active[0]?.calc.unit ?? "MT", locale)}</strong></td><td /><td className="num"><strong>{formatQty(sum((l) => l.calc.net), active[0]?.calc.unit ?? "MT", locale)}</strong></td><td />
            <td className="num"><strong>{m(sum((l) => l.calc.carrier.freight))}</strong></td>
            {hasReward && <td className="num"><strong>{m(sum((l) => l.calc.carrier.reward))}</strong></td>}
            <td className="num neg"><strong>{sum((l) => l.calc.carrier.fine) === "0" ? "—" : m(sum((l) => l.calc.carrier.fine))}</strong></td>
            {hasWaiver && <td className="num"><strong>{m(sum((l) => l.calc.carrier.fineWaived ?? "0"))}</strong></td>}
            {hasDem && <td className="num"><strong>{m(sum((l) => l.calc.carrier.demurrage))}</strong></td>}
            <td className="num"><strong>{neg(sum((l) => l.calc.carrier.feeDeductions))}</strong></td>
            {hasOther && <td className="num"><strong>{neg(sum((l) => l.calc.carrier.otherDeduction))}</strong></td>}
            {hasCut && <td className="num"><strong>{neg(sum((l) => l.calc.carrier.transporterCut))}</strong></td>}
            <td className="num"><strong>{m(sum((l) => l.calc.carrier.total))}</strong></td>
            <td className="num"><strong>{neg(sum((l) => l.calc.carrier.advance))}</strong></td>
            <td className="num"><strong>{m(c.total)}</strong></td>
          </tr>
          {c.total !== c.totalFinal && <tr className="net"><td colSpan={hasReward ? 20 : 19}>{t("rounding")}</td><td className="num"><strong>{m(c.totalFinal)}</strong></td></tr>}
          </tfoot>
        </table></div>
      </Card>

      <Card title={t("paymentsTitle")} icon="wallet" flush>
        {v.payments.length === 0 ? <div className="card-body muted">{c.status === "posted" ? t("noPaymentsYet") : t("noPayments")}</div> : (
          <div className="table-wrap"><table className="dense">
            <thead><tr><th>{t("number")}</th><th>{t("date")}</th><th>{t("method")}</th><th className="num">{t("amount")}</th></tr></thead>
            <tbody>{v.payments.map((p) => <tr key={p.id}><td className="ltr">{p.paymentNo}</td><td className="ltr">{p.date}</td><td>{t(`method_${p.method}`)}{p.direction === "in" && <span className="muted"> · {t("moneyIn")}</span>}</td><td className={`num ${p.direction === "in" ? "neg" : ""}`}><strong>{p.direction === "in" ? "−" : ""}{m(p.amount)}</strong></td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
    </Shell>
  );
}
