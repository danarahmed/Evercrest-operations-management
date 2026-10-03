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

/**
 * Round to the nearest multiple of `increment` (half up), e.g. IQD to 250:
 * 1,234,566 → 1,234,500; 1,234,625 → 1,234,750.
 */
export function roundToIncrement(value: Dec, increment: string | Dec): Dec {
  const inc = dec(increment);
  if (inc.lte(0)) return value;
  return value.dividedBy(inc).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).times(inc);
}
