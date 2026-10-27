"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, startTransition, useActionState, useEffect, useRef, useState } from "react";
import { type FormState, submitCommand } from "@/app/[locale]/actions";
import { Icon } from "../icons";
import { usePopover } from "./popover";

/**
 * Option A (owner's choice): one short entry line above the trip grid. Per
 * truck only what changes is typed — driver, plate, manifest, tons, advance —
 * Tab moves right, Enter saves (trips.save) and the cursor returns to Driver.
 * Date, route, transporter, price, reward and the advance account are sticky
 * pills that repeat for every truck until changed. Each saved trip is listed
 * under the line and appears in the grid (the page refreshes after a save).
 */
export function EntryLine({ locale, jobId, lists, moneyAccounts, advancesEnabled, defaults }: {
  locale: string;
  jobId: string;
  lists: { routes: string[]; transporters: string[]; drivers: { name: string; plate: string | null }[] };
  moneyAccounts: { id: string; name: string; currency: string }[];
  advancesEnabled: boolean;
  defaults: { loadingDate: string; route: string; transporter: string };
}) {
  const t = useTranslations("Trips");
  const f = useTranslations("Forms");
  const router = useRouter();
  const [state, action, pending] = useActionState<FormState, FormData>(submitCommand, {});
  const [key, setKey] = useState(() => crypto.randomUUID());
  const pop = usePopover();
  const driverRef = useRef<HTMLInputElement>(null);

  // Sticky values (repeat for every truck)
  const [sticky, setSticky] = useState({ loadingDate: defaults.loadingDate, route: defaults.route, transporter: defaults.transporter, price: "", reward: "", advance: "", account: moneyAccounts[0]?.id ?? "" });
  // Per-truck values (cleared after each save)
  const blank = { driver: "", plate: "", manifest: "", loaded: "" };
  const [truck, setTruck] = useState(blank);
  const [saved, setSaved] = useState<{ manifest: string; driver: string }[]>([]);
  const lastHandled = useRef<FormState>(state);

  useEffect(() => {
    if (state === lastHandled.current) return;
    lastHandled.current = state;
    if (!state.ok) return;
    setSaved((xs) => [{ manifest: truck.manifest, driver: truck.driver }, ...xs].slice(0, 8));
    setTruck(blank);
    setKey(state.nextKey ?? crypto.randomUUID());
    router.refresh();
    setTimeout(() => driverRef.current?.focus(), 0);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDriver = (name: string) => {
    const known = lists.drivers.find((d) => d.name === name);
    setTruck((x) => ({ ...x, driver: name, plate: x.plate || (known?.plate ?? "") }));
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const d = new FormData();
    d.set("__command", "trips.save");
    d.set("__key", key);
    d.set("__locale", locale);
    d.set("__summary", `${truck.manifest} · ${truck.driver}`);
    if (submitter?.value === "approval") d.set("__mode", "approval");
    d.set("jobId", jobId);
    d.set("manifestNo", truck.manifest);
    d.set("driverName", truck.driver);
    d.set("plate", truck.plate);
    d.set("loadedQty", truck.loaded);
    d.set("loadingDate", sticky.loadingDate);
    if (sticky.route) d.set("routeName", sticky.route);
    if (sticky.transporter) d.set("transporterName", sticky.transporter); else d.set("transporterClear", "1");
    if (sticky.price) d.set("carrierPriceOverride", sticky.price);
    if (sticky.reward) d.set("rewardOverride", sticky.reward);
    if (advancesEnabled && sticky.advance && sticky.account) { d.set("advanceAmount", sticky.advance); d.set("advanceMoneyAccountId", sticky.account); }
    startTransition(() => action(d));
  };

  const account = moneyAccounts.find((a) => a.id === sticky.account);
  const pill = (label: string, value: string) => <span className="pill"><span className="muted">{label}</span> {value}</span>;
  const set = (k: keyof typeof sticky) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setSticky((s) => ({ ...s, [k]: e.target.value }));

  return (
    <form onSubmit={onSubmit} className="entry-line" aria-label={t("entryTitle")}>
      <datalist id="el-routes">{lists.routes.map((x) => <option key={x} value={x} />)}</datalist>
      <datalist id="el-transporters">{lists.transporters.map((x) => <option key={x} value={x} />)}</datalist>
      <datalist id="el-drivers">{lists.drivers.map((x) => <option key={x.name} value={x.name} />)}</datalist>

      <div className="entry-sticky">
        <span className="muted">{t("entryRepeats")}</span>
        {pill(t("date"), sticky.loadingDate)}
        {pill(t("col_route"), sticky.route || "—")}
        {pill(t("col_transporter"), sticky.transporter || t("direct"))}
        {(sticky.price || sticky.reward) && pill(t("col_carrierPrice"), `${sticky.price || "—"}${sticky.reward ? ` · ${t("col_reward")} ${sticky.reward}` : ""}`)}
        {advancesEnabled && pill(t("col_advance"), sticky.advance && account ? `${sticky.advance} ${account.currency} · ${account.name}` : t("entryNoAdvance"))}
        <details className="colfilter pop-host entry-change" ref={pop}>
          <summary className="btn ghost sm"><Icon name="sliders" size={14} />{t("entryChange")}</summary>
          <div className="colfilter-pop pop entry-pop">
            <label>{t("date")}<input type="date" value={sticky.loadingDate} onChange={set("loadingDate")} dir="ltr" /></label>
            <label>{t("col_route")}<input list="el-routes" value={sticky.route} onChange={set("route")} autoComplete="off" /></label>
            <label>{t("col_transporter")} <span className="hint">{t("entryTransporterHint")}</span><input list="el-transporters" value={sticky.transporter} onChange={set("transporter")} autoComplete="off" placeholder={t("direct")} /></label>
            <div className="grid2">
              <label>{t("entryPrice")}<input inputMode="decimal" value={sticky.price} onChange={set("price")} placeholder={t("entryFromRules")} dir="ltr" /></label>
              <label>{t("col_reward")}<input inputMode="decimal" value={sticky.reward} onChange={set("reward")} placeholder={t("entryFromRules")} dir="ltr" /></label>
            </div>
            {advancesEnabled && moneyAccounts.length > 0 && (
              <div className="grid2">
                <label>{t("col_advance")}<input inputMode="decimal" value={sticky.advance} onChange={set("advance")} placeholder="0" dir="ltr" /></label>
                <label>{t("entryAdvanceFrom")}<select value={sticky.account} onChange={set("account")}>{moneyAccounts.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}</select></label>
              </div>
            )}
          </div>
        </details>
      </div>

      <div className="entry-fields">
        <label>{t("col_driver")}<input ref={driverRef} list="el-drivers" value={truck.driver} onChange={(e) => onDriver(e.target.value)} autoComplete="off" required autoFocus /></label>
        <label>{t("col_plate")}<input value={truck.plate} onChange={(e) => setTruck({ ...truck, plate: e.target.value })} dir="ltr" autoComplete="off" required /></label>
        <label>{t("col_manifest")}<input value={truck.manifest} onChange={(e) => setTruck({ ...truck, manifest: e.target.value })} dir="ltr" autoComplete="off" required /></label>
        <label>{t("col_loadedQty")}<input value={truck.loaded} onChange={(e) => setTruck({ ...truck, loaded: e.target.value })} inputMode="decimal" dir="ltr" autoComplete="off" required /></label>
        <button type="submit" className="primary" disabled={pending}>{pending ? f("saving") : t("entrySave")}<kbd>↵</kbd></button>
        {state.approvalRequired && <button type="submit" name="__mode" value="approval" disabled={pending}>{f("sendForApproval")}</button>}
      </div>

      {state.error && (
        <div className="form-msg error" role="alert">
          <strong>{f.has(`error_${state.error.code}`) ? f(`error_${state.error.code}`) : f("error_generic")}</strong>
          <div>{state.error.message}</div>
          {!!state.error.issues?.length && <ul>{state.error.issues.map((i) => <li key={i.path}>{i.message}</li>)}</ul>}
        </div>
      )}
      {saved.length > 0 && (
        <div className="entry-saved" role="status">
          <Icon name="checkCircle" size={14} />
          {t("entrySaved", { count: saved.length })}: {saved.map((s) => `${s.manifest} (${s.driver})`).join(" · ")}
        </div>
      )}
    </form>
  );
}
