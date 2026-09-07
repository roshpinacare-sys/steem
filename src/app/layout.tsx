import type { Metadata, Viewport } from "next";
import { Frank_Ruhl_Libre, Heebo, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const franklin = Frank_Ruhl_Libre({
  variable: "--font-franklin",
  subsets: ["hebrew", "latin"],
  weight: ["300", "400", "500", "700", "900"],
});

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
  weight: ["300", "400", "500", "700", "800"],
});

const jet = JetBrains_Mono({
  variable: "--font-jet",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "הנול · רשת-האמת הציבורית — SAOS-NET",
  description:
    "THE WEAVE — רשת-אמת ציבורית ריבונית: חותמת קיום על כל דבר, אריגה שעתית לשורש-מרקל, איטום מתמטי על הספר הריבוני, ועיגון ציבורי על Steem · Hive · TRON · Blurt.",
  keywords: ["SAOS-NET", "THE WEAVE", "רשת-אמת", "חותמות-קיום", "מרקל", "Steem", "Hive", "TRON", "Blurt"],
  authors: [{ name: "SAOS — headcorner" }],
  icons: { icon: "/weave-mark.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0a0907",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <body
        className={`${franklin.variable} ${heebo.variable} ${jet.variable} font-sans antialiased bg-background text-foreground min-h-screen flex flex-col`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
