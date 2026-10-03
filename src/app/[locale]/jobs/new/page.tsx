import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { formOptions } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../shell";

export const dynamic = "force-dynamic";

/** Minimum fields only; capabilities come from the job type and can be changed on the job. */
export default async function NewJob({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const o = await formOptions(db, actor);
  const t = await getTranslations({ locale, namespace: "Forms" });
  return (
    <Shell locale={locale} userName={user.displayName} path="/jobs/new">
      <h1>{t("newJob")}</h1>
      <ActionForm command="jobs.create" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("createJob")} redirectTo={`/${locale}/jobs/{id}`}>
        <div className="grid2">
          <label>{t("customer")}<select name="customerId" required defaultValue=""><option value="" disabled>{t("choose")}</option>{o.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>{t("jobType")}<select name="jobTypeId" required defaultValue=""><option value="" disabled>{t("choose")}</option>{o.jobTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>{t("name")}<input name="name" required /></label>
          <label>{t("startDate")}<input type="date" name="startDate" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
          <label>{t("responsible")}<select name="responsibleUserId" required defaultValue={actor.userId}>{o.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label>{t("description")}<input name="description" /></label>
        </div>
      </ActionForm>
    </Shell>
  );
}
