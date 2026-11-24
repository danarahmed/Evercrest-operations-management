import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { dec, toStr } from "@/domain/money";
import { formatMoney } from "@/lib/format";
import type { jobUnpaidFees } from "@/server/queries";

type Unpaid = Awaited<ReturnType<typeof jobUnpaidFees>>;

/**
 * The trips tab's fee tools: put one kind of fee on many trips at once (the manifests it covers), and pay the
 * fees the company owes in one payment per kind of fee (e.g. the customs of 20 trucks).
 */
export async function FeeTools({ locale, jobId, feeTypes, unpaid, moneyAccounts, canAdd, canPay }: {
  locale: string;
  jobId: string;
  feeTypes: { id: string; name: string; defaultAmount: string | null; defaultCurrency: string | null }[];
  unpaid: Unpaid;
  moneyAccounts: { id: string; name: string; currency: string }[];
  canAdd: boolean;
  canPay: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "Fees" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const today = new Date().toISOString().slice(0, 10);
  // One "Pay" per kind of fee and currency, with every unpaid fee of that kind ticked.
  const groups = [...new Map(unpaid.filter((u) => u.amount !== null).map((u) => [`${u.feeTypeId}:${u.currency}`, { feeTypeId: u.feeTypeId, name: u.name, currency: u.currency }])).values()].map((g) => {
    const items = unpaid.filter((u) => u.feeTypeId === g.feeTypeId && u.currency === g.currency && u.amount !== null);
    return { ...g, items, total: toStr(items.reduce((a, u) => a.plus(dec(u.amount!)), dec("0"))) };
  });
  return (
    <>
      {canAdd && feeTypes.length > 0 && (
        <Modal label={t("addToTrips")} icon={<Icon name="plus" size={16} />} small>
          <p className="muted">{t("addToTripsHelp")}</p>
          <ActionForm command="trip_fees.add_many" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("addSubmit")}>
            <input type="hidden" name="jobId" value={jobId} />
            <div className="grid2">
              <label>{t("fee")}<select name="feeTypeId" required>{feeTypes.map((x) => <option key={x.id} value={x.id}>{x.name}{x.defaultAmount ? ` · ${formatMoney(x.defaultAmount, x.defaultCurrency ?? "USD", locale)}` : ""}</option>)}</select></label>
              <label>{t("amount")} <span className="hint">{t("amountHint")}</span><input name="amount" inputMode="decimal" dir="ltr" /></label>
            </div>
            <label>{t("manifests")} <span className="hint">{t("manifestsHint")}</span><textarea name="manifests" rows={4} required dir="ltr" /></label>
          </ActionForm>
        </Modal>
      )}
      {canPay && groups.length > 0 && (
        // Keyed on the unpaid fees: after a payment the list changes and the window starts again closed,
        // even when the paid kind's form is gone with it.
        <Modal key={unpaid.map((u) => u.id).join()} label={t("payFees", { count: unpaid.length })} icon={<Icon name="wallet" size={16} />} size="sm" small>
          <p className="muted">{t("payHelp")}</p>
          {groups.map((g) => (
            <details key={`${g.feeTypeId}:${g.currency}`} className="panel">
              <summary>{g.name} · {t("trucks", { count: g.items.length })} · {formatMoney(g.total, g.currency, locale)}</summary>
              <ActionForm command="fees.pay" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("paySubmit")} summary={`${g.name} · ${formatMoney(g.total, g.currency, locale)}`}>
                <div className="grid gap-1.5 rounded-lg border border-slate-200 p-3" style={{ maxHeight: 220, overflowY: "auto" }}>
                  {g.items.map((u) => (
                    <label key={u.id} className="check"><input type="checkbox" name="tripFeeIds[]" value={u.id} defaultChecked />
                      <span className="ltr">{u.manifest}</span><span className="muted small">{u.loadingDate}</span><span className="ms-auto num">{formatMoney(u.amount!, u.currency, locale)}</span>
                    </label>
                  ))}
                </div>
                <div className="grid2">
                  <label>{t("from")}<select name="moneyAccountId" required>{moneyAccounts.filter((m) => m.currency === g.currency).map((m) => <option key={m.id} value={m.id}>{m.name} ({m.currency})</option>)}</select></label>
                  <label>{f("date")}<input type="date" name="paymentDate" required defaultValue={today} /></label>
                </div>
                <label>{t("reference")} <span className="hint">{f("optional")}</span><input name="reference" /></label>
              </ActionForm>
            </details>
          ))}
        </Modal>
      )}
    </>
  );
}
