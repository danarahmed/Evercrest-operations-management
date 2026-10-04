import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { Geist_Mono, Inter, Noto_Sans_Arabic } from "next/font/google";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { RTL_LOCALES, routing, type Locale } from "@/i18n/routing";
import "../globals.css";

// Latin text in Inter; Arabic and Kurdish (Sorani) in Noto Sans Arabic. Served from our own site at build time.
const latin = Inter({ subsets: ["latin"], variable: "--font-latin", display: "swap" });
// Figures (amounts, quantities, document numbers) in a monospace face so columns line up.
const code = Geist_Mono({ subsets: ["latin"], variable: "--font-code", display: "swap" });
const arabic = Noto_Sans_Arabic({ subsets: ["arabic"], variable: "--font-arabic", display: "swap", weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = { title: "Evercrest Operations" };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <html lang={locale} dir={RTL_LOCALES.includes(locale as Locale) ? "rtl" : "ltr"} className={`${latin.variable} ${arabic.variable} ${code.variable}`}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
