import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import type { customFields, trips } from "@/db/schema";
import { CAPABILITIES } from "@/domain/jobs/capabilities";
import type { FormOptions } from "@/server/queries";

type Trip = typeof trips.$inferSelect;
const today = () => new Date().toISOString().slice(0, 10);
const key = () => crypto.randomUUID();
const METHODS = ["cash", "bank_transfer", "cheque", "other"] as const;

/**
 * The job's data-entry actions, each a button that opens a dialog. Grouped by
 * what they are about so each tab only shows its own actions.
 */

/** Trips: start, loading, arrival, discharge, advances. */
export async function TransportActions({ locale, jobId, jobNo, capabilities, tripList, options }: {
  locale: string;
  jobId: string;
  jobNo: string;
  capabilities: string[];
  tripList: Trip[];
  options: FormOptions;
}) {
  const t = await getTranslations({ locale, namespace: "Forms" });
  const planned = tripList.filter((x) => x.status === "planned" || x.status === "loaded");
  const loaded = tripList.filter((x) => x.status === "loaded" || x.status === "discharged");
  const inTransit = tripList.filter((x) => x.status === "loaded");
  const live = tripList.filter((x) => x.status !== "cancelled");
  const unitSelect = (name: string) => (
    <select name={name} required defaultValue="MT">{options.units.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}</select>
  );
  return (
    <>
      {capabilities.includes("transportation") && (
        <Modal label={t("startTrip")} icon={<Icon name="plus" size={16} />} variant="primary" small>
          <ActionForm command="trips.create" locale={locale} idempotencyKey={key()} submitLabel={t("create")}>
            <input type="hidden" name="jobId" value={jobId} />
            <div className="grid2">
              <label>{t("driver")}<select name="driverId" defaultValue=""><option value="">{t("choose")}</option>{options.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
              <label>{t("orNewDriver")}<input name="newDriverName" /></label>
              <label>{t("truckPlate")}<input name="truckPlate" required dir="ltr" /></label>
              <label>{t("transporter")}<select name="transporterId" defaultValue=""><option value="">{t("direct")}</option>{options.transporters.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
              <label>{t("product")}<select name="productId" defaultValue=""><option value="">{t("choose")}</option>{options.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label>{t("loadingLocation")}<input name="loadingLocation" /></label>
              <label>{t("destination")}<input name="destination" /></label>
            </div>
          </ActionForm>
        </Modal>
      )}
      {planned.length > 0 && (
        <Modal label={t("recordLoading")} small>
          <ActionForm command="trips.record_loading" locale={locale} idempotencyKey={key()} submitLabel={t("save")}>
            <div className="grid2">
              <label>{t("trip")}<select name="tripId" required>{planned.map((x) => <option key={x.id} value={x.id}>{x.tripNo}</option>)}</select></label>
              <label>{t("date")}<input type="date" name="loadingDate" required defaultValue={today()} /></label>
              <label>{t("quantity")}<input name="loadedQty" required inputMode="decimal" dir="ltr" /></label>
              <label>{t("unit")}{unitSelect("loadedUnit")}</label>
              <label>{t("correctionReason")} <span className="hint">{t("onlyForCorrections")}</span><input name="reason" /></label>
            </div>
          </ActionForm>
        </Modal>
      )}
      {inTransit.length > 0 && (
        <Modal label={t("recordArrival")} small>
          <ActionForm command="trips.record_arrival" locale={locale} idempotencyKey={key()} submitLabel={t("save")}>
            <div className="grid2">
              <label>{t("trip")}<select name="tripId" required>{inTransit.map((x) => <option key={x.id} value={x.id}>{x.tripNo}</option>)}</select></label>
              <label>{t("date")}<input type="date" name="arrivalDate" required defaultValue={today()} /></label>
              <label>{t("correctionReason")} <span className="hint">{t("onlyForCorrections")}</span><input name="reason" /></label>
            </div>
          </ActionForm>
        </Modal>
      )}
      {loaded.length > 0 && (
        <Modal label={t("recordDischarge")} small>
          <ActionForm command="trips.record_discharge" locale={locale} idempotencyKey={key()} submitLabel={t("save")}>
            <div className="grid2">
              <label>{t("trip")}<select name="tripId" required>{loaded.map((x) => <option key={x.id} value={x.id}>{x.tripNo}</option>)}</select></label>
              <label>{t("date")}<input type="date" name="dischargeDate" required defaultValue={today()} /></label>
              <label>{t("quantity")}<input name="dischargedQty" required inputMode="decimal" dir="ltr" /></label>
              <label>{t("unit")}{unitSelect("dischargedUnit")}</label>
              <label>{t("correctionReason")} <span className="hint">{t("onlyForCorrections")}</span><input name="reason" /></label>
            </div>
          </ActionForm>
        </Modal>
      )}
      {capabilities.includes("advances") && live.length > 0 && options.moneyAccounts.length > 0 && (
        <Modal label={t("payAdvance")} icon={<Icon name="wallet" size={16} />} small>
          <ActionForm command="payments.record" locale={locale} idempotencyKey={key()} submitLabel={t("pay")} summary={`Advance for ${jobNo}`}>
            <input type="hidden" name="direction" value="out" />
            <input type="hidden" name="purpose" value="advance" />
            <div className="grid2">
              <label>{t("trip")}<select name="tripId" required>{live.map((x) => <option key={x.id} value={x.id}>{x.tripNo}</option>)}</select></label>
              <label>{t("paidFrom")}<select name="moneyAccountId" required>{options.moneyAccounts.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.currency})</option>)}</select></label>
              <label>{t("amount")}<input name="amount" required inputMode="decimal" dir="ltr" /></label>
              <label>{t("date")}<input type="date" name="paymentDate" required defaultValue={today()} /></label>
              <label>{t("method")}<select name="method" defaultValue="cash">{METHODS.map((m) => <option key={m} value={m}>{t(m)}</option>)}</select></label>
            </div>
          </ActionForm>
        </Modal>
      )}
    </>
  );
}

