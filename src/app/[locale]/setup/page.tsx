import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { PARTNER_ROLES } from "@/db/schema/masterdata";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { Badge, Card, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { CAPABILITIES } from "@/domain/jobs/capabilities";
import { setupData } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../shell";

export const dynamic = "force-dynamic";
const POSTING_KEYS = [
  "advances", "customer_receivables", "supplier_payables", "payables_to_transporters", "payables_to_drivers", "currency_exchange",
  "driver_costs", "transporter_costs", "shortage_fines", "transport_revenue", "demurrage_revenue", "rounding_differences", "bad_debts", "product_sales",
] as const;
const RATE_TYPES = ["driver_pay", "transporter_fee", "customer_price", "shortage_fine", "allowance", "demurrage_pay", "demurrage_bill", "product_price"] as const;
const BASES = ["actual_qty", "per_trip", "per_day", "quantity", "per_unit"] as const;

type Tab = "partners" | "catalog" | "operations" | "accounting" | "settings";

/** Configuration screens. Each section appears only for users allowed to manage it; every change is audited. */
export default async function Setup({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Setup" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const d = await setupData(db, actor);
  const k = () => crypto.randomUUID();
  const plus = <Icon name="plus" size={16} />;
  const base = `/${locale}/setup`;
  const available: { key: Tab; show: unknown; icon: Parameters<typeof Icon>[0]["name"] }[] = [
    { key: "partners", show: d.partners, icon: "users" },
    { key: "catalog", show: d.products || d.rates, icon: "package" },
    { key: "operations", show: d.jobTypes || d.customFields || d.documentTypes || d.contracts || d.projects, icon: "briefcase" },
    { key: "accounting", show: d.accounts || d.moneyAccounts || d.settings, icon: "book" },
    { key: "settings", show: d.settings, icon: "settings" },
  ];
  const tabs = available.filter((x) => x.show);
  const tab: Tab = tabs.find((x) => x.key === sp.tab)?.key ?? tabs[0]?.key ?? "partners";
  const acctLabel = (a: { code: string; name: string; currency: string | null }) => `${a.code} · ${a.name}${a.currency ? ` (${a.currency})` : ""}`;

  // Rules and custom fields can target a job type, a customer or a contract (configuration, not code).
  const targetSelect = (name: string, withAll: boolean, withContracts = true) => (
    <select name={name} required defaultValue={withAll ? "all" : undefined}>
      {withAll && <option value="all">{t("allJobs")}</option>}
      <optgroup label={t("byJobType")}>{(d.targets?.jobTypes ?? []).map((x) => <option key={x.id} value={`job_type:${x.id}`}>{x.name}</option>)}</optgroup>
      <optgroup label={t("byCustomer")}>{(d.targets?.customers ?? []).map((x) => <option key={x.id} value={`customer:${x.id}`}>{x.name}</option>)}</optgroup>
      {withContracts && <optgroup label={t("byContract")}>{(d.targets?.contracts ?? []).map((x) => <option key={x.id} value={`contract:${x.id}`}>{x.name}</option>)}</optgroup>}
    </select>
  );
  const targetName = (scope: string, id: string | null) => {
    if (scope === "all" || !id) return t("allJobs");
    const list = scope === "job_type" ? d.targets?.jobTypes : scope === "customer" ? d.targets?.customers : d.targets?.contracts;
    return `${t(`scope_${scope}`)}: ${list?.find((x) => x.id === id)?.name ?? "?"}`;
  };

  return (
    <Shell wide permissions={actor.permissions} locale={locale} userName={user.displayName} path="/setup">
      <PageHeader title={t("title")} subtitle={t("intro")} />
      <Tabs active={tab} items={tabs.map((x) => ({ key: x.key, label: t(`tab_${x.key}`), href: `${base}?tab=${x.key}`, icon: x.icon }))} />

      {tab === "partners" && d.partners && (
        <Card flush title={t("partners")} subtitle={t("partnersHelp")} icon="users" actions={
          <Modal label={t("addPartner")} variant="primary" icon={plus}>
            <ActionForm command="partners.create" locale={locale} idempotencyKey={k()} submitLabel={f("create")}>
              <div className="grid2">
                <label>{f("name")}<input name="name" required /></label>
                <label>{t("kind")}<select name="kind" defaultValue="organization"><option value="organization">{t("organization")}</option><option value="person">{t("person")}</option></select></label>
                <label>{t("phone")}<input name="phone" dir="ltr" /></label>
              </div>
              <fieldset className="checks"><legend>{t("roles")}</legend>
                {PARTNER_ROLES.map((r) => <label key={r} className="check"><input type="checkbox" name="roles[]" value={r} />{t(`role_${r}`)}</label>)}
              </fieldset>
            </ActionForm>
          </Modal>
        }>
          {d.partners.length === 0 ? <EmptyState icon="users" title={t("nonePartners")} /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>{f("name")}</th><th>{t("roles")}</th><th>{t("phone")}</th></tr></thead>
              <tbody>{d.partners.map((p) => (
                <tr key={p.id}>
                  <td className="cell-title">{p.name}</td>
                  <td><div className="chips">{(p.roles ?? []).filter(Boolean).map((r) => <Badge key={r} tone="info" plain>{t(`role_${r}`)}</Badge>)}</div></td>
                  <td className="ltr">{p.phone ?? <span className="muted">—</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      )}

      {tab === "catalog" && (
        <>
          {d.products && (
            <Card flush title={t("products")} icon="package" actions={
              <Modal label={t("addProduct")} icon={plus}>
                <ActionForm command="catalog.create_item" locale={locale} idempotencyKey={k()} submitLabel={f("create")}>
                  <input type="hidden" name="kind" value="product" />
                  <div className="grid2">
                    <label>{t("code")}<input name="code" required dir="ltr" /></label>
                    <label>{f("name")}<input name="name" required /></label>
                    <label>{f("unit")}<select name="defaultUnit" defaultValue="MT">{["MT", "KG", "L", "M3", "EA"].map((u) => <option key={u} value={u}>{u}</option>)}</select></label>
                  </div>
                </ActionForm>
              </Modal>
            }>
              {d.products.length === 0 ? <EmptyState icon="package" title={t("noneProducts")} /> : (
                <div className="table-wrap"><table>
                  <thead><tr><th>{f("name")}</th><th>{t("code")}</th><th>{f("unit")}</th></tr></thead>
                  <tbody>{d.products.map((p) => <tr key={p.id}><td className="cell-title">{p.name}</td><td className="ltr">{p.code}</td><td>{p.defaultUnit ?? "—"}</td></tr>)}</tbody>
                </table></div>
              )}
            </Card>
          )}
          {d.rates && d.products && (
            <Card flush title={t("rates")} subtitle={t("ratesHelp")} icon="dollar" actions={
              <Modal label={t("addRate")} variant="primary" size="lg" icon={plus}>
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
                  </div>
                  <label>{f("reason")}<input name="reason" required /></label>
                </ActionForm>
              </Modal>
            }>
              {d.rates.length === 0 ? <EmptyState icon="dollar" title={t("noneRates")} /> : (
                <div className="table-wrap"><table>
                  <thead><tr><th>{t("rateType")}</th><th>{t("product")}</th><th className="num">{t("amount")}</th><th>{t("basis")}</th><th>{t("validity")}</th><th /></tr></thead>
                  <tbody>{d.rates.map(({ r, product }) => (
                    <tr key={r.id}>
                      <td className="cell-title">{t(`rt_${r.rateType}`)}</td>
                      <td>{product ?? <span className="muted">{t("allProducts")}</span>}</td>
                      <td className="num ltr"><strong>{Number(r.amount).toLocaleString(locale)} {r.currency ?? r.unit}</strong>{r.currency && r.unit ? ` / ${r.unit}` : ""}{r.freeDays !== null && <div className="cell-sub">{t("freeDays")} {r.freeDays}</div>}</td>
                      <td>{t(`basis_${r.basis}`)}{r.startEvent ? <div className="cell-sub">{t(r.startEvent === "arrival" ? "fromArrival" : "fromLoading")}</div> : null}</td>
                      <td>{r.effectiveFrom} → {r.effectiveTo ?? <Badge tone="success">{t("ongoing")}</Badge>}</td>
                      <td className="actions-cell">{!r.effectiveTo && (
                        <Modal small size="sm" variant="ghost" label={t("endRule")}>
                          <ActionForm command="rates.end" locale={locale} idempotencyKey={k()} submitLabel={t("endRule")}>
                            <input type="hidden" name="rateId" value={r.id} />
                            <label>{t("to")}<input type="date" name="effectiveTo" required /></label>
                            <label>{f("reason")}<input name="reason" required /></label>
                          </ActionForm>
                        </Modal>
                      )}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </Card>
          )}
        </>
      )}

      {tab === "operations" && (
        <>
          {d.jobTypes && (
            <Card title={t("jobTypes")} subtitle={t("jobTypesHelp")} icon="layers" actions={
              <Modal label={t("addJobType")} variant="primary" icon={plus}>
                <ActionForm command="job_types.define" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
                  <div className="grid2">
                    <label>{t("code")}<input name="code" required dir="ltr" /></label>
                    <label>{f("name")}<input name="name" required /></label>
                  </div>
                  <fieldset className="checks"><legend>{t("defaultCapabilities")}</legend>
                    {CAPABILITIES.map((c) => <label key={c} className="check"><input type="checkbox" name="defaultCapabilities[]" value={c} />{t(`cap_${c}`)}</label>)}
                  </fieldset>
                  <label>{t("defaultActivities")}<textarea name="activitiesText" rows={4} placeholder={t("defaultActivitiesHelp")} /></label>
                </ActionForm>
              </Modal>
            }>
              <div className="tiles">{d.jobTypes.map((j) => (
                <div key={j.id} className="tile">
                  <div className="tile-title">{j.name} <span className="muted ltr">{j.code}</span></div>
                  <div className="chips">{(j.defaultCapabilities as string[]).length === 0 ? <span className="muted">{t("noCapabilities")}</span> : (j.defaultCapabilities as string[]).map((c) => <Badge key={c} tone="accent" plain>{t(`cap_${c}`)}</Badge>)}</div>
                  {(j.defaultActivities as string[]).length > 0 && <div className="muted small">{t("steps")}: {(j.defaultActivities as string[]).join(" → ")}</div>}
                </div>
              ))}</div>
            </Card>
          )}

          {d.documentTypes && (
            <Card flush title={t("documentRules")} subtitle={t("documentRulesHelp")} icon="file" actions={<>
              <Modal label={t("addDocumentType")} icon={plus}>
                <ActionForm command="documents.define_type" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
                  <div className="grid2">
                    <label>{t("code")}<input name="code" required dir="ltr" /></label>
                    <label>{f("name")}<input name="name" required /></label>
                  </div>
                </ActionForm>
              </Modal>
              {d.documentTypes.length > 0 && d.targets && (
                <Modal label={t("addRule")} variant="primary" icon={plus}>
                  <ActionForm command="documents.set_requirement" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
                    <div className="grid2">
                      <label>{f("documentType")}<select name="documentTypeId" required>{d.documentTypes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                      <label>{t("ruleFor")}{targetSelect("target", false)}</label>
                      <label>{t("appliesTo")}<select name="appliesTo"><option value="trip">{t("eachTrip")}</option><option value="job">{t("theJob")}</option></select></label>
                      <label>{t("requiredBefore")}<select name="requiredBefore"><option value="completed">{t("beforeCompletion")}</option><option value="financially_closed">{t("beforeClose")}</option></select></label>
                      <label>{t("ruleActive")}<select name="active"><option value="true">{t("on")}</option><option value="false">{t("off")}</option></select></label>
                      <label>{f("reason")}<input name="reason" required /></label>
                    </div>
                  </ActionForm>
                </Modal>
              )}
            </>}>
              <div className="pad">
                <div className="chips">{d.documentTypes.map((x) => <Badge key={x.id} plain>{x.name}</Badge>)}</div>
              </div>
              {(d.documentRules ?? []).length === 0 ? <EmptyState icon="file" title={t("noneRules")} /> : (
                <div className="table-wrap"><table>
                  <thead><tr><th>{f("documentType")}</th><th>{t("ruleFor")}</th><th>{t("appliesTo")}</th><th>{t("requiredBefore")}</th></tr></thead>
                  <tbody>{(d.documentRules ?? []).map(({ r, type }) => (
                    <tr key={r.id}><td className="cell-title">{type}</td><td>{targetName(r.scope, r.scopeId)}</td><td>{r.appliesTo === "trip" ? t("eachTrip") : t("theJob")}</td><td>{r.requiredBefore === "completed" ? t("beforeCompletion") : t("beforeClose")}</td></tr>
                  ))}</tbody>
                </table></div>
              )}
            </Card>
          )}

          {d.customFields && (
            <Card flush title={t("customFields")} subtitle={t("customFieldsHelp")} icon="list" actions={
              <Modal label={t("addCustomField")} icon={plus}>
                <ActionForm command="custom_fields.define" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
                  <div className="grid2">
                    <label>{t("fieldLabel")}<input name="label" required placeholder={t("fieldLabelExample")} /></label>
                    <label>{t("fieldKey")}<input name="key" required dir="ltr" placeholder="permit_no" pattern="[a-z][a-z0-9_]{1,40}" /></label>
                    <label>{t("fieldFor")}{targetSelect("target", true, false)}</label>
                    <label>{t("requiredBefore")}<select name="requiredBefore"><option value="completed">{t("beforeCompletion")}</option><option value="financially_closed">{t("beforeClose")}</option></select></label>
                    <label>{t("ruleActive")}<select name="active"><option value="true">{t("on")}</option><option value="false">{t("off")}</option></select></label>
                    <label className="check"><input type="checkbox" name="required" value="true" />{t("fieldRequired")}</label>
                  </div>
                </ActionForm>
              </Modal>
            }>
              {d.customFields.length === 0 ? <EmptyState icon="list" title={t("noneFields")} /> : (
                <div className="table-wrap"><table>
                  <thead><tr><th>{t("fieldLabel")}</th><th>{t("fieldFor")}</th><th>{t("fieldRequired")}</th><th>{t("ruleActive")}</th></tr></thead>
                  <tbody>{d.customFields.map((c) => (
                    <tr key={c.id} className={c.active ? "" : "muted"}>
                      <td><span className="cell-title">{c.label}</span><div className="cell-sub ltr">{c.key}</div></td>
                      <td>{targetName(c.scope, c.scopeId)}</td>
                      <td>{c.required ? (c.requiredBefore === "completed" ? t("beforeCompletion") : t("beforeClose")) : <span className="muted">—</span>}</td>
                      <td><Badge tone={c.active ? "success" : undefined}>{c.active ? t("on") : t("off")}</Badge></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </Card>
          )}

          {d.contracts && (
            <Card flush title={t("contracts")} subtitle={t("contractsHelp")} icon="clipboard" actions={
              <Modal label={t("addContract")} icon={plus}>
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
              </Modal>
            }>
              {d.contracts.length === 0 ? <EmptyState icon="clipboard" title={t("noneContracts")} /> : (
                <div className="table-wrap"><table>
                  <thead><tr><th>{t("contractRef")}</th><th>{t("contractTitle")}</th><th>{t("contractPartner")}</th><th>{t("validity")}</th><th>{t("contractStatus")}</th><th /></tr></thead>
                  <tbody>{d.contracts.map(({ c, partner }) => (
                    <tr key={c.id}>
                      <td className="ltr cell-title">{c.reference}</td><td>{c.title}</td><td>{partner}</td><td>{c.validFrom ?? "—"} → {c.validTo ?? "—"}</td>
                      <td><Badge tone={c.status === "active" ? "success" : c.status === "draft" ? "warning" : undefined}>{t(`contract_${c.status}`)}</Badge></td>
                      <td className="actions-cell">{c.status !== "ended" && (
                        <ActionForm command="contracts.set_status" locale={locale} idempotencyKey={k()} submitLabel={c.status === "draft" ? t("activate") : t("endContract")} inline variant="secondary" confirm={c.status === "active" ? t("endContractConfirm") : undefined}>
                          <input type="hidden" name="contractId" value={c.id} />
                          <input type="hidden" name="status" value={c.status === "draft" ? "active" : "ended"} />
                          <input type="hidden" name="reason" value={c.status === "draft" ? "activated" : "contract ended"} />
                        </ActionForm>
                      )}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </Card>
          )}

          {d.projects && (
            <Card flush title={t("projects")} subtitle={t("projectsHelp")} icon="flag" actions={
              <Modal label={t("addProject")} icon={plus}>
                <ActionForm command="projects.create" locale={locale} idempotencyKey={k()} submitLabel={f("create")}>
                  <div className="grid2">
                    <label>{f("customer")}<select name="customerId" required>{d.customers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                    <label>{t("code")}<input name="code" required dir="ltr" /></label>
                    <label>{f("name")}<input name="name" required /></label>
                    <label>{t("contract")}<select name="contractId" defaultValue=""><option value="">—</option>{(d.contracts ?? []).filter(({ c }) => c.status !== "ended").map(({ c, partner }) => <option key={c.id} value={c.id}>{c.reference} · {partner}</option>)}</select></label>
                  </div>
                </ActionForm>
              </Modal>
            }>
              {d.projects.length === 0 ? <EmptyState icon="flag" title={t("noneProjects")} /> : (
                <div className="table-wrap"><table>
                  <thead><tr><th>{t("code")}</th><th>{f("name")}</th><th>{f("customer")}</th><th>{t("contract")}</th></tr></thead>
                  <tbody>{d.projects.map(({ p, customer, contract }) => (
                    <tr key={p.id}><td className="ltr cell-title">{p.code}</td><td>{p.name}</td><td>{customer}</td><td className="ltr">{contract ?? "—"}</td></tr>
                  ))}</tbody>
                </table></div>
              )}
            </Card>
          )}
        </>
      )}

      {tab === "accounting" && (
        <>
          {d.moneyAccounts && (
            <Card flush title={t("moneyAccounts")} subtitle={t("moneyAccountsHelp")} icon="wallet" actions={
              <Modal label={t("addMoneyAccount")} icon={plus}>
                <ActionForm command="money_accounts.create" locale={locale} idempotencyKey={k()} submitLabel={f("create")}>
                  <div className="grid2">
                    <label>{f("name")}<input name="name" required /></label>
                    <label>{t("kind")}<select name="kind"><option value="cash">{t("cashBox")}</option><option value="bank">{t("bank")}</option></select></label>
                    <label>{t("currency")}<select name="currency" required><option value="IQD">IQD</option><option value="USD">USD</option></select></label>
                    <label>{t("ledgerAccount")}<select name="ledgerAccountId" required>{d.cashLedgerAccounts.map((a) => <option key={a.id} value={a.id}>{acctLabel(a)}</option>)}</select></label>
                  </div>
                </ActionForm>
              </Modal>
            }>
              <div className="table-wrap"><table>
                <thead><tr><th>{f("name")}</th><th>{t("kind")}</th><th>{t("currency")}</th></tr></thead>
                <tbody>{d.moneyAccounts.map((m) => <tr key={m.id}><td className="cell-title"><Icon name={m.kind === "bank" ? "bank" : "wallet"} size={15} /> {m.name}</td><td>{t(m.kind === "cash" ? "cashBox" : "bank")}</td><td>{m.currency}</td></tr>)}</tbody>
              </table></div>
            </Card>
          )}

          {d.settings && (
            <Card title={t("postingAccounts")} subtitle={t("postingHelp")} icon="layers">
              <ActionForm command="settings.posting_accounts" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
                <div className="grid3">
                  {POSTING_KEYS.map((key) => (
                    <label key={key}>{t(`posting_${key}`)}
                      <select name={`v_${key}`} defaultValue={(d.settings!.posting as Record<string, string>)[key] ?? ""}>
                        <option value="">{t("notSet")}</option>
                        {d.postableAccounts.map((a) => <option key={a.id} value={a.code}>{acctLabel(a)}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                <label>{f("reason")}<input name="reason" required /></label>
              </ActionForm>
            </Card>
          )}

          {d.accounts && (
            <Card flush title={t("accounts")} subtitle={t("accountsHelp")} icon="book" actions={
              <Modal label={t("addAccount")} icon={plus}>
                <ActionForm command="ledger.create_account" locale={locale} idempotencyKey={k()} submitLabel={f("create")}>
                  <div className="grid2">
                    <label>{t("code")}<input name="code" required dir="ltr" /></label>
                    <label>{f("name")}<input name="name" required /></label>
                    <label>{t("type")}<select name="type" required>{["asset", "liability", "equity", "income", "expense"].map((x) => <option key={x} value={x}>{t(`type_${x}`)}</option>)}</select></label>
                    <label>{t("onlyCurrency")}<select name="currency" defaultValue=""><option value="">{t("anyCurrency")}</option><option value="IQD">IQD</option><option value="USD">USD</option></select></label>
                  </div>
                </ActionForm>
              </Modal>
            }>
              <div className="table-wrap"><table>
                <thead><tr><th>{t("code")}</th><th>{f("name")}</th><th>{t("type")}</th><th>{t("onlyCurrency")}</th></tr></thead>
                <tbody>{d.accounts.map((a) => <tr key={a.id}><td className="ltr cell-title">{a.code}</td><td>{a.name}</td><td>{t(`type_${a.type}`)}</td><td>{a.currency ?? <span className="muted">{t("anyCurrency")}</span>}</td></tr>)}</tbody>
              </table></div>
            </Card>
          )}
        </>
      )}

      {tab === "settings" && d.settings && (
        <div className="grid cols-2">
          <Card title={t("paymentLimits")} subtitle={t("limitsHelp")} icon="shield">
            <ActionForm command="settings.payment_limits" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
              <div className="grid2">
                {["IQD", "USD"].map((cur) => <label key={cur}>{cur}<input name={`v_${cur}`} inputMode="decimal" dir="ltr" defaultValue={(d.settings!.limits as Record<string, string>)[cur] ?? ""} /></label>)}
              </div>
              <label>{f("reason")}<input name="reason" required /></label>
            </ActionForm>
          </Card>
          <Card title={t("roundingTitle")} subtitle={t("roundingHelp")} icon="dollar">
            <ActionForm command="settings.rounding" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
              <div className="grid2">
                {["IQD", "USD"].map((cur) => <label key={cur}>{cur}<input name={`v_${cur}`} inputMode="decimal" dir="ltr" defaultValue={(d.settings!.rounding as Record<string, string>)[cur] ?? ""} /></label>)}
              </div>
              <label>{f("reason")}<input name="reason" required /></label>
            </ActionForm>
          </Card>
          <Card title={t("transitDays")} subtitle={t("transitDaysHelp")} icon="truck">
            <ActionForm command="settings.trip_transit_days" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
              <div className="grid2">
                <label>{t("days")}<input name="days" type="number" min={1} required defaultValue={d.settings.transitDays ?? undefined} /></label>
                <label>{f("reason")}<input name="reason" required /></label>
              </div>
            </ActionForm>
          </Card>
        </div>
      )}
    </Shell>
  );
}
