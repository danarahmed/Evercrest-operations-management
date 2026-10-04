/**
 * Locale tag for Intl formatters. Owner decision: all languages show Western digits (0-9),
 * while words, month names and right-to-left layout follow the user's language.
 */
export function intlLocale(locale: string): string {
  return `${locale}-u-nu-latn`;
}

const RTL = new Set(["ar", "ckb"]);

/**
 * In Arabic and Kurdish an amount is wrapped in Unicode first-strong isolates so
 * it keeps its own direction inside right-to-left text ("US$ 200", not "$US 200").
 */
function isolate(text: string, locale: string) {
  return RTL.has(locale) ? `\u2068${text}\u2069` : text;
}

/** Display an exact decimal amount with its currency, in the user's language. Never converts. */
export function formatMoney(amount: string, currency: string, locale: string): string {
  const fractionDigits = (amount.split(".")[1] ?? "").length;
  try {
    return isolate(new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: Math.min(fractionDigits, 3) }).format(Number(amount)), locale);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function formatQty(qty: string, unit: string, locale: string): string {
  return isolate(`${new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 4 }).format(Number(qty))} ${unit}`, locale);
}

type Translate = { (key: string, values?: Record<string, string>): string; has(key: string): boolean };

/**
 * Translate a domain code (next action, exception) with its params. Amount params
 * are formatted with their currency. Falls back to the English text if the code
 * has no translation yet.
 */
export function describe(t: Translate, code: string, params: Record<string, string>, fallback: string, locale: string): string {
  // Message keys use "_" because "." means nesting in the message catalog.
  const key = code.replace(/\./g, "_");
  if (!t.has(key)) return fallback;
  const values = { ...params };
  if (values.currency)
    for (const k of ["amount", "costs", "budget"]) if (values[k]) values[k] = formatMoney(values[k], values.currency, locale);
  // Unicode isolation keeps codes, dates and numbers intact inside right-to-left sentences.
  for (const k of Object.keys(values)) values[k] = `\u2068${values[k]}\u2069`;
  return t(key, values);
}
