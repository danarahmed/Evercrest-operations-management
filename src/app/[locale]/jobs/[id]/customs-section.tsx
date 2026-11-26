import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { Badge, Card, EmptyState, Stat, StatusBadge } from "@/components/ui";
import { dec } from "@/domain/money";
import { formatMoney, formatQty } from "@/lib/format";
import type { jobCustomsData } from "@/server/queries";
import { CustomsUpload } from "./customs/CustomsUpload";

type Data = Awaited<ReturnType<typeof jobCustomsData>>;
const key = () => crypto.randomUUID();

/**
 * The job's customs (owner's rules, 2026-11): the rate per MT and the border person on top; the trucks' duty,
 * what was paid to him and his balance; "Pay the customs agent" (lump sums), "Book customs" (the trucks' duty
 * against that money), and his own statement compared truck by truck. Kept apart from the trip fees.
 */
export async function CustomsSection({ locale, jobId, unit, data, routes, moneyAccounts }: {
  locale: string;
  jobId: string;
  unit: string;
  data: Data;
  routes: { id: string; name: string }[];
  moneyAccounts: { id: string; name: string; currency: string }[];
}) {
  const t = await getTranslations({ locale, namespace: "Customs" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const today = new Date().toISOString().slice(0, 10);
  const m = (a: string, c: string) => formatMoney(a, c, locale);
  const routeName = (id: string | null) => (id ? (routes.find((r) => r.id === id)?.name ?? "?") : t("wholeJob"));
  const inForce = data.rates.find((r) => r.routeId === null && r.effectiveFrom <= today);
  const paidByCur = new Map<string, number>();
  for (const p of data.payments) if (p.status === "posted") paidByCur.set(p.currency, (paidByCur.get(p.currency) ?? 0) + Number(p.amount));
  const plus = <Icon name="plus" size={16} />;

  const settingsForm = (
    <ActionForm command="job_customs.set" locale={locale} idempotencyKey={key()} submitLabel={f("save")}>
      <input type="hidden" name="jobId" value={jobId} />
      <p className="muted small">{t("agentHelp")}</p>
      <div className="grid2">
        <label>{t("agent")}<select name="agentId" defaultValue={data.card.agentId ?? ""}><option value="">{f("choose")}</option>{data.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>{t("orNewAgent")}<input name="agentName" /></label>
      </div>
      <label className="check"><input type="checkbox" name="billedToCustomer" defaultChecked={data.card.billedToCustomer} />{t("billedToCustomer")}</label>
    </ActionForm>
  );

  return (
    <div className="stack">
      {data.totals.length === 0 && !data.card.agentId && (
        <div className="banner"><Icon name="info" /><div><div className="banner-label">{t("startTitle")}</div><div>{t("startHelp")}</div></div></div>
      )}

      {data.totals.map((s) => {
        const bal = data.balance[s.currency] ?? "0";
        return (
          <div key={s.currency} className="stats">
            <Stat icon="truck" label={t("trucks")} value={s.trucks} hint={t("customsMt", { qty: formatQty(s.qty, unit, locale) })} />
            <Stat icon="receipt" label={t("duty")} value={m(s.duty, s.currency)} hint={s.unbookedTrucks ? t("notBooked", { count: s.unbookedTrucks, amount: m(s.unbooked, s.currency) }) : t("allBooked")} tone={s.unbookedTrucks ? "warning" : undefined} />
            <Stat icon="wallet" label={t("paidToAgent")} value={m(String(paidByCur.get(s.currency) ?? 0), s.currency)} hint={data.agent?.name} />
            <Stat icon="layers" label={dec(bal).lt(0) ? t("owedToAgent") : t("withAgent")} value={m(dec(bal).abs().toString(), s.currency)} tone={dec(bal).lt(0) ? "danger" : "success"} hint={s.differs ? t("trucksDiffer", { count: s.differs }) : undefined} />
          </div>
        );
      })}

      <Card title={t("title")} subtitle={t("help")} icon="flag" actions={
        <div className="flex flex-wrap gap-2">
          {data.canPay && data.card.agentId && (
            <Modal label={t("payAgent")} icon={<Icon name="wallet" size={16} />} variant="primary" small>
              <ActionForm command="customs.pay_agent" locale={locale} idempotencyKey={key()} submitLabel={t("pay")} summary={`${t("payAgent")} · ${data.agent?.name ?? ""}`}>
                <input type="hidden" name="jobId" value={jobId} />
                <p className="muted small">{t("payHelp", { agent: data.agent?.name ?? "" })}</p>
                <div className="grid2">
                  <label>{t("amount")}<input name="amount" required inputMode="decimal" dir="ltr" /></label>
                  <label>{t("from")}<select name="moneyAccountId" required defaultValue="">{[<option key="" value="">{f("choose")}</option>, ...moneyAccounts.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)]}</select></label>
                  <label>{f("date")}<input type="date" name="paymentDate" required defaultValue={today} /></label>
                  <label>{t("method")}<select name="method" defaultValue="cash"><option value="cash">{t("method_cash")}</option><option value="bank_transfer">{t("method_bank_transfer")}</option><option value="cheque">{t("method_cheque")}</option><option value="other">{t("method_other")}</option></select></label>
                </div>
                <label>{t("reference")} <span className="hint">{f("optional")}</span><input name="reference" /></label>
              </ActionForm>
            </Modal>
          )}
          {data.canBook && data.card.agentId && data.totals.some((s) => s.unbookedTrucks > 0) && (
            <Modal label={t("book")} icon={<Icon name="checkCircle" size={16} />} small>
              <ActionForm command="customs.book" locale={locale} idempotencyKey={key()} submitLabel={t("book")} confirm={t("bookConfirm")}>
                <input type="hidden" name="jobId" value={jobId} />
                <p className="muted small">{t("bookHelp")}</p>
                <label>{t("bookUpTo")}<input type="date" name="bookingDate" required defaultValue={today} /></label>
              </ActionForm>
            </Modal>
          )}
          {data.canImport && (
            <Modal label={t("importStatement")} icon={<Icon name="upload" size={16} />} small>
              <CustomsUpload locale={locale} jobId={jobId} idempotencyKey={key()} />
            </Modal>
          )}
        </div>
      }>
        <dl className="kv cols">
          <div><dt>{t("rate")}</dt><dd>{inForce ? <>{m(inForce.rate, inForce.currency)} / {unit} <span className="muted small">· {t("since", { date: inForce.effectiveFrom })}</span></> : <span className="muted">{t("noRate")}</span>}</dd></div>
          <div><dt>{t("agent")}</dt><dd>{data.agent ? <Link href={`/${locale}/finance/partners/${data.agent.id}`}>{data.agent.name}</Link> : <span className="muted">{t("noAgent")}</span>}</dd></div>
          <div><dt>{t("carriedBy")}</dt><dd>{data.card.billedToCustomer ? <Badge tone="info">{t("onInvoice")}</Badge> : <Badge>{t("jobCost")}</Badge>}</dd></div>
        </dl>
        {data.canSet && (
          <div className="flex flex-wrap gap-2" style={{ marginTop: 12 }}>
            <Modal label={t("setRate")} icon={plus} small>
              <ActionForm command="customs_rates.set" locale={locale} idempotencyKey={key()} submitLabel={f("save")}>
                <input type="hidden" name="jobId" value={jobId} />
                <p className="muted small">{t("rateHelp")}</p>
                <div className="grid2">
                  <label>{t("from")}<input type="date" name="effectiveFrom" required defaultValue={inForce?.effectiveFrom ?? today} /></label>
                  <label>{t("route")} <span className="hint">{t("routeHint")}</span><select name="routeId" defaultValue=""><option value="">{t("wholeJob")}</option>{routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
                  <label>{t("ratePerUnit", { unit })}<input name="rate" required inputMode="decimal" dir="ltr" defaultValue={inForce ? String(Number(inForce.rate)) : ""} /></label>
                  <label>{f("currency")}<select name="currency" defaultValue={inForce?.currency ?? "USD"}><option value="USD">USD</option><option value="IQD">IQD</option></select></label>
                </div>
                <label>{t("note")} <span className="hint">{f("optional")}</span><input name="note" /></label>
              </ActionForm>
            </Modal>
            <Modal label={t("setAgent")} icon={<Icon name="users" size={16} />} variant="ghost" small>{settingsForm}</Modal>
          </div>
        )}
      </Card>

      {data.rates.length > 0 && (
        <Card title={t("ratesTitle")} icon="sliders" flush>
          <div className="table-wrap"><table className="dense">
            <thead><tr><th>{t("from")}</th><th>{t("route")}</th><th className="num">{t("ratePerUnit", { unit })}</th><th>{t("note")}</th></tr></thead>
            <tbody>{data.rates.map((r) => <tr key={r.id}><td className="ltr">{r.effectiveFrom}</td><td>{routeName(r.routeId)}</td><td className="num">{m(r.rate, r.currency)}</td><td className="wrap muted">{r.note ?? ""}</td></tr>)}</tbody>
          </table></div>
        </Card>
      )}

      <Card title={t("paymentsTitle")} icon="wallet" flush>
          {data.payments.length === 0 ? <EmptyState icon="wallet" title={t("noPayments")} /> : (
            <div className="table-wrap"><table className="dense">
              <thead><tr><th>{t("number")}</th><th>{f("date")}</th><th className="num">{t("amount")}</th><th>{t("status")}</th></tr></thead>
              <tbody>{data.payments.map((p) => <tr key={p.id} className={p.status === "reversed" ? "muted" : undefined}><td className="ltr">{p.paymentNo}{p.reference && <div className="cell-sub">{p.reference}</div>}</td><td className="ltr">{p.paymentDate}</td><td className="num">{m(p.amount, p.currency)}</td><td><StatusBadge status={p.status} label={t(`pay_status_${p.status}`)} /></td></tr>)}</tbody>
            </table></div>
          )}
        </Card>
        <Card title={t("bookingsTitle")} icon="checkCircle" flush>
          {data.bookings.length === 0 ? <EmptyState icon="checkCircle" title={t("noBookings")} /> : (
            <div className="table-wrap"><table className="dense">
              <thead><tr><th>{t("number")}</th><th>{f("date")}</th><th className="num">{t("qty", { unit })}</th><th className="num">{t("amount")}</th><th>{t("status")}</th><th /></tr></thead>
              <tbody>{data.bookings.map((b) => (
                <tr key={b.id} className={b.status === "reversed" ? "muted" : undefined}>
                  <td className="ltr">{b.bookingNo}</td><td className="ltr">{b.bookingDate}</td><td className="num">{formatQty(b.quantity, unit, locale)}</td><td className="num">{m(b.total, b.currency)}</td>
                  <td><StatusBadge status={b.status} label={t(`status_${b.status}`)} /></td>
                  <td className="actions-cell">{data.canReverse && b.status === "posted" && (
                    <Modal label={t("reverse")} title={<>{t("reverse")} · <span className="ltr">{b.bookingNo}</span></>} variant="ghost" small>
                      <p className="muted">{t("reverseHelp")}</p>
                      <ActionForm command="customs.reverse_booking" locale={locale} idempotencyKey={key()} submitLabel={t("reverse")} variant="danger">
                        <input type="hidden" name="bookingId" value={b.id} />
                        <div className="grid2">
                          <label>{f("date")}<input type="date" name="reversalDate" required defaultValue={today} /></label>
                          <label>{t("reason")}<input name="reason" required /></label>
                        </div>
                      </ActionForm>
                    </Modal>
                  )}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>

      {data.statements.length > 0 && (
        <Card title={t("statementsTitle")} icon="upload" flush>
          <div className="table-wrap"><table className="dense">
            <thead><tr><th>{t("file")}</th><th>{f("date")}</th></tr></thead>
            <tbody>{data.statements.map((s) => <tr key={s.id}><td><Link href={`/${locale}/jobs/${jobId}/customs/${s.id}`} className="ltr">{s.fileName}</Link></td><td className="ltr">{s.createdAt.toISOString().slice(0, 10)}</td></tr>)}</tbody>
          </table></div>
        </Card>
      )}
    </div>
  );
}
