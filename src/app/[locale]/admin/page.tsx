import { eq } from "drizzle-orm";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users as usersTable } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { Badge, Card, PageHeader, initials } from "@/components/ui";
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

  const permLabel = (x: string) => (p.has(x.replaceAll(".", "_")) ? p(x.replaceAll(".", "_")) : x);
  const plus = <Icon name="plus" size={16} />;

  return (
    <Shell wide permissions={actor.permissions} locale={locale} userName={me.displayName} path="/admin">
      <PageHeader title={t("title")} subtitle={t("subtitle")} actions={<>
        {can(actor, "audit.view") && <Link href={`/${locale}/admin/audit`} className="btn"><Icon name="history" size={16} />{t("auditLog")}</Link>}
        {d.canRoles && d.roles.length > 0 && (
          <Modal label={t("assign")} icon={<Icon name="shield" size={16} />}>
            <ActionForm command="org.assign_role" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
              <div className="grid2">
                <label>{t("user")}<select name="userId" required>{d.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}</select></label>
                <label>{t("role")}<select name="roleId" required>{d.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
                <label>{t("action")}<select name="grant" defaultValue="true"><option value="true">{t("grant")}</option><option value="false">{t("revoke")}</option></select></label>
                <label>{t("reason")}<input name="reason" required /></label>
              </div>
            </ActionForm>
          </Modal>
        )}
        {d.canUsers && (
          <Modal label={t("addUser")} variant="primary" icon={plus}>
            <p className="muted">{t("addUserHelp")}</p>
            <ActionForm command="org.create_user" locale={locale} idempotencyKey={k()} submitLabel={f("create")}>
              <div className="grid2">
                <label>{t("name")}<input name="displayName" required /></label>
                <label>{t("email")}<input name="email" type="email" required dir="ltr" /></label>
                <label>{t("language")}<select name="locale" defaultValue="ckb"><option value="ckb">کوردی</option><option value="ar">العربية</option><option value="en">English</option></select></label>
              </div>
            </ActionForm>
          </Modal>
        )}
      </>} />

      <Card flush title={t("users")} subtitle={t("usersCount", { count: d.users.filter((u) => u.active).length })} icon="users">
        <div className="table-wrap"><table>
          <thead><tr><th>{t("name")}</th><th>{t("roles")}</th><th>{t("status")}</th><th /></tr></thead>
          <tbody>{d.users.map((u) => (
            <tr key={u.id} className={u.active ? "" : "muted"}>
              <td><div className="row" style={{ gap: 10, flexWrap: "nowrap" }}><span className="avatar">{initials(u.displayName)}</span><div><div className="cell-title">{u.displayName}</div><div className="cell-sub ltr">{u.email}</div></div></div></td>
              <td className="wrap"><div className="chips">{u.roles.length === 0 ? <span className="muted">—</span> : u.roles.map((r) => <Badge key={r.id} tone="accent" plain>{r.name}</Badge>)}</div></td>
              <td><Badge tone={u.active ? "success" : undefined}>{u.active ? t("active") : t("inactive")}</Badge></td>
              <td className="actions-cell">{d.canUsers && u.id !== actor.userId && (
                <Modal small size="sm" variant={u.active ? "ghost" : "secondary"} label={u.active ? t("deactivate") : t("activate")} title={`${u.active ? t("deactivate") : t("activate")} · ${u.displayName}`}>
                  <ActionForm command="org.set_user_active" locale={locale} idempotencyKey={k()} submitLabel={u.active ? t("deactivate") : t("activate")} variant={u.active ? "danger" : "primary"}>
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="hidden" name="active" value={u.active ? "false" : "true"} />
                    <label>{t("reason")}<input name="reason" required /></label>
                  </ActionForm>
                </Modal>
              )}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>

      <Card title={t("rolesTitle")} subtitle={t("rolesHelp")} icon="shield" actions={d.canRoles && (
        <Modal label={t("defineRole")} size="lg" icon={plus}>
          <p className="muted">{t("defineRoleHelp")}</p>
          <ActionForm command="org.define_role" locale={locale} idempotencyKey={k()} submitLabel={f("save")}>
            <div className="grid2">
              <label>{t("code")}<input name="code" required dir="ltr" /></label>
              <label>{t("name")}<input name="name" required /></label>
            </div>
            {grouped.map(([g, list]) => (
              <fieldset key={g} className="checks"><legend>{t(`group_${g}`)}</legend>
                {list.map((x) => (
                  <label key={x} className="check" title={x}>
                    <input type="checkbox" name="permissions[]" value={x} disabled={!held.has(x)} />{permLabel(x)}
                  </label>
                ))}
              </fieldset>
            ))}
            <label>{t("reason")}<input name="reason" required /></label>
          </ActionForm>
        </Modal>
      )}>
        <div className="tiles">{d.roles.map((r) => (
          <div key={r.id} className="tile">
            <div className="tile-title">{r.name} <span className="muted ltr small">{r.code}</span></div>
            {grouped.map(([g, list]) => {
              const has = list.filter((x) => r.permissions.includes(x));
              return has.length === 0 ? null : (
                <div key={g}><div className="muted small" style={{ marginBlockEnd: 4 }}>{t(`group_${g}`)}</div><div className="chips">{has.map((x) => <Badge key={x} plain>{permLabel(x)}</Badge>)}</div></div>
              );
            })}
          </div>
        ))}</div>
      </Card>
    </Shell>
  );
}
