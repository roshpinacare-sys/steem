import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="font-display text-6xl font-bold text-primary">404</p>
      <p className="text-muted-foreground">{t("errors.notFound")}</p>
      <Link
        href="/"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
      >
        {t("nav.missions")}
      </Link>
    </div>
  );
}
