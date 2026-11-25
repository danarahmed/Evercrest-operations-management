import { eq } from "drizzle-orm";
import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/ActionForm";
import { Icon } from "@/components/icons";
import { Modal } from "@/components/Modal";
import { Badge, Card, EmptyState, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { D, dec } from "@/domain/money";
import { formatMoney } from "@/lib/format";
import { formOptions, heldCutsPage } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../../shell";

export const dynamic = "force-dynamic";

/**
 * Cuts held for transporters (owner's rule, 2026-11): money cut from drivers on their trips, held until a
 * transporter asks for it. Give back (cash or to his account; the rest of each trip's cut becomes income),
 * close old cuts into income, and see every release. Every give-back and close waits for approval.
 */
export default async function HeldCutsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ m?: string; old?: string; do?: string }> }) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "HeldCuts" });
  const f = await getTranslations({ locale, namespace: "Forms" });
  const manifests = (sp.m ?? "").split(/[\n,;،\s]+/).map((x) => x.trim()).filter(Boolean);
  const old = sp.old === "1";
  const mode = sp.do === "give" || sp.do === "close" ? sp.do : null;
  const { held, releases, canReverse } = await heldCutsPage(db, actor, { manifests: manifests.length ? manifests : undefined, olderThanDays: old ? 365 : undefined });
  const options = mode === "give" ? await formOptions(db, actor) : null;
  const base = `/${locale}/claims/held`;
  const today = new Date().toISOString().slice(0, 10);
  const m = (a: string, c: string) => formatMoney(a, c, locale);
  const url = (q: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ m: sp.m, old: old ? "1" : undefined, do: mode ?? undefined, ...q }).filter(([, v]) => v) as [string, string][]);
    return p.size ? `${base}?${p}` : base;
  };
  const totals = new Map<string, InstanceType<typeof D>>();
  for (const h of held) totals.set(h.currency, (totals.get(h.currency) ?? new D(0)).plus(dec(h.held)));
  const allHeld = old || manifests.length ? null : held.length;
  // Ticked by default only when the list was narrowed to what the transporter asked for (pasted manifests) or to old cuts.
  const preTick = manifests.length > 0 || (mode === "close" && old);

  const table = (editable: "give" | "close" | null) => (
    <div className="table-wrap"><table className="dense">
      <thead><tr>
        {editable && <th />}
        <th>{t("manifest")}</th><th>{t("job")}</th><th>{t("driver")}</th><th>{t("transporterAtLoading")}</th><th>{t("claim")}</th><th className="num">{t("days")}</th><th className="num">{t("held")}</th>
        {editable === "give" && <th className="num">{t("giveBack")}</th>}
      </tr></thead>
      <tbody>{held.map((h) => (
        <tr key={h.tripId}>
          {editable && <td><input type="checkbox" name="tripIds[]" value={h.tripId} defaultChecked={preTick} aria-label={h.manifest} /></td>}
          <td className="ltr cell-title">{h.manifest}</td>
          <td><Link href={`/${locale}/jobs/${h.jobId}?tab=trips&trip=${h.tripId}`} className="ltr">{h.jobNo}</Link></td>
          <td>{h.driver ?? "—"}</td>
          <td>{h.transporterAtLoading ?? <span className="muted">{t("direct")}</span>}</td>
          <td><Link href={`/${locale}/claims/${h.claimId}`} className="ltr">{h.claimNo}</Link><div className="cell-sub ltr">{h.claimDate}</div></td>
          <td className={`num ${h.days >= 365 ? "warn" : ""}`}>{h.days}</td>
          <td className="num"><strong>{m(h.held, h.currency)}</strong></td>
          {editable === "give" && <td className="num"><input name={`give_${h.tripId}`} inputMode="decimal" dir="ltr" defaultValue={String(Number(h.held))} className="w-24" aria-label={`${t("giveBack")} ${h.manifest}`} /></td>}
        </tr>
      ))}</tbody>
    </table></div>
  );

  return (
    <Shell wide permissions={actor.permissions} locale={locale} userName={user.displayName} path="/claims">
      <PageHeader back={{ href: `/${locale}/claims`, label: t("backToClaims") }} title={t("title")} subtitle={t("intro")} />
      <div className="stats">
        <Stat icon="wallet" label={t("heldNow")} value={[...totals].map(([c, a]) => m(a.toString(), c)).join(" · ") || "—"} hint={t("onTrips", { count: held.length })} />
        <Stat icon="clock" label={t("olderThanYear")} value={held.filter((h) => h.days >= 365).length} href={url({ old: "1", m: undefined })} tone={held.some((h) => h.days >= 365) ? "warning" : undefined} />
        <Stat icon="list" label={t("releases")} value={releases.length} />
      </div>

      <Card flush title={mode === "give" ? t("giveTitle") : mode === "close" ? t("closeTitle") : t("listTitle")} subtitle={mode === "give" ? t("giveHelp") : mode === "close" ? t("closeHelp") : t("listHelp")} icon={mode ? "checkCircle" : "wallet"} actions={
        mode ? <Link href={url({ do: undefined })} className="btn">{t("cancelMode")}</Link> : (
          <div className="flex flex-wrap gap-2">
            <Link href={url({ do: "give" })} className="btn primary"><Icon name="wallet" size={16} />{t("giveTitle")}</Link>
            <Link href={url({ do: "close", old: "1", m: undefined })} className="btn">{t("closeTitle")}</Link>
          </div>
        )
      }>
        <div className="pad">
          <form method="get" action={base} className="flex flex-wrap items-end gap-3">
            {mode && <input type="hidden" name="do" value={mode} />}
            <label className="min-w-0 flex-1">{t("manifestsAsked")} <span className="hint">{t("manifestsAskedHint")}</span><textarea name="m" rows={2} dir="ltr" defaultValue={sp.m ?? ""} /></label>
            <label className="check pb-2"><input type="checkbox" name="old" value="1" defaultChecked={old} />{t("onlyOld")}</label>
            <button type="submit">{t("show")}</button>
            {(manifests.length > 0 || old) && <Link href={url({ m: undefined, old: undefined })} className="btn ghost">{t("clear")}</Link>}
          </form>
        </div>
        {held.length === 0 ? <EmptyState icon="wallet" title={allHeld === 0 ? t("noneHeld") : t("noneMatch")} /> : mode === "give" && options ? (
          <ActionForm command="held_cuts.give_back" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("sendForApproval")} approvalOnly summary={t("giveSummary")}>
            {table("give")}
            <div className="border-t border-slate-200 px-5 py-4">
              <p className="muted small">{t("giveRule")}</p>
              <div className="grid2">
                <label>{t("transporter")}<select name="transporterId" defaultValue=""><option value="">{f("choose")}</option>{options.transporters.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                <label>{t("orNewTransporter")}<input name="transporterName" /></label>
                <label>{t("method")}<select name="method" defaultValue="cash"><option value="cash">{t("method_cash")}</option><option value="account">{t("method_account")}</option></select></label>
                <label>{t("cashBox")} <span className="hint">{t("cashBoxHint")}</span><select name="moneyAccountId" defaultValue=""><option value="">{f("choose")}</option>{options.moneyAccounts.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}</select></label>
                <label>{f("date")}<input type="date" name="releaseDate" required defaultValue={today} /></label>
                <label>{t("note")} <span className="hint">{f("optional")}</span><input name="reason" /></label>
              </div>
            </div>
          </ActionForm>
        ) : mode === "close" ? (
          <ActionForm command="held_cuts.close" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("sendForApproval")} approvalOnly summary={t("closeSummary")}>
            {table("close")}
            <div className="border-t border-slate-200 px-5 py-4">
              <div className="grid2">
                <label>{t("closeReason")}<input name="reason" required placeholder={t("closeReasonExample")} /></label>
                <label>{f("date")}<input type="date" name="releaseDate" required defaultValue={today} /></label>
              </div>
            </div>
          </ActionForm>
        ) : table(null)}
      </Card>

      <Card flush title={t("releasesTitle")} subtitle={t("releasesHelp")} icon="list">
        {releases.length === 0 ? <EmptyState icon="list" title={t("noReleases")} /> : (
          <div className="table-wrap"><table className="dense">
            <thead><tr><th>{t("number")}</th><th>{f("date")}</th><th>{t("what")}</th><th>{t("transporter")}</th><th>{t("trips")}</th><th className="num">{t("given")}</th><th className="num">{t("kept")}</th><th>{t("status")}</th><th /></tr></thead>
            <tbody>{releases.map((r) => (
              <tr key={r.id} className={r.status === "reversed" ? "muted" : undefined}>
                <td className="ltr cell-title">{r.releaseNo}</td>
                <td className="ltr">{r.releaseDate}</td>
                <td>{r.kind === "close" ? <Badge>{t("kind_close")}</Badge> : <Badge tone="info">{r.method === "cash" ? `${t("kind_give_back")} · ${r.box ?? t("method_cash")}` : `${t("kind_give_back")} · ${t("method_account")}`}</Badge>}{r.reason && <div className="cell-sub">{r.reason}</div>}</td>
                <td>{r.transporter ?? "—"}</td>
                <td className="wrap small ltr">{r.lines.map((l) => l.manifest).join(", ")}</td>
                <td className="num">{m(r.givenTotal, r.currency)}</td>
                <td className="num">{m(r.keptTotal, r.currency)}</td>
                <td><StatusBadge status={r.status} label={t(`status_${r.status}`)} /></td>
                <td className="actions-cell">{canReverse && r.status === "posted" && (
                  <Modal label={t("reverse")} title={<>{t("reverse")} · <span className="ltr">{r.releaseNo}</span></>} variant="ghost" small>
                    <p className="muted">{t("reverseHelp")}</p>
                    <ActionForm command="held_cuts.reverse" locale={locale} idempotencyKey={crypto.randomUUID()} submitLabel={t("reverse")} variant="danger">
                      <input type="hidden" name="releaseId" value={r.id} />
                      <div className="grid2">
                        <label>{f("date")}<input type="date" name="reversalDate" required defaultValue={today} /></label>
                        <label>{t("reverseReason")}<input name="reason" required /></label>
                      </div>
                    </ActionForm>
                  </Modal>
                )}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </Shell>
  );
}
