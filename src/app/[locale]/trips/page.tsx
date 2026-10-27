import { eq } from "drizzle-orm";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { PageHeader } from "@/components/ui";
import { parseTripFilters } from "@/lib/trip-filters";
import { formOptions, jobTripsLive } from "@/server/queries";
import { currentActor } from "@/server/session";
import { Shell } from "../shell";
import { TripsSection } from "../jobs/[id]/trips";

export const dynamic = "force-dynamic";

/** Every trip of every job, with the same spreadsheet-like filters as a job's Trips tab: find any manifest from anywhere. */
export default async function TripsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const actor = await currentActor(locale);
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId));
  const t = await getTranslations({ locale, namespace: "Trips" });
  const sp = await searchParams;
  const filters = parseTripFilters(sp, null);
  const [view, options] = await Promise.all([jobTripsLive(db, actor, filters), formOptions(db, actor)]);
  return (
    <Shell permissions={actor.permissions} locale={locale} userName={user.displayName} path="/trips">
      <PageHeader title={t("allTitle")} subtitle={t("allSubtitle")} />
      <TripsSection locale={locale} basePath={`/${locale}/trips`} baseParams={{}} view={view} filters={filters} jobId={null} showJob canImport={false} moneyAccounts={options.moneyAccounts} advancesEnabled={false} />
    </Shell>
  );
}
