import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/ActionForm";
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
  if (!activities.length && !editable) return null;
  const done = activities.filter((x) => x.a.status !== "open").length;
  return (
    <>
      <h2>{t("title")} {activities.length > 0 && <span className="muted">({done}/{activities.length})</span>}</h2>
      {activities.length > 0 && (
        <div className="table-wrap"><table>
          <tbody>{activities.map(({ a, assignee }) => (
            <tr key={a.id} className={a.status !== "open" ? "muted" : ""}>
              <td style={{ width: "2em" }}>{a.status === "done" ? "✓" : a.status === "skipped" ? "–" : "○"}</td>
              <td>
                <span style={a.status !== "open" ? { textDecoration: "line-through" } : undefined}>{a.title}</span>
                {a.required && <span className="badge">{t("required")}</span>}
                {a.note && <div className="muted">{a.note}</div>}
              </td>
              <td>{assignee ?? ""}</td>
              <td className={a.status === "open" && a.dueDate && a.dueDate < today ? "state-missing" : ""}>{a.dueDate ?? ""}</td>
              <td className="no-print">{editable && (
                <div className="row">
                  {a.status === "open" ? (
                    <>
                      <ActionForm command="activities.set_status" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("markDone")}>
                        <input type="hidden" name="activityId" value={a.id} /><input type="hidden" name="status" value="done" />
                      </ActionForm>
                      <details>
                        <summary>{t("skip")}</summary>
                        <ActionForm command="activities.set_status" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("skip")}>
                          <input type="hidden" name="activityId" value={a.id} /><input type="hidden" name="status" value="skipped" />
                          <input name="note" placeholder={t("why")} required={a.required} />
                        </ActionForm>
                      </details>
                    </>
                  ) : (
                    <ActionForm command="activities.set_status" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("reopen")}>
                      <input type="hidden" name="activityId" value={a.id} /><input type="hidden" name="status" value="open" />
                    </ActionForm>
                  )}
                </div>
              )}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {editable && (
        <details className="panel">
          <summary>{t("add")}</summary>
          <ActionForm command="activities.add" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("add")}>
            <input type="hidden" name="jobId" value={jobId} />
            <div className="grid2">
              <label>{t("step")}<input name="title" required /></label>
              <label>{t("assignee")}<select name="assignedUserId" defaultValue=""><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
              <label>{t("due")}<input type="date" name="dueDate" /></label>
              <label className="row"><input type="checkbox" name="required" value="true" />{t("requiredHelp")}</label>
            </div>
          </ActionForm>
        </details>
      )}
    </>
  );
}
