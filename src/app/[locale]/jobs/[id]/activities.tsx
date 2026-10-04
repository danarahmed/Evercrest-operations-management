import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { Badge, Card, EmptyState } from "@/components/ui";
import type { jobActivities } from "@/db/schema";

type Row = { a: typeof jobActivities.$inferSelect; assignee: string | null };

/** The job's checklist: simple steps with an owner and a due date. Required steps gate completion. */
export async function ActivitiesSection({ locale, jobId, activities, users, editable }: {
  locale: string;
  jobId: string;
  activities: Row[];
  users: { id: string; name: string }[];
  editable: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "Activities" });
  const today = new Date().toISOString().slice(0, 10);
  const done = activities.filter((x) => x.a.status !== "open").length;
  const pct = activities.length ? Math.round((done / activities.length) * 100) : 0;
  return (
    <Card
      title={t("title")}
      icon="list"
      flush
      subtitle={activities.length > 0 ? t("progress", { done, total: activities.length }) : undefined}
      actions={editable && (
        <Modal label={t("add")} icon={<Icon name="plus" size={16} />} small>
          <ActionForm command="activities.add" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("add")}>
            <input type="hidden" name="jobId" value={jobId} />
            <div className="grid2">
              <label>{t("step")}<input name="title" required /></label>
              <label>{t("assignee")}<select name="assignedUserId" defaultValue=""><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
              <label>{t("due")}<input type="date" name="dueDate" /></label>
            </div>
            <label className="check"><input type="checkbox" name="required" value="true" />{t("requiredHelp")}</label>
          </ActionForm>
        </Modal>
      )}
    >
      {activities.length > 0 && <div style={{ padding: "0 18px 12px" }}><div className="progress"><span style={{ width: `${pct}%` }} /></div></div>}
      {activities.length === 0 ? (
        <EmptyState icon="list" title={t("none")} hint={t("noneHint")} />
      ) : (
        <ul className="steps">
          {activities.map(({ a, assignee }) => (
            <li key={a.id} className={a.status}>
              <span className="step-dot">{a.status === "done" ? <Icon name="check" size={13} /> : a.status === "skipped" ? <Icon name="x" size={12} /> : null}</span>
              <div className="step-main">
                <div className="row" style={{ gap: 6 }}>
                  <span className="step-title">{a.title}</span>
                  {a.required && <Badge tone="warning" plain>{t("required")}</Badge>}
                </div>
                <div className="small muted">
                  {[assignee, a.dueDate && (a.status === "open" && a.dueDate < today ? `⚠ ${a.dueDate}` : a.dueDate), a.note].filter(Boolean).join(" · ")}
                </div>
              </div>
              {editable && (
                <div className="row no-print" style={{ gap: 4 }}>
                  {a.status === "open" ? (
                    <>
                      <ActionForm command="activities.set_status" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("markDone")} inline>
                        <input type="hidden" name="activityId" value={a.id} /><input type="hidden" name="status" value="done" />
                      </ActionForm>
                      <Modal label={t("skip")} variant="ghost" small size="sm" title={`${t("skip")}: ${a.title}`}>
                        <ActionForm command="activities.set_status" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("skip")}>
                          <input type="hidden" name="activityId" value={a.id} /><input type="hidden" name="status" value="skipped" />
                          <label>{t("why")}<input name="note" required={a.required} /></label>
                        </ActionForm>
                      </Modal>
                    </>
                  ) : (
                    <ActionForm command="activities.set_status" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("reopen")} inline variant="secondary">
                      <input type="hidden" name="activityId" value={a.id} /><input type="hidden" name="status" value="open" />
                    </ActionForm>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
