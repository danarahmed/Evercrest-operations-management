import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { PARTNER_ROLES } from "@/db/schema/masterdata";
import { ActionForm } from "@/components/ActionForm";
import { CAPABILITIES } from "@/domain/jobs/capabilities";
import { setupData } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../shell";

export const dynamic = "force-dynamic";
const POSTING_KEYS = [
  "advances", "customer_receivables", "supplier_payables", "payables_to_transporters", "payables_to_drivers", "currency_exchange",
  "driver_costs", "transporter_costs", "shortage_fines", "transport_revenue", "demurrage_revenue", "rounding_differences", "bad_debts",
] as const;
const RATE_TYPES = ["driver_pay", "transporter_fee", "customer_price", "shortage_fine", "allowance", "demurrage_pay", "demurrage_bill"] as const;
const BASES = ["actual_qty", "per_trip", "per_day", "quantity"] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      <div className="stack">{children}</div>
    </section>
  );
}

/** Configuration screens. Each section appears only for users allowed to manage it; every change is audited. */
export default async function Setup({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Setup" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const d = await setupData(db, actor);
  const k = () => crypto.randomUUID();
  const acctLabel = (a: { code: string; name: string; currency: string | null }) => `${a.code} · ${a.name}${a.currency ? ` (${a.currency})` : ""}`;

  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path="/setup">
      <h1>{t("title")}</h1>
      <p className="muted">{t("intro")}</p>

      {d.partners && (
        <Section title={t("partners")}>
          <details className="panel">
            <summary>{t("addPartner")}</summary>
            <ActionForm command="partners.create" locale={locale} idempotencyKey={k()} submitLabel={f("create")}>
              <div className="grid2">
                <label>{f("name")}<input name="name" required /></label>
                <label>{t("kind")}<select name="kind" defaultValue="organization"><option value="organization">{t("organization")}</option><option value="person">{t("person")}</option></select></label>
                <label>{t("phone")}<input name="phone" dir="ltr" /></label>
              </div>
              <fieldset className="row"><legend>{t("roles")}</legend>
                {PARTNER_ROLES.map((r) => <label key={r} className="row"><input type="checkbox" name="roles[]" value={r} />{t(`role_${r}`)}</label>)}
              </fieldset>
            </ActionForm>
          </details>
          <div className="table-wrap"><table>
            <thead><tr><th>{f("name")}</th><th>{t("roles")}</th><th>{t("phone")}</th></tr></thead>
            <tbody>{d.partners.map((p) => <tr key={p.id}><td>{p.name}</td><td>{(p.roles ?? []).filter(Boolean).map((r) => t(`role_${r}`)).join(", ")}</td><td dir="ltr">{p.phone}</td></tr>)}</tbody>
          </table></div>
        </Section>
      )}

      {(d.contracts || d.projects) && (
        <Section title={t("contractsProjects")}>
          <p className="muted">{t("contractsHelp")}</p>
          {d.contracts && (
            <>
              <details className="panel">
                <summary>{t("addContract")}</summary>
                <ActionForm command="contracts.create" locale={locale} idempotencyKey={k()} submitLabel={f("create")}>
                  <div className="grid2">
                    <label>{t("contractPartner")}<select name="partnerId" required>{d.customers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                    <label>{t("contractRef")}<input name="reference" required dir="ltr" /></label>
                    <label>{t("contractTitle")}<input name="title" required /></label>
                    <label>{t("contractStatus")}<select name="status" defaultValue="active">{["draft", "active", "ended"].map((x) => <option key={x} value={x}>{t(`contract_${x}`)}</option>)}</select></label>
                    <label>{t("validFrom")}<input type="date" name="validFrom" /></label>
                    <label>{t("validTo")}<input type="date" name="validTo" /></label>
                  </div>
                </ActionForm>
              </details>
              {d.contracts.length > 0 && (
                <div className="table-wrap"><table>
                  <thead><tr><th>{t("contractRef")}</th><th>{t("contractTitle")}</th><th>{t("contractPartner")}</th><th>{t("validFrom")}</th><th>{t("validTo")}</th><th>{t("contractStatus")}</th><th /></tr></thead>
                  <tbody>{d.contracts.map(({ c, partner }) => (
                    <tr key={c.id}>
                      <td dir="ltr">{c.reference}</td><td>{c.title}</td><td>{partner}</td><td>{c.validFrom ?? "—"}</td><td>{c.validTo ?? "—"}</td>
                      <td><span className={`badge ${c.status === "active" ? "state-verified" : ""}`}>{t(`contract_${c.status}`)}</span></td>
                      <td>{c.status !== "ended" && (
                        <ActionForm command="contracts.set_status" locale={locale} idempotencyKey={k()} submitLabel={c.status === "draft" ? t("activate") : t("endContract")}>
                          <input type="hidden" name="contractId" value={c.id} />
                          <input type="hidden" name="status" value={c.status === "draft" ? "active" : "ended"} />
                          <input type="hidden" name="reason" value={c.status === "draft" ? "activated" : "contract ended"} />
                        </ActionForm>
                      )}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </>
          )}
          {d.projects && (
            <>
              <details className="panel">
                <summary>{t("addProject")}</summary>
                <ActionForm command="projects.create" locale={locale} idempotencyKey={k()} submitLabel={f("create")}>
                  <div className="grid2">
                    <label>{f("customer")}<select name="customerId" required>{d.customers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                    <label>{t("code")}<input name="code" required dir="ltr" /></label>
                    <label>{f("name")}<input name="name" required /></label>
                    <label>{t("contract")}<select name="contractId" defaultValue=""><option value="">—</option>{(d.contracts ?? []).filter(({ c }) => c.status !== "ended").map(({ c, partner }) => <option key={c.id} value={c.id}>{c.reference} · {partner}</option>)}</select></label>
                  </div>
                </ActionForm>
              </details>
              {d.projects.length > 0 && (
                <div className="table-wrap"><table>
                  <thead><tr><th>{t("code")}</th><th>{f("name")}</th><th>{f("customer")}</th><th>{t("contract")}</th></tr></thead>
                  <tbody>{d.projects.map(({ p, customer, contract }) => (
                    <tr key={p.id}><td dir="ltr">{p.code}</td><td>{p.name}</td><td>{customer}</td><td dir="ltr">{contract ?? "—"}</td></tr>
                  ))}</tbody>
                </table></div>
              )}
            </>
          )}
        </Section>
      )}

      {d.accounts && (
        <Section title={t("accounts")}>
          <details className="panel">
            <summary>{t("addAccount")}</summary>
            <ActionForm command="ledger.create_account" locale={locale} idempotencyKey={k()} submitLabel={f("create")}>
              <div className="grid2">
                <label>{t("code")}<input name="code" required dir="ltr" /></label>
                <label>{f("name")}<input name="name" required /></label>
                <label>{t("type")}<select name="type" required>{["asset", "liability", "equity", "income", "expense"].map((x) => <option key={x} value={x}>{t(`type_${x}`)}</option>)}</select></label>
                <label>{t("onlyCurrency")}<select name="currency" defaultValue=""><option value="">{t("anyCurrency")}</option><option value="IQD">IQD</option><option value="USD">USD</option></select></label>
              </div>
            </ActionForm>
          </details>
          <div className="table-wrap"><table>
            <thead><tr><th>{t("code")}</th><th>{f("name")}</th><th>{t("type")}</th><th>{t("onlyCurrency")}</th></tr></thead>
            <tbody>{d.accounts.map((a) => <tr key={a.id}><td dir="ltr">{a.code}</td><td>{a.name}</td><td>{t(`type_${a.type}`)}</td><td>{a.currency ?? t("anyCurrency")}</td></tr>)}</tbody>
          </table></div>
        </Section>
      )}

      {d.moneyAccounts && (
        <Section title={t("moneyAccounts")}>
          <details className="panel">
            <summary>{t("addMoneyAccount")}</summary>
            <ActionForm command="money_accounts.create" locale={locale} idempotencyKey={k()} submitLabel={f("create")}>
              <div className="grid2">
                <label>{f("name")}<input name="name" required /></label>
                <label>{t("kind")}<select name="kind"><option value="cash">{t("cashBox")}</option><option value="bank">{t("bank")}</option></select></label>
                <label>{t("currency")}<select name="currency" required><option value="IQD">IQD</option><option value="USD">USD</option></select></label>
                <label>{t("ledgerAccount")}<select name="ledgerAccountId" required>{d.cashLedgerAccounts.map((a) => <option key={a.id} value={a.id}>{acctLabel(a)}</option>)}</select></label>
              </div>
            </ActionForm>
          </details>
          <ul>{d.moneyAccounts.map((m) => <li key={m.id}>{m.name} · {m.currency} · {t(m.kind === "cash" ? "cashBox" : "bank")}</li>)}</ul>
        </Section>
      )}

      {d.settings && (
        <Section title={t("rules")}>
          <ActionForm command="settings.posting_accounts" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
            <strong>{t("postingAccounts")}</strong>
            <p className="muted">{t("postingHelp")}</p>
            <div className="grid2">
              {POSTING_KEYS.map((key) => (
                <label key={key}>{t(`posting_${key}`)}
                  <select name={`v_${key}`} defaultValue={(d.settings!.posting as Record<string, string>)[key] ?? ""}>
                    <option value="">{t("notSet")}</option>
                    {d.postableAccounts.map((a) => <option key={a.id} value={a.code}>{acctLabel(a)}</option>)}
                  </select>
                </label>
              ))}
              <label>{f("reason")}<input name="reason" required /></label>
            </div>
          </ActionForm>
          <ActionForm command="settings.payment_limits" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
            <strong>{t("paymentLimits")}</strong>
            <p className="muted">{t("limitsHelp")}</p>
            <div className="grid2">
              {["IQD", "USD"].map((cur) => <label key={cur}>{cur}<input name={`v_${cur}`} inputMode="decimal" dir="ltr" defaultValue={(d.settings!.limits as Record<string, string>)[cur] ?? ""} /></label>)}
              <label>{f("reason")}<input name="reason" required /></label>
            </div>
          </ActionForm>
          <ActionForm command="settings.rounding" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
            <strong>{t("roundingTitle")}</strong>
            <p className="muted">{t("roundingHelp")}</p>
            <div className="grid2">
              {["IQD", "USD"].map((cur) => <label key={cur}>{cur}<input name={`v_${cur}`} inputMode="decimal" dir="ltr" defaultValue={(d.settings!.rounding as Record<string, string>)[cur] ?? ""} /></label>)}
              <label>{f("reason")}<input name="reason" required /></label>
            </div>
          </ActionForm>
          <ActionForm command="settings.trip_transit_days" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
            <strong>{t("transitDays")}</strong>
            <div className="grid2">
              <label>{t("days")}<input name="days" type="number" min={1} required defaultValue={d.settings.transitDays ?? undefined} /></label>
              <label>{f("reason")}<input name="reason" required /></label>
            </div>
          </ActionForm>
        </Section>
      )}

      {d.products && (
        <Section title={t("products")}>
          <ActionForm command="catalog.create_item" locale={locale} idempotencyKey={k()} submitLabel={f("create")}>
            <input type="hidden" name="kind" value="product" />
            <div className="grid2">
              <label>{t("code")}<input name="code" required dir="ltr" /></label>
              <label>{f("name")}<input name="name" required /></label>
              <label>{f("unit")}<select name="defaultUnit" defaultValue="MT">{["MT", "KG", "L", "M3", "EA"].map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
            </div>
          </ActionForm>
          <ul>{d.products.map((p) => <li key={p.id}>{p.name} <span className="muted" dir="ltr">{p.code}</span></li>)}</ul>
        </Section>
      )}

      {d.rates && d.products && (
        <Section title={t("rates")}>
          <p className="muted">{t("ratesHelp")}</p>
          <details className="panel">
            <summary>{t("addRate")}</summary>
            <ActionForm command="rates.define" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
              <div className="grid2">
                <label>{t("rateType")}<select name="rateType" required>{RATE_TYPES.map((x) => <option key={x} value={x}>{t(`rt_${x}`)}</option>)}</select></label>
                <label>{t("basis")}<select name="basis" required>{BASES.map((x) => <option key={x} value={x}>{t(`basis_${x}`)}</option>)}</select></label>
                <label>{t("amount")}<input name="amount" required inputMode="decimal" dir="ltr" /></label>
                <label>{t("currency")}<select name="currency" defaultValue="IQD"><option value="">— ({t("rt_allowance")})</option><option value="IQD">IQD</option><option value="USD">USD</option></select></label>
                <label>{t("perUnit")}<select name="unit" defaultValue="MT"><option value="">—</option>{["MT", "KG", "L", "M3"].map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
                <label>{t("product")}<select name="productId" defaultValue=""><option value="">{t("allProducts")}</option>{d.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label>{t("customerOnly")}<select name="customerId" defaultValue=""><option value="">{t("all")}</option>{(d.partners ?? []).filter((p) => (p.roles ?? []).includes("customer")).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label>{t("transporterOnly")}<select name="transporterId" defaultValue=""><option value="">{t("all")}</option>{(d.partners ?? []).filter((p) => (p.roles ?? []).includes("transporter")).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label>{t("freeDays")}<input name="freeDays" type="number" min={0} /></label>
                <label>{t("startEvent")}<select name="startEvent" defaultValue=""><option value="">—</option><option value="loading">{t("fromLoading")}</option><option value="arrival">{t("fromArrival")}</option></select></label>
                <label>{t("from")}<input type="date" name="effectiveFrom" required /></label>
                <label>{t("to")}<input type="date" name="effectiveTo" /></label>
                <label>{f("reason")}<input name="reason" required /></label>
              </div>
            </ActionForm>
          </details>
          <div className="table-wrap"><table>
            <thead><tr><th>{t("rateType")}</th><th>{t("product")}</th><th>{t("amount")}</th><th>{t("basis")}</th><th>{t("from")}</th><th>{t("to")}</th><th /></tr></thead>
            <tbody>{d.rates.map(({ r, product }) => (
              <tr key={r.id}>
                <td>{t(`rt_${r.rateType}`)}</td>
                <td>{product ?? t("allProducts")}</td>
                <td className="num" dir="ltr">{Number(r.amount).toLocaleString(locale)} {r.currency ?? r.unit}{r.currency && r.unit ? ` / ${r.unit}` : ""}{r.freeDays !== null ? ` · ${t("freeDays")} ${r.freeDays}` : ""}</td>
                <td>{t(`basis_${r.basis}`)}{r.startEvent ? ` · ${t(r.startEvent === "arrival" ? "fromArrival" : "fromLoading")}` : ""}</td>
                <td>{r.effectiveFrom}</td><td>{r.effectiveTo ?? "—"}</td>
                <td>{!r.effectiveTo && (
                  <ActionForm command="rates.end" locale={locale} idempotencyKey={k()} submitLabel={t("endRule")}>
                    <input type="hidden" name="rateId" value={r.id} />
                    <div className="row"><input type="date" name="effectiveTo" required aria-label={t("to")} /><input name="reason" required placeholder={f("reason")} /></div>
                  </ActionForm>
                )}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </Section>
      )}

      {d.jobTypes && (
        <Section title={t("jobTypes")}>
          <details className="panel">
            <summary>{t("addJobType")}</summary>
            <ActionForm command="job_types.define" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
              <div className="grid2">
                <label>{t("code")}<input name="code" required dir="ltr" /></label>
                <label>{f("name")}<input name="name" required /></label>
              </div>
              <fieldset className="row"><legend>{t("defaultCapabilities")}</legend>
                {CAPABILITIES.map((c) => <label key={c} className="row"><input type="checkbox" name="defaultCapabilities[]" value={c} />{t(`cap_${c}`)}</label>)}
              </fieldset>
              <label>{t("defaultActivities")}<textarea name="activitiesText" rows={4} placeholder={t("defaultActivitiesHelp")} /></label>
            </ActionForm>
          </details>
          <ul>{d.jobTypes.map((j) => (
            <li key={j.id}>
              <strong>{j.name}</strong> — {(j.defaultCapabilities as string[]).map((c) => t(`cap_${c}`)).join(", ") || "—"}
              {(j.defaultActivities as string[]).length > 0 && <div className="muted">{t("steps")}: {(j.defaultActivities as string[]).join(" → ")}</div>}
            </li>
          ))}</ul>
        </Section>
      )}

      {d.documentTypes && (
        <Section title={t("documentRules")}>
          <ActionForm command="documents.define_type" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
            <strong>{t("addDocumentType")}</strong>
            <div className="grid2">
              <label>{t("code")}<input name="code" required dir="ltr" /></label>
              <label>{f("name")}<input name="name" required /></label>
            </div>
          </ActionForm>
          {d.documentTypes.length > 0 && d.jobTypes && (
            <ActionForm command="documents.set_requirement" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
              <strong>{t("addRule")}</strong>
              <input type="hidden" name="scope" value="job_type" />
              <div className="grid2">
                <label>{f("documentType")}<select name="documentTypeId" required>{d.documentTypes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                <label>{f("jobType")}<select name="scopeId" required>{d.jobTypes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                <label>{t("appliesTo")}<select name="appliesTo"><option value="trip">{t("eachTrip")}</option><option value="job">{t("theJob")}</option></select></label>
                <label>{t("requiredBefore")}<select name="requiredBefore"><option value="completed">{t("beforeCompletion")}</option><option value="financially_closed">{t("beforeClose")}</option></select></label>
                <label>{t("ruleActive")}<select name="active"><option value="true">{t("on")}</option><option value="false">{t("off")}</option></select></label>
                <label>{f("reason")}<input name="reason" required /></label>
              </div>
            </ActionForm>
          )}
          <ul>{(d.documentRules ?? []).map(({ r, type }) => <li key={r.id}>{type} · {r.appliesTo === "trip" ? t("eachTrip") : t("theJob")} · {r.requiredBefore === "completed" ? t("beforeCompletion") : t("beforeClose")}</li>)}</ul>
        </Section>
      )}
    </Shell>
  );
}
