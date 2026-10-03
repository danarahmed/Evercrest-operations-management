import { eq } from "drizzle-orm";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users as usersTable } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { can, PERMISSIONS } from "@/server/authz";
import { adminData } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../shell";

export const dynamic = "force-dynamic";

/** Permission groups, so the role editor reads like the business, not like code. */
const GROUPS: [string, string[]][] = [
  ["operations", ["jobs.view", "jobs.create", "jobs.manage", "trips.manage", "documents.record", "documents.verify"]],
  ["money", ["settlements.create", "settlements.reverse", "billing.create", "invoices.create", "invoices.cancel", "payments.create", "payments.reverse", "exchanges.create", "approvals.decide", "jobs.financial_close"]],
  ["books", ["reports.financial.view", "journal.post", "journal.reverse", "periods.manage", "accounts.manage", "money_accounts.manage"]],
  ["setup", ["partners.manage", "catalog.manage", "contracts.manage", "projects.manage", "job_types.manage", "rates.manage", "documents.configure", "settings.manage", "exchange_rates.manage"]],
  ["admin", ["users.manage", "roles.manage", "branches.manage", "audit.view"]],
];

/** Users and roles. Nobody can grant a permission they do not hold themselves. */
export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [me] = await db.select().from(usersTable).where(eq(usersTable.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Admin" });
  const p = await getTranslations({ locale, namespace: "Perm" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const d = await adminData(db, actor);
  const k = () => crypto.randomUUID();
  const held = new Set(d.held);
  const grouped = GROUPS.map(([g, list]) => [g, list.filter((x) => (PERMISSIONS as readonly string[]).includes(x))] as const);

  return (
    <Shell permissions={actor.permissions} locale={locale} userName={me.displayName} path="/admin">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>{t("title")}</h1>
        {can(actor, "audit.view") && <Link href={`/${locale}/admin/audit`}>{t("auditLog")} →</Link>}
      </div>

      <h2>{t("users")}</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>{t("name")}</th><th>{t("email")}</th><th>{t("roles")}</th><th>{t("status")}</th><th /></tr></thead>
        <tbody>{d.users.map((u) => (
          <tr key={u.id} className={u.active ? "" : "muted"}>
            <td>{u.displayName}</td><td dir="ltr">{u.email}</td>
            <td className="wrap">{u.roles.map((r) => <span key={r.id} className="badge">{r.name}</span>)}</td>
            <td><span className={`badge ${u.active ? "state-verified" : ""}`}>{u.active ? t("active") : t("inactive")}</span></td>
            <td>{d.canUsers && u.id !== actor.userId && (
              <ActionForm command="org.set_user_active" locale={locale} idempotencyKey={k()} submitLabel={u.active ? t("deactivate") : t("activate")}>
                <input type="hidden" name="userId" value={u.id} />
                <input type="hidden" name="active" value={u.active ? "false" : "true"} />
                <input name="reason" required placeholder={t("reason")} />
              </ActionForm>
            )}</td>
          </tr>
        ))}</tbody>
      </table></div>

      {d.canUsers && (
        <details className="panel">
          <summary>{t("addUser")}</summary>
          <p className="muted">{t("addUserHelp")}</p>
          <ActionForm command="org.create_user" locale={locale} idempotencyKey={k()} submitLabel={f("create")}>
            <div className="grid2">
              <label>{t("name")}<input name="displayName" required /></label>
              <label>{t("email")}<input name="email" type="email" required dir="ltr" /></label>
              <label>{t("language")}<select name="locale" defaultValue="ckb"><option value="ckb">کوردی</option><option value="ar">العربية</option><option value="en">English</option></select></label>
            </div>
          </ActionForm>
        </details>
      )}

      {d.canRoles && d.roles.length > 0 && (
        <details className="panel">
          <summary>{t("assign")}</summary>
          <ActionForm command="org.assign_role" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
            <div className="grid2">
              <label>{t("user")}<select name="userId" required>{d.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}</select></label>
              <label>{t("role")}<select name="roleId" required>{d.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
              <label>{t("action")}<select name="grant" defaultValue="true"><option value="true">{t("grant")}</option><option value="false">{t("revoke")}</option></select></label>
              <label>{t("reason")}<input name="reason" required /></label>
            </div>
          </ActionForm>
        </details>
      )}

      <h2>{t("rolesTitle")}</h2>
      <p className="muted">{t("rolesHelp")}</p>
      <div className="table-wrap"><table>
        <thead><tr><th>{t("role")}</th><th>{t("permissions")}</th></tr></thead>
        <tbody>{d.roles.map((r) => (
          <tr key={r.id}>
            <td><strong>{r.name}</strong><div className="muted" dir="ltr">{r.code}</div></td>
            <td className="wrap">{r.permissions.map((x) => p.has(x.replaceAll(".", "_")) ? p(x.replaceAll(".", "_")) : x).join(" · ")}</td>
          </tr>
        ))}</tbody>
      </table></div>

      {d.canRoles && (
        <details className="panel">
          <summary>{t("defineRole")}</summary>
          <p className="muted">{t("defineRoleHelp")}</p>
          <ActionForm command="org.define_role" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
            <div className="grid2">
              <label>{t("code")}<input name="code" required dir="ltr" /></label>
              <label>{t("name")}<input name="name" required /></label>
              <label>{t("reason")}<input name="reason" required /></label>
            </div>
            {grouped.map(([g, list]) => (
              <fieldset key={g} className="row"><legend>{t(`group_${g}`)}</legend>
                {list.map((x) => (
                  <label key={x} className="row" title={x}>
                    <input type="checkbox" name="permissions[]" value={x} disabled={!held.has(x)} />{p.has(x.replaceAll(".", "_")) ? p(x.replaceAll(".", "_")) : x}
                  </label>
                ))}
              </fieldset>
            ))}
          </ActionForm>
        </details>
      )}
    </Shell>
  );
}
