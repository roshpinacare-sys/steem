import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { recoverOnBoot } from "@/lib/db";
import { AppShell } from "@/components/shell/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Mark orphaned runs interrupted once per process lifetime.
  recoverOnBoot();

  const user = await getCurrentUser();
  const locale = await getLocale();
  if (!user) redirect({ href: "/login", locale });

  return (
    <AppShell
      user={{ name: user!.name, email: user!.email, role: user!.role }}
    >
      {children}
    </AppShell>
  );
}
