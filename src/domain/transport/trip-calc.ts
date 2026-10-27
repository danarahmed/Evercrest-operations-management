import { D, type Dec, dec, toStr } from "../money";

/**
 * Pure calculation of one trip from its job's rule card. Reproduces the owner's
 * working sheet (docs/business/example-diesel-syria.md) with the two corrections
 * he accepted: the deduction for the transporter is a company cost, and the
 * border commission is part of the load cost.
 *
 * Until the trip is discharged the result is an estimate: net = loaded, no
 * shortage. Nothing here touches the books (accounting method D): the books
 * record only real events; this is the live view.
 */

export interface TermsForCalc {
  id: string;
  currency: string;
  unit: string;
  customerPrice: string | null;
  customerPriceBasis: "per_unit" | "per_trip";
  customerQtyBasis: "net" | "loaded";
  customerAllowance: string | null;
  customerAllowanceBasis: "per_trip" | "per_unit";
  customerFinePrice: string | null;
  carrierPrice: string | null;
  carrierPriceBasis: "per_unit" | "per_trip";
  rewardPerTrip: string;
  transporterCommission: string;
  carrierAllowance: string;
  carrierFinePrice: string;
  demurrageMethod: "none" | "arrival_to_discharge";
  demurrageFreeDays: number;
  carrierDemurrageRate: string;
  customerDemurrageRate: string;
  advanceMax: string | null;
}

export interface FeeForCalc {
  feeTypeId: string;
  name: string;
  rate: string;
  basis: "per_trip" | "per_loaded_unit" | "per_net_unit";
  currency: string;
  deductFromCarrier: boolean;
  billedToCustomer: boolean;
}

export interface TripForCalc {
  loadedQty: string | null;
  dischargedQty: string | null;
  arrivalDate: string | null;
  dischargeDate: string | null;
  carrierPriceOverride: string | null;
  rewardOverride: string | null;
  transporterCut: string;
  carrierDeduction: string;
  /** Advances already paid on this trip, per currency. */
  advances: Record<string, string>;
}

export interface FeeLine {
  feeTypeId: string;
  name: string;
  amount: string;
  currency: string;
  deductFromCarrier: boolean;
  billedToCustomer: boolean;
}

export interface TripCalc {
  state: "estimated" | "confirmed";
  currency: string;
  unit: string;
  loaded: string;
  discharged: string | null;
  net: string;
  /** Discharged − loaded (negative = loss); 0 while estimated. */
  shortage: string;
  carrier: {
    price: string | null;
    freight: string;
    reward: string;
    commission: string;
    fineQty: string;
    fine: string;
    demurrageDays: number;
    demurrage: string;
    feeDeductions: string;
    otherDeduction: string;
    transporterCut: string;
    /** What the carrier earned on this trip (before the advance). */
    total: string;
    advance: string;
    /** Still to pay (negative = the carrier owes us). */
    toPay: string;
  };
  fees: FeeLine[];
  /** All fees in the job currency that the company pays on this trip. */
  feesTotal: string;
  /** Company cost of the trip: carrier total + transporter cut + fees. */
  cost: string;
  customer: {
    price: string | null;
    qty: string;
    revenue: string | null;
    fineQty: string;
    fine: string;
    demurrage: string;
    billedFees: string;
    total: string | null;
  };
  /** Customer total − cost (null while the customer price is to be decided). */
  margin: string | null;
  /** Rules that differ from the rule card or are missing. */
  flags: string[];
}

const r2 = (x: Dec) => x.toDecimalPlaces(2);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

/** Quantity beyond the allowance (≤ 0): (shortage + allowance) when the shortage exceeds it, else 0. */
function beyondAllowance(shortage: Dec, allowance: Dec): Dec {
  const s = shortage.toDecimalPlaces(3);
  return s.lt(allowance.negated()) ? s.plus(allowance) : new D(0);
}

/**
 * Demurrage days, method "arrival_to_discharge": the days between arrival and
 * discharge, both excluded, minus the free days (owner's rule, part 4).
 */
export function demurrageDays(method: TermsForCalc["demurrageMethod"], arrival: string | null, discharge: string | null, freeDays: number): number {
  if (method !== "arrival_to_discharge" || !arrival || !discharge) return 0;
  return Math.max(daysBetween(arrival, discharge) - 1 - freeDays, 0);
}

