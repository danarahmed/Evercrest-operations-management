import { and, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { businessPartners, payments, payStatementItems, payStatements, statementDebtWriteOffs } from "@/db/schema";
import type { StatementParty } from "@/db/schema/statements";
import { D, dec, toStr } from "../money";

/**
 * When a payee's total on a statement is below zero (advances larger than pay),
 * the payee owes the company that amount. The debt is cleared by:
 *  - being brought forward onto the payee's next statement (deducted from later pay),
 *  - money the payee pays back (a receipt against the statement), or
 *  - an approved write-off.
 * Open = owed − brought forward − repaid − written off. Nothing is stored twice:
 * the debt is derived from the statement items, receipts and write-offs.
 */
export interface StatementDebt {
  statementId: string;
  statementNo: string;
  statementDate: string;
  party: StatementParty;
  currency: string;
  partnerId: string;
  name: string;
  owed: string;
  carried: string;
  repaid: string;
  writtenOff: string;
  open: string;
  /** Live statement the debt is currently deducted on, if any. */
  carriedTo: { id: string; no: string } | null;
}

export async function statementDebts(
  db: Db,
  companyId: string,
  filter: { party?: StatementParty; partnerId?: string; currency?: string; statementId?: string } = {},
): Promise<StatementDebt[]> {
  const conds: SQL[] = [eq(payStatements.companyId, companyId), ne(payStatements.status, "cancelled"), eq(payStatementItems.active, true)];
  if (filter.party) conds.push(eq(payStatements.party, filter.party));
  if (filter.partnerId) conds.push(eq(payStatementItems.partnerId, filter.partnerId));
  if (filter.currency) conds.push(eq(payStatements.currency, filter.currency));
  if (filter.statementId) conds.push(eq(payStatements.id, filter.statementId));
  const owedRows = await db
    .select({
      statementId: payStatements.id,
      statementNo: payStatements.statementNo,
      statementDate: payStatements.statementDate,
      party: payStatements.party,
      currency: payStatements.currency,
      partnerId: payStatementItems.partnerId,
      name: businessPartners.name,
      total: sql<string>`sum(${payStatementItems.amount})`,
    })
    .from(payStatementItems)
    .innerJoin(payStatements, eq(payStatements.id, payStatementItems.statementId))
    .innerJoin(businessPartners, eq(businessPartners.id, payStatementItems.partnerId))
    .where(and(...conds))
    .groupBy(payStatements.id, payStatementItems.partnerId, businessPartners.name)
    .having(sql`sum(${payStatementItems.amount}) < 0`)
    .orderBy(payStatements.statementDate, businessPartners.name);
  if (!owedRows.length) return [];

  const ids = [...new Set(owedRows.map((r) => r.statementId))];
  const key = (s: string, p: string) => `${s}:${p}`;
  const carriedRows = await db
    .select({ from: payStatementItems.fromStatementId, partnerId: payStatementItems.partnerId, amount: payStatementItems.amount, toId: payStatements.id, toNo: payStatements.statementNo })
    .from(payStatementItems)
    .innerJoin(payStatements, eq(payStatements.id, payStatementItems.statementId))
    .where(and(inArray(payStatementItems.fromStatementId, ids), eq(payStatementItems.kind, "brought_forward"), eq(payStatementItems.active, true)));
  const repaidRows = await db
    .select({ statementId: payments.statementId, partnerId: payments.partnerId, total: sql<string>`sum(${payments.amount})` })
    .from(payments)
    .where(and(inArray(payments.statementId, ids), eq(payments.direction, "in"), eq(payments.status, "posted")))
    .groupBy(payments.statementId, payments.partnerId);
  const writeOffRows = await db
    .select({ statementId: statementDebtWriteOffs.statementId, partnerId: statementDebtWriteOffs.partnerId, total: sql<string>`sum(${statementDebtWriteOffs.amount})` })
    .from(statementDebtWriteOffs)
    .where(inArray(statementDebtWriteOffs.statementId, ids))
    .groupBy(statementDebtWriteOffs.statementId, statementDebtWriteOffs.partnerId);

  return owedRows.map((r) => {
    const k = key(r.statementId, r.partnerId);
    const carriedRow = carriedRows.find((c) => key(c.from!, c.partnerId) === k);
    const carried = carriedRow ? dec(carriedRow.amount).neg() : new D(0);
    const repaid = dec(repaidRows.find((x) => key(x.statementId!, x.partnerId!) === k)?.total ?? "0");
    const writtenOff = dec(writeOffRows.find((x) => key(x.statementId, x.partnerId) === k)?.total ?? "0");
    const owed = dec(r.total).neg();
    return {
      statementId: r.statementId,
      statementNo: r.statementNo,
      statementDate: r.statementDate,
      party: r.party,
      currency: r.currency,
      partnerId: r.partnerId,
      name: r.name,
      owed: toStr(owed),
      carried: toStr(carried),
      repaid: toStr(repaid),
      writtenOff: toStr(writtenOff),
      open: toStr(D.max(owed.minus(carried).minus(repaid).minus(writtenOff), 0)),
      carriedTo: carriedRow ? { id: carriedRow.toId, no: carriedRow.toNo } : null,
    };
  });
}

/** Open (not yet cleared) amount a payee owes on one statement. */
export async function openDebt(db: Db, companyId: string, statementId: string, partnerId: string) {
  const [d] = await statementDebts(db, companyId, { statementId, partnerId });
  return d ? dec(d.open) : new D(0);
}