/** Costs: an expense paid now, or a supplier/contractor bill to pay later. */
export async function CostActions({ locale, jobId, jobNo, options }: { locale: string; jobId: string; jobNo: string; options: FormOptions }) {
  const t = await getTranslations({ locale, namespace: "Forms" });
  return (
    <>
      {options.moneyAccounts.length > 0 && options.expenseAccounts.length > 0 && (
        <Modal label={t("recordExpense")} icon={<Icon name="plus" size={16} />} variant="primary" small>
          <ActionForm command="payments.record" locale={locale} idempotencyKey={key()} submitLabel={t("save")} summary={`Expense for ${jobNo}`}>
            <input type="hidden" name="direction" value="out" />
            <input type="hidden" name="purpose" value="expense" />
            <input type="hidden" name="jobId" value={jobId} />
            <div className="grid2">
              <label>{t("expenseType")}<select name="counterAccountId" required>{options.expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label>
              <label>{t("description")}<input name="notes" required /></label>
              <label>{t("paidTo")}<select name="partnerId" defaultValue=""><option value="">—</option>{options.suppliers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label>{t("receiptNo")}<input name="reference" dir="ltr" /></label>
              <label>{t("paidFrom")}<select name="moneyAccountId" required>{options.moneyAccounts.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.currency})</option>)}</select></label>
              <label>{t("amount")}<input name="amount" required inputMode="decimal" dir="ltr" /></label>
              <label>{t("date")}<input type="date" name="paymentDate" required defaultValue={today()} /></label>
              <label>{t("method")}<select name="method" defaultValue="cash">{METHODS.map((m) => <option key={m} value={m}>{t(m)}</option>)}</select></label>
            </div>
          </ActionForm>
        </Modal>
      )}
      {options.suppliers.length > 0 && options.expenseAccounts.length > 0 && (
        <Modal label={t("supplierBill")} small>
          <p className="muted">{t("supplierBillHelp")}</p>
          <ActionForm command="invoices.job_bill" locale={locale} idempotencyKey={key()} submitLabel={t("save")}>
            <input type="hidden" name="kind" value="bill" />
            <input type="hidden" name="l_jobId[]" value={jobId} />
            <div className="grid2">
              <label>{t("supplier")}<select name="partnerId" required>{options.suppliers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label>{t("supplierBillNo")}<input name="externalRef" dir="ltr" /></label>
              <label>{t("expenseType")}<select name="l_accountId[]" required>{options.expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></label>
              <label>{t("description")}<input name="l_description[]" required /></label>
              <label>{t("quantity")}<input name="l_quantity[]" required inputMode="decimal" dir="ltr" defaultValue="1" /></label>
              <label>{t("unitPrice")}<input name="l_unitPrice[]" required inputMode="decimal" dir="ltr" /></label>
              <label>{t("currency")}<select name="currency" required><option value="IQD">IQD</option><option value="USD">USD</option></select></label>
              <label>{t("date")}<input type="date" name="invoiceDate" required defaultValue={today()} /></label>
              <label>{t("dueDate")}<input type="date" name="dueDate" /></label>
            </div>
          </ActionForm>
        </Modal>
      )}
    </>
  );
}

/** Record a received document (for the job or one of its trips). */
export async function DocumentAction({ locale, jobId, tripList, options }: { locale: string; jobId: string; tripList: Trip[]; options: FormOptions }) {
  const t = await getTranslations({ locale, namespace: "Forms" });
  if (!options.documentTypes.length) return null;
  const live = tripList.filter((x) => x.status !== "cancelled");
  return (
    <Modal label={t("recordDocument")} icon={<Icon name="plus" size={16} />} variant="primary" small>
      <ActionForm command="documents.record" locale={locale} idempotencyKey={key()} submitLabel={t("save")}>
        <div className="grid2">
          <label>{t("documentType")}<select name="documentTypeId" required>{options.documentTypes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label>{t("forTarget")}
            <select name="__target" required defaultValue={`job:${jobId}`}>
              <option value={`job:${jobId}`}>{t("thisJob")}</option>
              {live.map((x) => <option key={x.id} value={`trip:${x.id}`}>{x.tripNo}</option>)}
            </select>
          </label>
          <label>{t("reference")}<input name="reference" dir="ltr" /></label>
        </div>
      </ActionForm>
    </Modal>
  );
}

/** Job settings: status, what the job needs, extra information, budget. */
export async function JobSettingsActions({ locale, jobId, capabilities, fields, values, budget }: {
  locale: string;
  jobId: string;
  capabilities: string[];
  fields: (typeof customFields.$inferSelect)[];
  values: Record<string, string>;
  budget: { amount: string | null; currency: string | null };
}) {
  const t = await getTranslations({ locale, namespace: "Forms" });
  const st = await getTranslations({ locale, namespace: "JobStatus" });
  const cap = await getTranslations({ locale, namespace: "Setup" });
  return (
    <>
      <Modal label={t("jobNeeds")} icon={<Icon name="layers" size={16} />} small>
        <p className="muted">{t("jobNeedsHelp")}</p>
        <ActionForm command="jobs.set_capabilities" locale={locale} idempotencyKey={key()} submitLabel={t("save")}>
          <input type="hidden" name="jobId" value={jobId} />
          <fieldset>
            {CAPABILITIES.map((c) => <label key={c} className="check"><input type="checkbox" name="capabilities[]" value={c} defaultChecked={capabilities.includes(c)} />{cap(`cap_${c}`)}</label>)}
          </fieldset>
          <label>{t("reason")}<input name="reason" /></label>
        </ActionForm>
      </Modal>
      <Modal label={t("extraInfoAndBudget")} icon={<Icon name="edit" size={16} />} small>
        {fields.length > 0 && (
          <>
            <h3 style={{ marginBlockStart: 0 }}>{t("extraInfo")}</h3>
            <ActionForm command="jobs.set_custom_values" locale={locale} idempotencyKey={key()} submitLabel={t("save")}>
              <input type="hidden" name="jobId" value={jobId} />
              <div className="grid2">
                {fields.map((f) => <label key={f.id}>{f.label}{f.required ? " *" : ""}<input name={`cf_${f.key}`} defaultValue={values[f.key] ?? ""} dir="auto" /></label>)}
              </div>
            </ActionForm>
            <div className="divider" />
          </>
        )}
        <h3 style={{ marginBlockStart: 0 }}>{t("budget")}</h3>
        <p className="muted small">{t("budgetHelp")}</p>
        <ActionForm command="jobs.set_budget" locale={locale} idempotencyKey={key()} submitLabel={t("save")}>
          <input type="hidden" name="jobId" value={jobId} />
          <div className="grid2">
            <label>{t("amount")}<input name="amount" inputMode="decimal" dir="ltr" defaultValue={budget.amount ?? ""} /></label>
            <label>{t("currency")}<select name="currency" defaultValue={budget.currency ?? "IQD"}><option value="IQD">IQD</option><option value="USD">USD</option></select></label>
          </div>
        </ActionForm>
      </Modal>
      <Modal label={t("changeStatus")} icon={<Icon name="flag" size={16} />} small>
        <ActionForm command="jobs.change_status" locale={locale} idempotencyKey={key()} submitLabel={t("save")}>
          <input type="hidden" name="jobId" value={jobId} />
          <div className="grid2">
            <label>{t("newStatus")}<select name="status" required>{["in_progress", "pending", "completed", "financially_closed", "cancelled"].map((s) => <option key={s} value={s}>{st(s)}</option>)}</select></label>
            <label>{t("reason")}<input name="reason" /></label>
          </div>
        </ActionForm>
      </Modal>
    </>
  );
}
