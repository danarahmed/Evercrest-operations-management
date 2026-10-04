import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/** Building blocks shared by every screen. Server components: no client JavaScript. */

export function PageHeader({ title, subtitle, eyebrow, actions, back }: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="page-head">
      <div>
        {back && <Link href={back.href} className="back-link no-print"><Icon name="arrowLeft" size={15} />{back.label}</Link>}
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <div className="subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, icon, actions, children, flush, footer, className, id }: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  actions?: ReactNode;
  children?: ReactNode;
  /** No inner padding (for tables and lists that run edge to edge). */
  flush?: boolean;
  footer?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`card${flush ? " flush" : ""}${className ? ` ${className}` : ""}`} id={id}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <div className="card-title">{icon && <Icon name={icon} />}{title}</div>}
            {subtitle && <div className="card-sub">{subtitle}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className="card-body">{children}</div>
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  );
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent" | "violet";

export function Badge({ tone = "neutral", children, plain }: { tone?: Tone; children: ReactNode; plain?: boolean }) {
  return <span className={`badge ${tone === "neutral" ? "" : tone}${plain ? " plain" : ""}`}>{children}</span>;
}

/** One colour language for statuses across the system. */
const TONES: Record<string, Tone> = {
  // jobs
  draft: "neutral", open: "info", in_progress: "accent", pending: "warning", completed: "success", financially_closed: "violet", cancelled: "neutral",
  // trips
  planned: "neutral", loaded: "accent", discharged: "success",
  // documents
  verified: "success", awaiting_verification: "warning", missing: "danger", rejected: "danger", expired: "danger", received: "warning",
  // money
  posted: "success", reversed: "neutral", paid: "success", nothing: "neutral",
  // approvals
  approved: "success", failed: "danger",
  // contracts
  active: "success", ended: "neutral",
};
export function StatusBadge({ status, label }: { status: string; label: ReactNode }) {
  return <Badge tone={TONES[status] ?? "neutral"}>{label}</Badge>;
}

export function Stat({ label, value, icon, tone, href, hint }: { label: ReactNode; value: ReactNode; icon: IconName; tone?: "success" | "warning" | "danger" | "violet"; href?: string; hint?: ReactNode }) {
  const body = (
    <>
      <div className={`stat-icon${tone ? ` ${tone}` : ""}`}><Icon name={icon} size={20} /></div>
      <div style={{ minWidth: 0 }}>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {hint && <div className="small muted">{hint}</div>}
      </div>
    </>
  );
  return href ? <Link href={href} className="stat">{body}</Link> : <div className="stat">{body}</div>;
}

export function EmptyState({ icon = "layers", title, hint, action }: { icon?: IconName; title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <div className="empty-title">{title}</div>
      {hint && <div className="small">{hint}</div>}
      {action && <div style={{ marginBlockStart: 12 }}>{action}</div>}
    </div>
  );
}

export function Tabs({ items, active }: { items: { key: string; label: ReactNode; href: string; count?: number; icon?: IconName }[]; active: string }) {
  return (
    <nav className="tabs no-print">
      {items.map((t) => (
        <Link key={t.key} href={t.href} className={t.key === active ? "active" : ""} scroll={false}>
          {t.icon && <Icon name={t.icon} size={16} />}
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="tab-count">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** Labelled values, e.g. the facts of a job. */
export function Facts({ items, cols }: { items: [ReactNode, ReactNode][]; cols?: boolean }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== false && v !== "");
  if (cols)
    return (
      <dl className="kv cols">
        {shown.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
    );
  return <dl className="kv">{shown.map(([k, v], i) => <Fragment key={i}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>;
}

/** Several amounts in different currencies, one per line, never added together. */
export function Amounts({ values, format }: { values: Record<string, string>; format: (amount: string, currency: string) => string }) {
  const entries = Object.entries(values).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return <>—</>;
  return <>{entries.map(([c, a]) => <span key={c} className="line">{format(a, c)}</span>)}</>;
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
