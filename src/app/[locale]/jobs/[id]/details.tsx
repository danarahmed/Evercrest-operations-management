import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/ActionForm";
import type { customFields } from "@/db/schema";

/** Extra information (custom fields that apply to this job) and the cost budget. */
export async function JobDetailsForms({ locale, jobId, fields, values, budget }: {
  locale: string;
  jobId: string;
  fields: (typeof customFields.$inferSelect)[];
  values: Record<string, string>;
  budget: { amount: string | null; currency: string | null };
}) {
  const t = await getTranslations({ locale, namespace: "Forms" });
  return (
    <>
      {fields.length > 0 && (
        <details className="panel" open={fields.some((f) => f.required && !values[f.key])}>
          <summary>{t("extraInfo")}</summary>
          <ActionForm command="jobs.set_custom_values" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("save")}>
            <input type="hidden" name="jobId" value={jobId} />
            <div className="grid2">
              {fields.map((f) => (
                <label key={f.id}>{f.label}{f.required ? " *" : ""}<input name={`cf_${f.key}`} defaultValue={values[f.key] ?? ""} dir="auto" /></label>
              ))}
            </div>
          </ActionForm>
        </details>
      )}
      <details className="panel">
        <summary>{t("budget")}</summary>
        <p className="muted">{t("budgetHelp")}</p>
        <ActionForm command="jobs.set_budget" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("save")}>
          <input type="hidden" name="jobId" value={jobId} />
          <div className="grid2">
            <label>{t("amount")}<input name="amount" inputMode="decimal" dir="ltr" defaultValue={budget.amount ?? ""} /></label>
            <label>{t("currency")}<select name="currency" defaultValue={budget.currency ?? "IQD"}><option value="IQD">IQD</option><option value="USD">USD</option></select></label>
          </div>
        </ActionForm>
      </details>
    </>
  );
}
