import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/ActionForm";
import type { trips } from "@/db/schema";
import type { FormOptions } from "@/server/queries";
import { CAPABILITIES } from "@/domain/jobs/capabilities";

type Trip = typeof trips.$inferSelect;
const today = () => new Date().toISOString().slice(0, 10);
const key = () => crypto.randomUUID();

/** Data-entry panels for a job. Only panels relevant to the job's capabilities are shown. */
export async function JobForms({ locale, jobId, jobNo, capabilities, tripList, options }: {
  locale: string;
  jobId: string;
  jobNo: string;
  capabilities: string[];
  tripList: Trip[];
  options: FormOptions;
}) {
  const t = await getTranslations({ locale, namespace: "Forms" });
  const st = await getTranslations({ locale, namespace: "JobStatus" });
  const cap = await getTranslations({ locale, namespace: "Setup" });
  const planned = tripList.filter((x) => x.status === "planned" || x.status === "loaded");
  const loaded = tripList.filter((x) => x.status === "loaded" || x.status === "discharged");
  const live = tripList.filter((x) => x.status !== "cancelled");
  const unitSelect = (name: string) => (
    <select name={name} required defaultValue="MT">{options.units.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}</select>
  );

  return (
    <>
      {capabilities.includes("transportation") && (
        <details className="panel">
          <summary>{t("startTrip")}</summary>
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
        </details>
      )}

      {planned.length > 0 && (
        <details className="panel">
          <summary>{t("recordLoading")}</summary>
          <ActionForm command="trips.record_loading" locale={locale} idempotencyKey={key()} submitLabel={t("save")}>
            <div className="grid2">
              <label>{t("trip")}<select name="tripId" required>{planned.map((x) => <option key={x.id} value={x.id}>{x.tripNo}</option>)}</select></label>
              <label>{t("date")}<input type="date" name="loadingDate" required defaultValue={today()} /></label>
              <label>{t("quantity")}<input name="loadedQty" required inputMode="decimal" dir="ltr" /></label>
              <label>{t("unit")}{unitSelect("loadedUnit")}</label>
              <label>{t("correctionReason")}<input name="reason" /></label>
            </div>
          </ActionForm>
        </details>
      )}

      {tripList.some((x) => x.status === "loaded") && (
        <details className="panel">
          <summary>{t("recordArrival")}</summary>
          <ActionForm command="trips.record_arrival" locale={locale} idempotencyKey={key()} submitLabel={t("save")}>
            <div className="grid2">
              <label>{t("trip")}<select name="tripId" required>{tripList.filter((x) => x.status === "loaded").map((x) => <option key={x.id} value={x.id}>{x.tripNo}</option>)}</select></label>
              <label>{t("date")}<input type="date" name="arrivalDate" required defaultValue={today()} /></label>
              <label>{t("correctionReason")}<input name="reason" /></label>
            </div>
          </ActionForm>
        </details>
      )}

      {loaded.length > 0 && (
        <details className="panel">
          <summary>{t("recordDischarge")}</summary>
          <ActionForm command="trips.record_discharge" locale={locale} idempotencyKey={key()} submitLabel={t("save")}>
            <div className="grid2">
              <label>{t("trip")}<select name="tripId" required>{loaded.map((x) => <option key={x.id} value={x.id}>{x.tripNo}</option>)}</select></label>
              <label>{t("date")}<input type="date" name="dischargeDate" required defaultValue={today()} /></label>
              <label>{t("quantity")}<input name="dischargedQty" required inputMode="decimal" dir="ltr" /></label>
              <label>{t("unit")}{unitSelect("dischargedUnit")}</label>
              <label>{t("correctionReason")}<input name="reason" /></label>
            </div>
          </ActionForm>
        </details>
      )}

      {capabilities.includes("advances") && live.length > 0 && options.moneyAccounts.length > 0 && (
        <details className="panel">
          <summary>{t("payAdvance")}</summary>
          <ActionForm command="payments.record" locale={locale} idempotencyKey={key()} submitLabel={t("pay")} summary={`Advance for ${jobNo}`}>
            <input type="hidden" name="direction" value="out" />
            <input type="hidden" name="purpose" value="advance" />
            <div className="grid2">
              <label>{t("trip")}<select name="tripId" required>{live.map((x) => <option key={x.id} value={x.id}>{x.tripNo}</option>)}</select></label>
              <label>{t("paidFrom")}<select name="moneyAccountId" required>{options.moneyAccounts.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.currency})</option>)}</select></label>
              <label>{t("amount")}<input name="amount" required inputMode="decimal" dir="ltr" /></label>
              <label>{t("date")}<input type="date" name="paymentDate" required defaultValue={today()} /></label>
              <label>{t("method")}<select name="method" defaultValue="cash">{["cash", "bank_transfer", "cheque", "other"].map((m) => <option key={m} value={m}>{t(m)}</option>)}</select></label>
            </div>
          </ActionForm>
        </details>
      )}

      {capabilities.includes("expenses") && options.moneyAccounts.length > 0 && options.expenseAccounts.length > 0 && (
        <details className="panel">
          <summary>{t("recordExpense")}</summary>
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
              <label>{t("method")}<select name="method" defaultValue="cash">{["cash", "bank_transfer", "cheque", "other"].map((m) => <option key={m} value={m}>{t(m)}</option>)}</select></label>
            </div>
          </ActionForm>
        </details>
      )}

      {capabilities.includes("expenses") && options.suppliers.length > 0 && options.expenseAccounts.length > 0 && (
        <details className="panel">
          <summary>{t("supplierBill")}</summary>
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
        </details>
      )}

      {options.documentTypes.length > 0 && (
        <details className="panel">
          <summary>{t("recordDocument")}</summary>
          <ActionForm command="documents.record" locale={locale} idempotencyKey={key()} submitLabel={t("save")}>
            <div className="grid2">
              <label>{t("documentType")}<select name="documentTypeId" required>{options.documentTypes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
              <label>{t("forTarget")}
                <select name="__target" required defaultValue={`job:${jobId}`} data-split>
                  <option value={`job:${jobId}`}>{t("thisJob")}</option>
                  {live.map((x) => <option key={x.id} value={`trip:${x.id}`}>{x.tripNo}</option>)}
                </select>
              </label>
              <label>{t("reference")}<input name="reference" dir="ltr" /></label>
            </div>
          </ActionForm>
        </details>
      )}

      <details className="panel">
        <summary>{t("jobNeeds")}</summary>
        <p className="muted">{t("jobNeedsHelp")}</p>
        <ActionForm command="jobs.set_capabilities" locale={locale} idempotencyKey={key()} submitLabel={t("save")}>
          <input type="hidden" name="jobId" value={jobId} />
          <fieldset className="row">
            {CAPABILITIES.map((c) => <label key={c} className="row"><input type="checkbox" name="capabilities[]" value={c} defaultChecked={capabilities.includes(c)} />{cap(`cap_${c}`)}</label>)}
          </fieldset>
          <label>{t("reason")}<input name="reason" /></label>
        </ActionForm>
      </details>

      <details className="panel">
        <summary>{t("changeStatus")}</summary>
        <ActionForm command="jobs.change_status" locale={locale} idempotencyKey={key()} submitLabel={t("save")}>
          <input type="hidden" name="jobId" value={jobId} />
          <div className="grid2">
            <label>{t("newStatus")}<select name="status" required>{["in_progress", "pending", "completed", "financially_closed", "cancelled"].map((s) => <option key={s} value={s}>{st(s)}</option>)}</select></label>
            <label>{t("reason")}<input name="reason" /></label>
          </div>
        </ActionForm>
      </details>
    </>
  );
}
