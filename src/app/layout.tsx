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
  title: "SAOS-NET COMMAND II · מרכז-ההפעלה-הריבוני",
  description:
    "מרכז-הפעלה-חי לרשת-האמת הריבונית: סייר-הספר (66k+ בלוקים) · בודק-המגן-החי · דלתות-עם-יתרות-רשת · רכבת-ההפקדות · כלכלת-הגריד · מציג-לוגים — הכל-נמדד-חי, אפס-סימולציה.",
  keywords: ["SAOS-NET", "COMMAND II", "מרכז-הפעלה", "TRON", "explorer", "shield-scanner", "relay-doors", "deposits", "ריבונות"],
  authors: [{ name: "SAOS — headcorner" }],
  icons: { icon: "/weave-mark.svg" },
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
