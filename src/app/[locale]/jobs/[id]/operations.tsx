import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/ActionForm";
import type { deliveries, workOrders } from "@/db/schema";
import { formatQty } from "@/lib/format";

const key = () => crypto.randomUUID();
const today = () => new Date().toISOString().slice(0, 10);

/** Field work: work orders at sites, by our team or a contractor. */
export async function WorkOrdersSection({ locale, jobId, rows, contractors, editable }: {
  locale: string;
  jobId: string;
  rows: { wo: typeof workOrders.$inferSelect; contractor: string | null }[];
  contractors: { id: string; name: string }[];
  editable: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "Field" });
  const live = rows.filter((r) => r.wo.status === "open" || r.wo.status === "in_progress");
  return (
    <>
      <h2>{t("title")}</h2>
      {rows.length > 0 && (
        <div className="table-wrap"><table>
          <thead><tr><th>{t("number")}</th><th>{t("site")}</th><th>{t("work")}</th><th>{t("by")}</th><th>{t("planned")}</th><th>{t("status")}</th></tr></thead>
          <tbody>{rows.map(({ wo, contractor }) => (
            <tr key={wo.id}>
              <td dir="ltr">{wo.workOrderNo}</td><td>{wo.site}</td>
              <td className="wrap">{wo.description}{wo.completionNote && <div className="muted">{wo.completionNote}</div>}</td>
              <td>{contractor ?? t("ownTeam")}</td><td>{wo.plannedDate ?? "—"}</td>
              <td><span className={`badge ${wo.status === "completed" ? "state-verified" : ""}`}>{t(`status_${wo.status}`)}{wo.completedDate ? ` · ${wo.completedDate}` : ""}</span></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {editable && (
        <details className="panel">
          <summary>{t("add")}</summary>
          <ActionForm command="work_orders.create" locale={locale} idempotencyKey={key()} submitLabel={t("add")}>
            <input type="hidden" name="jobId" value={jobId} />
            <div className="grid2">
              <label>{t("site")}<input name="site" required /></label>
              <label>{t("work")}<input name="description" required /></label>
              <label>{t("by")}<select name="contractorId" defaultValue=""><option value="">{t("ownTeam")}</option>{contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label>{t("planned")}<input type="date" name="plannedDate" /></label>
            </div>
          </ActionForm>
        </details>
      )}
      {editable && live.length > 0 && (
        <details className="panel">
          <summary>{t("complete")}</summary>
          <ActionForm command="work_orders.set_status" locale={locale} idempotencyKey={key()} submitLabel={t("save")}>
            <div className="grid2">
              <label>{t("number")}<select name="workOrderId" required>{live.map(({ wo }) => <option key={wo.id} value={wo.id}>{wo.workOrderNo} · {wo.site}</option>)}</select></label>
              <label>{t("status")}<select name="status" defaultValue="completed">{["in_progress", "completed", "cancelled"].map((s) => <option key={s} value={s}>{t(`status_${s}`)}</option>)}</select></label>
              <label>{t("completedDate")}<input type="date" name="completedDate" defaultValue={today()} /></label>
              <label>{t("whatWasDone")}<input name="note" /></label>
            </div>
          </ActionForm>
        </details>
      )}
    </>
  );
}

/** Product supply: deliveries to the customer and invoicing them. */
export async function DeliveriesSection({ locale, jobId, rows, products, units, editable, canBill }: {
  locale: string;
  jobId: string;
  rows: { d: typeof deliveries.$inferSelect; product: string; quantity: string; invoiced: boolean }[];
  products: { id: string; name: string }[];
  units: { code: string }[];
  editable: boolean;
  canBill: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "Supply" });
  const unbilled = rows.filter((r) => r.d.status === "delivered" && !r.invoiced);
  return (
    <>
      <h2>{t("title")}</h2>
      {rows.length > 0 && (
        <div className="table-wrap"><table>
          <thead><tr><th>{t("number")}</th><th>{t("date")}</th><th>{t("product")}</th><th className="num">{t("quantity")}</th><th>{t("deliveredTo")}</th><th>{t("note")}</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.d.id} className={r.d.status === "cancelled" ? "muted" : ""}>
              <td dir="ltr">{r.d.deliveryNo}</td><td>{r.d.deliveryDate}</td><td>{r.product}</td>
              <td className="num">{formatQty(r.quantity, r.d.unit, locale)}</td><td>{r.d.deliveredTo ?? "—"}</td><td dir="ltr">{r.d.reference ?? "—"}</td>
              <td>{r.d.status === "cancelled" ? <span className="badge">{t("cancelled")}</span> : r.invoiced ? <span className="badge state-verified">{t("invoiced")}</span> : <span className="badge">{t("notInvoiced")}</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {editable && products.length > 0 && (
        <details className="panel">
          <summary>{t("record")}</summary>
          <ActionForm command="deliveries.record" locale={locale} idempotencyKey={key()} submitLabel={t("record")}>
            <input type="hidden" name="jobId" value={jobId} />
            <div className="grid2">
              <label>{t("product")}<select name="productId" required>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label>{t("quantity")}<input name="quantity" required inputMode="decimal" dir="ltr" /></label>
              <label>{t("unit")}<select name="unit" required defaultValue="EA">{units.map((u) => <option key={u.code} value={u.code}>{u.code}</option>)}</select></label>
              <label>{t("date")}<input type="date" name="deliveryDate" required defaultValue={today()} /></label>
              <label>{t("deliveredTo")}<input name="deliveredTo" /></label>
              <label>{t("note")}<input name="reference" dir="ltr" /></label>
            </div>
          </ActionForm>
        </details>
      )}
      {canBill && unbilled.length > 0 && (
        <details className="panel">
          <summary>{t("bill")}</summary>
          <p className="muted">{t("billHelp")}</p>
          <ActionForm command="deliveries.bill" locale={locale} idempotencyKey={key()} submitLabel={t("createInvoice")}>
            <input type="hidden" name="jobId" value={jobId} />
            <fieldset className="row">
              {unbilled.map((r) => <label key={r.d.id} className="row"><input type="checkbox" name="deliveryIds[]" value={r.d.id} defaultChecked />{r.d.deliveryNo} · {r.product} {formatQty(r.quantity, r.d.unit, locale)}</label>)}
            </fieldset>
            <div className="grid2">
              <label>{t("date")}<input type="date" name="invoiceDate" required defaultValue={today()} /></label>
              <label>{t("dueDate")}<input type="date" name="dueDate" /></label>
              <label>{t("priceIfNoRule")}<input name="unitPrice" inputMode="decimal" dir="ltr" /></label>
              <label>{t("currency")}<select name="currency" defaultValue=""><option value="">{t("fromPriceList")}</option><option value="IQD">IQD</option><option value="USD">USD</option></select></label>
            </div>
          </ActionForm>
        </details>
      )}
    </>
  );
}
