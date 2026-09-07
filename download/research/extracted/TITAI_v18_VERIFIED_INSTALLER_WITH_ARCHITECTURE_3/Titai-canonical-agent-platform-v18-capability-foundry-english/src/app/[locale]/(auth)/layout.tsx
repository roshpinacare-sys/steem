import { auth } from "@/auth";
import { redirect } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const locale = await getLocale();
  if (session?.user) redirect({ href: "/", locale });

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(60rem 60rem at 20% -10%, color-mix(in oklch, var(--color-primary) 14%, transparent), transparent), radial-gradient(50rem 50rem at 90% 110%, color-mix(in oklch, var(--color-tier-executive) 12%, transparent), transparent)",
        }}
      />
      <div className="relative w-full max-w-sm">{children}</div>
    </div>
  );
}
