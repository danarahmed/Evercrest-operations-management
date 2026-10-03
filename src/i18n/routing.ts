import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({ locales: ["en", "ar", "ckb"], defaultLocale: "en" });
export type Locale = (typeof routing.locales)[number];
export const RTL_LOCALES: readonly Locale[] = ["ar", "ckb"];
