import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    // Owner decision: Western digits (0-9) in every language, also for numbers inside translated
    // sentences. The Unicode extension only changes digits; words and plural rules stay the language's.
    locale: `${locale}-u-nu-latn`,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
