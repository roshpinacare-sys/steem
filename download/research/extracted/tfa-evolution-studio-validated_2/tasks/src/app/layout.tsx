import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TFA Evolution Studio",
  description: "TFA Evolution Studio v32.0.0 — Autonomous Software Engineering Platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
