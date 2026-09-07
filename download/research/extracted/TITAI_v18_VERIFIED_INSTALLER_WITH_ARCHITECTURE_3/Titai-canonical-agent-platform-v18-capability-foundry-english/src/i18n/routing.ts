import { defineRouting } from "next-intl/routing";

export const locales = ["en"] as const;
export type Locale = (typeof locales)[number];

export function isRtl(_locale: string): boolean {
  return false;
}

export const routing = defineRouting({
  locales,
  defaultLocale: "en",
  localePrefix: "never",
});
