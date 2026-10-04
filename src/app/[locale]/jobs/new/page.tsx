import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { jobTypes, users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { Card, PageHeader } from "@/components/ui";
import { formOptions } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../shell";

export const dynamic = "force-dynamic";

/** Minimum fields only (CLAUDE.md §5); parts of the job come from the job type and can be changed later. */
export default async function NewJob({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const o = await formOptions(db, actor);
  const types = await db.select().from(jobTypes).where(eq(jobTypes.companyId, actor.companyId)).orderBy(jobTypes.name);
  const t = await getTranslations({ locale, namespace: "Forms" });
  const j = await getTranslations({ locale, namespace: "Jobs" });
  const cap = await getTranslations({ locale, namespace: "Setup" });
  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path="/jobs/new">
      <PageHeader back={{ href: `/${locale}/jobs`, label: j("title") }} title={t("newJob")} subtitle={j("newSubtitle")} />
      <div className="grid side">
        <Card title={j("basics")} icon="briefcase">
          <ActionForm command="jobs.create" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("createJob")} redirectTo={`/${locale}/jobs/{id}`}>
            <div className="grid2">
              <label>{t("customer")}<select name="customerId" required defaultValue=""><option value="" disabled>{t("choose")}</option>{o.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label>{t("jobType")}<select name="jobTypeId" required defaultValue=""><option value="" disabled>{t("choose")}</option>{o.jobTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            </div>
            <label>{t("name")}<input name="name" required placeholder={j("namePlaceholder")} /></label>
            <div className="grid2">
              <label>{t("startDate")}<input type="date" name="startDate" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
              <label>{t("responsible")}<select name="responsibleUserId" required defaultValue={actor.userId}>{o.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
            </div>
            <label>{t("description")}<textarea name="description" rows={3} /></label>
            {(o.projects.length > 0 || o.contracts.length > 0) && (
              <details className="more">
                <summary>+ {t("moreLinks")}</summary>
                <div className="grid2" style={{ marginBlockStart: 10 }}>
                  <label>{t("project")}<select name="projectId" defaultValue=""><option value="">—</option>{o.projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name} ({p.customer})</option>)}</select></label>
                  <label>{t("contract")}<select name="contractId" defaultValue=""><option value="">—</option>{o.contracts.map((c) => <option key={c.id} value={c.id}>{c.reference} · {c.title} ({c.partner})</option>)}</select></label>
                </div>
              </details>
            )}
          </ActionForm>
        </Card>
        <Card title={j("typesTitle")} icon="layers" subtitle={j("typesHelp")}>
          <div className="stack">
            {types.map((ty) => (
              <div key={ty.id}>
                <div style={{ fontWeight: 650 }}>{ty.name}</div>
                <div className="chips" style={{ marginBlock: "4px 2px" }}>{(ty.defaultCapabilities as string[]).map((c) => <span key={c} className="chip">{cap(`cap_${c}`)}</span>)}</div>
                {(ty.defaultActivities as string[]).length > 0 && <div className="small muted">{(ty.defaultActivities as string[]).join(" → ")}</div>}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
