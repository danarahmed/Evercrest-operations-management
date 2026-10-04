import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { intlLocale } from "@/lib/format";
import { documentLibrary, type LibraryStatus } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../shell";

export const dynamic = "force-dynamic";

const STATUSES: LibraryStatus[] = ["all", "to_verify", "missing", "verified", "rejected"];
const ICON_TONE = { received: "bg-amber-50 text-amber-600", verified: "bg-emerald-50 text-emerald-600", rejected: "bg-rose-50 text-rose-600", missing: "bg-rose-50 text-rose-600" } as const;

/**
 * The document library: every document the company holds and every one still
 * missing on a running job, found by reference, job, trip, partner or type.
 * Documents waiting for a check can be verified or rejected right here.
 */
export default async function Documents({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ q?: string; status?: string; type?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Library" });
  const v = await getTranslations({ locale, namespace: "Verify" });
  const status = (STATUSES.includes(sp.status as LibraryStatus) ? sp.status : "all") as LibraryStatus;
  const lib = await documentLibrary(db, actor, { q: sp.q, status, typeId: sp.type || undefined });
  const dtf = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" });
  const qs = (st: LibraryStatus) => {
    const p = new URLSearchParams();
    if (st !== "all") p.set("status", st);
    if (sp.q) p.set("q", sp.q);
    if (sp.type) p.set("type", sp.type);
    const s = p.toString();
    return `/${locale}/documents${s ? `?${s}` : ""}`;
  };
  const empty = lib.documents.length === 0 && lib.missing.length === 0;
  const stage = (b: string) => (b === "completed" ? t("beforeCompletion") : t("beforeClose"));

  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path="/documents">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <form className="filters no-print" method="get">
        {status !== "all" && <input type="hidden" name="status" value={status} />}
        <label className="!min-w-0 flex-[1_1_260px]">{t("find")}<input name="q" defaultValue={sp.q ?? ""} placeholder={t("findHint")} className="!w-full" /></label>
        <label>{t("type")}
          <select name="type" defaultValue={sp.type ?? ""}>
            <option value="">{t("allTypes")}</option>
            {lib.types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <button type="submit"><Icon name="search" size={16} />{t("show")}</button>
      </form>

      <nav className="chips no-print mb-5" aria-label={t("status")}>
        {STATUSES.map((s) => (
          <Link key={s} href={qs(s)} className={`chip${s === status ? " on" : ""}`} aria-current={s === status ? "true" : undefined}>
            {t(`st_${s}`)}
            <span className={`rounded-full px-2 text-[12px] leading-5 ${s === status ? "bg-white/20" : s === "to_verify" && lib.counts.to_verify ? "bg-amber-50 text-amber-600" : s === "missing" && lib.counts.missing ? "bg-rose-50 text-rose-600" : "text-slate-400"}`}>{lib.counts[s]}</span>
          </Link>
        ))}
      </nav>

      <Card flush>
        {empty ? <EmptyState icon="file" title={t("none")} hint={t("noneHint")} /> : (
          <ul className="m-0 list-none p-0">
            {lib.missing.map((m) => (
              <li key={m.key} className="flex flex-wrap items-center gap-3.5 border-b border-slate-100 px-[22px] py-3.5 last:border-b-0">
                <span className={`grid size-10 flex-none place-items-center rounded-[10px] ${ICON_TONE.missing}`}><Icon name="file" /></span>
                <span className="grid min-w-0 flex-[1_1_260px]">
                  <span className="font-bold text-slate-900">{m.type}</span>
                  <span className="truncate text-[13px] text-slate-500"><span className="ltr">{m.target}</span> · {m.jobName} · {m.customer} · {stage(m.requiredBefore)}</span>
                </span>
                <Badge tone="danger">{t("st_missing")}</Badge>
                <Link href={`/${locale}/jobs/${m.jobId}?tab=documents`} className="btn sm">{t("recordOnJob")}</Link>
              </li>
            ))}
            {lib.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3.5 border-b border-slate-100 px-[22px] py-3.5 last:border-b-0">
                <span className={`grid size-10 flex-none place-items-center rounded-[10px] ${ICON_TONE[d.status]}`}><Icon name="file" /></span>
                <span className="grid min-w-0 flex-[1_1_260px]">
                  <span className="font-bold text-slate-900">{d.type}{d.reference && <> · <span className="ltr">{d.reference}</span></>}</span>
                  <span className="truncate text-[13px] text-slate-500">
                    {d.jobId ? <Link href={`/${locale}/jobs/${d.jobId}?tab=documents`} className="ltr font-semibold">{d.target}</Link> : <span className="ltr">{d.target}</span>}
                    {d.jobName && <> · {d.jobName}</>}{d.customer && <> · {d.customer}</>} · {t("receivedOn", { date: dtf.format(d.receivedAt), name: d.receivedBy })}
                  </span>
                  {d.status === "rejected" && d.reviewNote && <span className="text-[13px] text-rose-600">{d.reviewNote}</span>}
                </span>
                <Badge tone={d.status === "verified" ? "success" : d.status === "rejected" ? "danger" : "warning"}>{t(`doc_${d.status}`)}</Badge>
                {d.status === "received" && lib.canVerify && (
                  <div className="flex items-center gap-2">
                    <ActionForm command="documents.review" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={v("verify")} inline>
                      <input type="hidden" name="documentId" value={d.id} />
                      <input type="hidden" name="decision" value="verified" />
                    </ActionForm>
                    <Modal label={v("reject")} variant="danger" small size="sm" icon={<Icon name="x" size={15} />}>
                      <ActionForm command="documents.review" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={v("reject")} variant="danger">
                        <input type="hidden" name="documentId" value={d.id} />
                        <input type="hidden" name="decision" value="rejected" />
                        <label>{v("whyReject")}<input name="note" required /></label>
                      </ActionForm>
                    </Modal>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Shell>
  );
}
