import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { Badge, Card, EmptyState, StatusBadge } from "@/components/ui";
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
    <Card
      title={t("title")}
      icon="wrench"
      flush
      actions={editable && (
        <>
          {live.length > 0 && (
            <Modal label={t("complete")} small>
              <ActionForm command="work_orders.set_status" locale={locale} idempotencyKey={key()} submitLabel={t("save")}>
                <div className="grid2">
                  <label>{t("number")}<select name="workOrderId" required>{live.map(({ wo }) => <option key={wo.id} value={wo.id}>{wo.workOrderNo} · {wo.site}</option>)}</select></label>
                  <label>{t("status")}<select name="status" defaultValue="completed">{["in_progress", "completed", "cancelled"].map((s) => <option key={s} value={s}>{t(`status_${s}`)}</option>)}</select></label>
                  <label>{t("completedDate")}<input type="date" name="completedDate" defaultValue={today()} /></label>
                  <label>{t("whatWasDone")}<input name="note" /></label>
                </div>
              </ActionForm>
            </Modal>
          )}
          <Modal label={t("add")} icon={<Icon name="plus" size={16} />} variant="primary" small>
            <ActionForm command="work_orders.create" locale={locale} idempotencyKey={key()} submitLabel={t("add")}>
              <input type="hidden" name="jobId" value={jobId} />
              <div className="grid2">
                <label>{t("site")}<input name="site" required /></label>
                <label>{t("work")}<input name="description" required /></label>
                <label>{t("by")}<select name="contractorId" defaultValue=""><option value="">{t("ownTeam")}</option>{contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                <label>{t("planned")}<input type="date" name="plannedDate" /></label>
              </div>
            </ActionForm>
          </Modal>
        </>
      )}
    >
      {rows.length === 0 ? <EmptyState icon="wrench" title={t("none")} /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>{t("number")}</th><th>{t("site")}</th><th>{t("work")}</th><th>{t("by")}</th><th>{t("planned")}</th><th>{t("status")}</th></tr></thead>
          <tbody>{rows.map(({ wo, contractor }) => (
            <tr key={wo.id}>
              <td className="ltr"><strong>{wo.workOrderNo}</strong></td>
              <td><Icon name="mapPin" size={14} /> {wo.site}</td>
              <td className="wrap">{wo.description}{wo.completionNote && <div className="cell-sub">{wo.completionNote}</div>}</td>
              <td>{contractor ?? <span className="muted">{t("ownTeam")}</span>}</td>
              <td>{wo.plannedDate ?? "—"}</td>
              <td><StatusBadge status={wo.status} label={<>{t(`status_${wo.status}`)}{wo.completedDate ? ` · ${wo.completedDate}` : ""}</>} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
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
    <Card
      title={t("title")}
      icon="package"
      flush
      actions={<>
        {canBill && unbilled.length > 0 && (
          <Modal label={t("bill")} icon={<Icon name="receipt" size={16} />} small>
            <p className="muted">{t("billHelp")}</p>
            <ActionForm command="deliveries.bill" locale={locale} idempotencyKey={key()} submitLabel={t("createInvoice")}>
              <input type="hidden" name="jobId" value={jobId} />
              <fieldset>
                {unbilled.map((r) => <label key={r.d.id} className="check"><input type="checkbox" name="deliveryIds[]" value={r.d.id} defaultChecked />{r.d.deliveryNo} · {r.product} {formatQty(r.quantity, r.d.unit, locale)}</label>)}
              </fieldset>
              <div className="grid2">
                <label>{t("date")}<input type="date" name="invoiceDate" required defaultValue={today()} /></label>
                <label>{t("dueDate")}<input type="date" name="dueDate" /></label>
                <label>{t("priceIfNoRule")}<input name="unitPrice" inputMode="decimal" dir="ltr" /></label>
                <label>{t("currency")}<select name="currency" defaultValue=""><option value="">{t("fromPriceList")}</option><option value="IQD">IQD</option><option value="USD">USD</option></select></label>
              </div>
            </ActionForm>
          </Modal>
        )}
        {editable && products.length > 0 && (
          <Modal label={t("record")} icon={<Icon name="plus" size={16} />} variant="primary" small>
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
          </Modal>
        )}
      </>}
    >
      {rows.length === 0 ? <EmptyState icon="package" title={t("none")} /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>{t("number")}</th><th>{t("date")}</th><th>{t("product")}</th><th className="num">{t("quantity")}</th><th>{t("deliveredTo")}</th><th>{t("note")}</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.d.id} className={r.d.status === "cancelled" ? "muted" : ""}>
              <td className="ltr"><strong>{r.d.deliveryNo}</strong></td><td>{r.d.deliveryDate}</td><td>{r.product}</td>
              <td className="num">{formatQty(r.quantity, r.d.unit, locale)}</td><td>{r.d.deliveredTo ?? "—"}</td><td className="ltr">{r.d.reference ?? "—"}</td>
              <td>{r.d.status === "cancelled" ? <Badge>{t("cancelled")}</Badge> : r.invoiced ? <Badge tone="success">{t("invoiced")}</Badge> : <Badge tone="warning">{t("notInvoiced")}</Badge>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}
