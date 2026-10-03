import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { currencies, currencyExchanges, moneyAccounts } from "@/db/schema";
import { defineCommand } from "@/server/command";
import { Conflict, NotFound, ValidationError } from "@/server/errors";
import { postEntry, reverseEntry } from "../accounting/ledger";
import { postingAccount } from "../accounting/posting";
import { amountString } from "../currency";
import { dec, toStr } from "../money";
import { nextNumber } from "../sequences";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Exchange money between two money accounts of different currencies.
 * Both amounts are what actually changed hands; the rate is derived from them.
 * Ledger: each currency balances on its own through the currency-exchange account.
 */
export const exchangeCurrency = defineCommand({
  name: "exchanges.create",
  permission: "exchanges.create",
  input: z.object({
    fromMoneyAccountId: uuid,
    toMoneyAccountId: uuid,
    fromAmount: amountString,
    toAmount: amountString,
    exchangeDate: isoDate,
    counterpartyId: uuid.nullish(),
    reference: z.string().nullish(),
  }),
  async handler(ctx, input) {
    const { tx, actor, audit } = ctx;
    const load = async (id: string) => {
      const [m] = await tx.select().from(moneyAccounts).where(and(eq(moneyAccounts.id, id), eq(moneyAccounts.companyId, actor.companyId)));
      if (!m?.active) throw new NotFound("money_account", id);
      return m;
    };
    const [from, to] = [await load(input.fromMoneyAccountId), await load(input.toMoneyAccountId)];
    if (from.currency === to.currency) throw new ValidationError("Both accounts hold the same currency; use a transfer instead");
    if (dec(input.fromAmount).lte(0) || dec(input.toAmount).lte(0)) throw new ValidationError("Amounts must be greater than zero");
    for (const [amt, cur] of [[input.fromAmount, from.currency], [input.toAmount, to.currency]] as const) {
      const [c] = await tx.select().from(currencies).where(eq(currencies.code, cur));
      if (dec(amt).decimalPlaces() > c.minorUnits) throw new ValidationError(`${cur} allows at most ${c.minorUnits} decimal places`);
    }
    const rate = dec(input.toAmount).dividedBy(dec(input.fromAmount)).toDecimalPlaces(10);
    const fx = await postingAccount(tx, actor.companyId, "currency_exchange");
    const exchangeNo = await nextNumber(tx, actor.companyId, "FX", Number(input.exchangeDate.slice(0, 4)));
    const entry = await postEntry(ctx, {
      entryDate: input.exchangeDate,
      description: `${exchangeNo} ${input.fromAmount} ${from.currency} → ${input.toAmount} ${to.currency} @ ${toStr(rate)}`,
      sourceType: "currency_exchange",
      sourceId: exchangeNo,
      lines: [
        { accountId: to.ledgerAccountId, currency: to.currency, debit: input.toAmount },
        { accountId: fx.id, currency: to.currency, credit: input.toAmount },
        { accountId: fx.id, currency: from.currency, debit: input.fromAmount },
        { accountId: from.ledgerAccountId, currency: from.currency, credit: input.fromAmount },
      ],
    });
    const [row] = await tx
      .insert(currencyExchanges)
      .values({
        companyId: actor.companyId,
        exchangeNo,
        fromMoneyAccountId: from.id,
        toMoneyAccountId: to.id,
        fromAmount: input.fromAmount,
        fromCurrency: from.currency,
        toAmount: input.toAmount,
        toCurrency: to.currency,
        rate: toStr(rate),
        exchangeDate: input.exchangeDate,
        counterpartyId: input.counterpartyId ?? null,
        reference: input.reference ?? null,
        journalEntryId: entry.id,
        createdBy: actor.userId,
      })
      .returning();
    await audit({ action: "exchanges.create", entityType: "currency_exchange", entityId: row.id, after: { exchangeNo, ...input, rate: toStr(rate) } });
    return { id: row.id, exchangeNo, rate: toStr(rate) };
  },
});

export const reverseExchange = defineCommand({
  name: "exchanges.reverse",
  permission: "payments.reverse",
  input: z.object({ exchangeId: uuid, reversalDate: isoDate, reason: z.string().min(1) }),
  async handler(ctx, { exchangeId, reversalDate, reason }) {
    const { tx, actor, audit } = ctx;
    const [x] = await tx.select().from(currencyExchanges).where(and(eq(currencyExchanges.id, exchangeId), eq(currencyExchanges.companyId, actor.companyId)));
    if (!x) throw new NotFound("currency_exchange", exchangeId);
    if (x.status === "reversed") throw new Conflict("Exchange is already reversed");
    const rev = await reverseEntry(ctx, x.journalEntryId, reversalDate, `${x.exchangeNo}: ${reason}`);
    await tx.update(currencyExchanges).set({ status: "reversed", reversalEntryId: rev.id }).where(eq(currencyExchanges.id, exchangeId));
    await audit({ action: "exchanges.reverse", entityType: "currency_exchange", entityId: exchangeId, before: { status: "posted" }, after: { status: "reversed" }, reason });
    return { exchangeId };
  },
});