export function calculateTrip(trip: TripForCalc, terms: TermsForCalc, fees: FeeForCalc[]): TripCalc {
  const flags: string[] = [];
  const loaded = dec(trip.loadedQty ?? "0");
  if (trip.loadedQty === null) flags.push("loaded_missing");
  const discharged = trip.dischargedQty === null ? null : dec(trip.dischargedQty);
  const confirmed = discharged !== null;
  const net = confirmed ? D.min(loaded, discharged) : loaded;
  const shortage = confirmed ? discharged.minus(loaded) : new D(0);

  // Carrier side
  const price = trip.carrierPriceOverride ?? terms.carrierPrice;
  if (price === null) flags.push("carrier_price_missing");
  if (trip.carrierPriceOverride !== null && terms.carrierPrice !== null && !dec(trip.carrierPriceOverride).eq(dec(terms.carrierPrice))) flags.push("carrier_price_differs");
  const freight = price === null ? new D(0) : terms.carrierPriceBasis === "per_trip" ? dec(price) : r2(net.times(dec(price)));
  const reward = dec(trip.rewardOverride ?? terms.rewardPerTrip);
  if (trip.rewardOverride !== null && !dec(trip.rewardOverride).eq(dec(terms.rewardPerTrip))) flags.push("reward_differs");
  const commission = r2(net.times(dec(terms.transporterCommission)));
  const fineQty = beyondAllowance(shortage, dec(terms.carrierAllowance));
  const fine = r2(fineQty.times(dec(terms.carrierFinePrice)));
  const days = demurrageDays(terms.demurrageMethod, trip.arrivalDate, trip.dischargeDate, terms.demurrageFreeDays);
  if (terms.demurrageMethod !== "none" && confirmed && !trip.arrivalDate) flags.push("arrival_missing");
  const carrierDemurrage = new D(days).times(dec(terms.carrierDemurrageRate));

  const feeLines: FeeLine[] = fees.map((f) => {
    const qty = f.basis === "per_trip" ? new D(1) : f.basis === "per_loaded_unit" ? loaded : net;
    return { feeTypeId: f.feeTypeId, name: f.name, amount: toStr(r2(qty.times(dec(f.rate)))), currency: f.currency, deductFromCarrier: f.deductFromCarrier, billedToCustomer: f.billedToCustomer };
  });
  const inCurrency = feeLines.filter((f) => f.currency === terms.currency);
  if (inCurrency.length !== feeLines.length) flags.push("fee_other_currency");
  const sum = (xs: FeeLine[]) => xs.reduce((a, f) => a.plus(dec(f.amount)), new D(0));
  const feesTotal = sum(inCurrency);
  const feeDeductions = sum(inCurrency.filter((f) => f.deductFromCarrier));
  const billedFees = sum(inCurrency.filter((f) => f.billedToCustomer));

  const transporterCut = dec(trip.transporterCut);
  const otherDeduction = dec(trip.carrierDeduction);
  const carrierTotal = freight.plus(reward).plus(commission).plus(fine).plus(carrierDemurrage).minus(feeDeductions).minus(otherDeduction).minus(transporterCut);
  const advance = dec(trip.advances[terms.currency] ?? "0");
  if (Object.keys(trip.advances).some((c) => c !== terms.currency && !dec(trip.advances[c]).isZero())) flags.push("advance_other_currency");
  if (terms.advanceMax !== null && advance.gt(dec(terms.advanceMax))) flags.push("advance_above_max");
  const cost = carrierTotal.plus(transporterCut).plus(feesTotal);

  // Customer side
  const custQty = terms.customerQtyBasis === "loaded" ? loaded : net;
  let revenue: Dec | null = null;
  if (terms.customerPrice === null) flags.push("customer_price_tbd");
  else revenue = terms.customerPriceBasis === "per_trip" ? dec(terms.customerPrice) : r2(custQty.times(dec(terms.customerPrice)));
  const custAllowance = terms.customerAllowance === null ? null : terms.customerAllowanceBasis === "per_unit" ? loaded.times(dec(terms.customerAllowance)) : dec(terms.customerAllowance);
  const custFineQty = custAllowance === null || terms.customerFinePrice === null ? new D(0) : beyondAllowance(shortage, custAllowance);
  const custFine = terms.customerFinePrice === null ? new D(0) : r2(custFineQty.times(dec(terms.customerFinePrice)));
  const custDemurrage = new D(days).times(dec(terms.customerDemurrageRate));
  const customerTotal = revenue === null ? null : revenue.plus(custFine).plus(custDemurrage).plus(billedFees);

  return {
    state: confirmed ? "confirmed" : "estimated",
    currency: terms.currency,
    unit: terms.unit,
    loaded: toStr(loaded),
    discharged: discharged === null ? null : toStr(discharged),
    net: toStr(net),
    shortage: toStr(shortage),
    carrier: {
      price,
      freight: toStr(freight),
      reward: toStr(reward),
      commission: toStr(commission),
      fineQty: toStr(fineQty),
      fine: toStr(fine),
      demurrageDays: days,
      demurrage: toStr(carrierDemurrage),
      feeDeductions: toStr(feeDeductions),
      otherDeduction: toStr(otherDeduction),
      transporterCut: toStr(transporterCut),
      total: toStr(carrierTotal),
      advance: toStr(advance),
      toPay: toStr(carrierTotal.minus(advance)),
    },
    fees: feeLines,
    feesTotal: toStr(feesTotal),
    cost: toStr(cost),
    customer: {
      price: terms.customerPrice,
      qty: toStr(custQty),
      revenue: revenue === null ? null : toStr(revenue),
      fineQty: toStr(custFineQty),
      fine: toStr(custFine),
      demurrage: toStr(custDemurrage),
      billedFees: toStr(billedFees),
      total: customerTotal === null ? null : toStr(customerTotal),
    },
    margin: customerTotal === null ? null : toStr(customerTotal.minus(cost)),
    flags,
  };
}

/** Sum a field over many trip results (all in one currency). */
export function sumCalcs(calcs: TripCalc[], pick: (c: TripCalc) => string | null): string {
  return toStr(calcs.reduce((a, c) => a.plus(dec(pick(c) ?? "0")), new D(0)));
}
