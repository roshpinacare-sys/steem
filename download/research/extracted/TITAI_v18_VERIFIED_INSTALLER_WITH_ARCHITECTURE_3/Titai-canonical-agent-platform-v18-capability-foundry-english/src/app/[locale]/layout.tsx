import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { routing, isRtl } from "@/i18n/routing";
import { Providers } from "@/components/providers";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const dir = isRtl(locale) ? "rtl" : "ltr";

  return (
    <html
      lang={locale}
      dir={dir}
      suppressHydrationWarning
    >
      <head>
        <script
          // Apply persisted theme before paint to avoid a flash.
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('titai-theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t}}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
