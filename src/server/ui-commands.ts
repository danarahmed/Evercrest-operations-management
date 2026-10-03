import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { moneyAccounts } from "@/db/schema";
import { decideApproval } from "@/domain/approvals/approvals";
import { defineDocumentType, recordDocument, reviewDocument } from "@/domain/documents/documents";
import { recordPayment } from "@/domain/finance/payments";
import { changeJobStatus, createJob } from "@/domain/jobs/commands";
import { createPartner } from "@/domain/masterdata/partners";
import { cancelTrip, createTrip, recordDischarge, recordLoading } from "@/domain/transport/trips";
import type { Actor } from "./authz";
import type { Command } from "./command";

type Prepare = (db: Db, actor: Actor, input: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** Pay from a money account: the currency always comes from the account, never typed by hand. */
const currencyFromMoneyAccount: Prepare = async (db, actor, input) => {
  const [m] = await db
    .select({ currency: moneyAccounts.currency })
    .from(moneyAccounts)
    .where(and(eq(moneyAccounts.id, String(input.moneyAccountId ?? "")), eq(moneyAccounts.companyId, actor.companyId)));
  return { ...input, currency: m?.currency };
};

/** Commands that screens may submit. Anything not listed here cannot be called from a form. */
export const UI_COMMANDS: Record<string, { command: Command<any, any>; prepare?: Prepare }> = {
  "jobs.create": { command: createJob },
  "jobs.change_status": { command: changeJobStatus },
  "partners.create": { command: createPartner },
  "trips.create": { command: createTrip },
  "trips.record_loading": { command: recordLoading },
  "trips.record_discharge": { command: recordDischarge },
  "trips.cancel": { command: cancelTrip },
  "payments.record": { command: recordPayment, prepare: currencyFromMoneyAccount },
  "documents.record": { command: recordDocument },
  "documents.review": { command: reviewDocument },
  "documents.define_type": { command: defineDocumentType },
  "approvals.decide": { command: decideApproval },
};
