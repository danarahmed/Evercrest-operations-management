import Decimal from "decimal.js";

/** Decimal configured for money: plenty of precision, banker-neutral half-up rounding. */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

export type CurrencyCode = string;
export interface Money {
  amount: string;
  currency: CurrencyCode;
}

const AMOUNT_RE = /^-?\d+(\.\d+)?$/;

/** Parse a user/DB amount. Rejects floats-as-numbers, NaN, exponent forms. */
export function dec(value: string | Dec): Dec {
  if (typeof value === "string") {
    if (!AMOUNT_RE.test(value)) throw new Error(`invalid amount: ${value}`);
    return new D(value);
  }
  return value;
}

export function decimalPlaces(value: string | Dec): number {
  return dec(value).decimalPlaces();
}

/** Round to the currency's minor units. */
export function roundTo(value: Dec, minorUnits: number): Dec {
  return value.toDecimalPlaces(minorUnits);
}

/** Convert using an explicit rate (1 unit of source = rate units of target), rounded to target units. */
export function convert(amount: string | Dec, rate: string | Dec, targetMinorUnits: number): Dec {
  return roundTo(dec(amount).times(dec(rate)), targetMinorUnits);
}

/** Canonical string for storage/comparison (no trailing zeros, no exponent). */
export function toStr(value: Dec): string {
  return value.toFixed();
}
