import { eq } from "drizzle-orm";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { Icon } from "@/components/icons";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { JOB_STATUSES } from "@/db/schema/jobs";
import { describe } from "@/lib/format";
import { can } from "@/server/authz";
import { formOptions, jobsList } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../shell";

export const dynamic = "force-dynamic";

/** Every job, searchable. Active jobs by default. */
export default async function JobsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string; status?: string; customer?: string; type?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Jobs" });
  const st = await getTranslations({ locale, namespace: "JobStatus" });
  const codes = await getTranslations({ locale, namespace: "Codes" });
  const sp = await searchParams;
  const [rows, o] = await Promise.all([jobsList(db, actor, { q: sp.q, status: sp.status, customerId: sp.customer, typeId: sp.type }), formOptions(db, actor)]);
  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path="/jobs">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={can(actor, "jobs.create") && <Link href={`/${locale}/jobs/new`} className="btn primary"><Icon name="plus" />{t("newJob")}</Link>}
      />
      <form className="filters no-print" method="get">
        <label>{t("search")}<input name="q" defaultValue={sp.q ?? ""} placeholder={t("searchHint")} /></label>
        <label>{t("status")}
          <select name="status" defaultValue={sp.status ?? "active"}>
            <option value="active">{t("active")}</option>
            <option value="all">{t("all")}</option>
            {JOB_STATUSES.map((s) => <option key={s} value={s}>{st(s)}</option>)}
          </select>
        </label>
        <label>{t("customer")}<select name="customer" defaultValue={sp.customer ?? ""}><option value="">{t("allCustomers")}</option>{o.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>{t("type")}<select name="type" defaultValue={sp.type ?? ""}><option value="">{t("allTypes")}</option>{o.jobTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <button type="submit"><Icon name="search" size={16} />{t("show")}</button>
      </form>
      <Card flush title={t("count", { count: rows.length })}>
        {rows.length === 0 ? <EmptyState icon="briefcase" title={t("none")} hint={t("noneHint")} /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>{t("job")}</th><th>{t("customer")}</th><th>{t("type")}</th><th>{t("started")}</th><th>{t("status")}</th><th>{t("nextAction")}</th></tr></thead>
            <tbody>{rows.map(({ job, customer, type, responsible, nextAction }) => (
              <tr key={job.id}>
                <td className="wrap">
                  <Link href={`/${locale}/jobs/${job.id}`} className="cell-title">{job.name}</Link>
                  <div className="cell-sub"><span className="ltr">{job.jobNo}</span> · {responsible}</div>
                </td>
                <td>{customer}</td><td>{type}</td><td>{job.startDate}</td>
                <td><StatusBadge status={job.status} label={st(job.status)} /></td>
                <td className="next wrap">{nextAction ? describe(codes, nextAction.code, nextAction.params, nextAction.text, locale) : <span className="muted">—</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </Shell>
  );
}
