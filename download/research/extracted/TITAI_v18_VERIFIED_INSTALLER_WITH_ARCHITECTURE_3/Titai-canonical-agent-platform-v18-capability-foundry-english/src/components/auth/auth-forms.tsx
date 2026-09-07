"use client";

import * as React from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { Sparkles } from "lucide-react";

/** Gate interactive submit on client mount so a fast pre-hydration submit
 * can never native-GET the credentials into the URL. */
function useMounted() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return mounted;
}

function Brand() {
  const t = useTranslations();
  return (
    <div className="mb-6 flex flex-col items-center text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
        <Sparkles className="size-6" />
      </div>
      <span className="font-display text-xl font-bold tracking-tight">
        {t("app.name")}
      </span>
    </div>
  );
}

export function LoginForm() {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const mounted = useMounted();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const res = await signIn("credentials", {
      email: String(form.get("email")),
      password: String(form.get("password")),
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError(t("auth.invalidCredentials"));
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-border bg-surface/80 p-6 shadow-xl backdrop-blur">
      <Brand />
      <div className="mb-5 text-center">
        <h1 className="font-display text-lg font-semibold">
          {t("auth.signInTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("auth.signInSubtitle")}
        </p>
      </div>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div>
          <Label htmlFor="password">{t("auth.password")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading || !mounted}>
          {loading ? <Spinner /> : t("auth.signIn")}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        {t("auth.noAccount")}{" "}
        <a
          href={`/${locale === "en" ? "" : locale + "/"}register`}
          className="font-medium text-primary hover:underline"
        >
          {t("auth.registerLink")}
        </a>
      </p>
      <p className="mt-4 rounded-md border border-border bg-surface-raised px-3 py-2 text-center text-xs text-muted-foreground">
        {t("auth.demoHint")}
      </p>
    </div>
  );
}

export function RegisterForm() {
  const t = useTranslations();
  const router = useRouter();
  const locale = useLocale();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const mounted = useMounted();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const payload = {
      name: String(form.get("name")),
      email: String(form.get("email")),
      password: String(form.get("password")),
      locale,
    };
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      setLoading(false);
      const body = await res.json().catch(() => ({}));
      setError(
        body.error === "email_taken"
          ? t("auth.emailTaken")
          : t("errors.generic"),
      );
      return;
    }
    // Auto sign in.
    await signIn("credentials", {
      email: payload.email,
      password: payload.password,
      redirect: false,
    });
    setLoading(false);
    router.push("/");
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-border bg-surface/80 p-6 shadow-xl backdrop-blur">
      <Brand />
      <div className="mb-5 text-center">
        <h1 className="font-display text-lg font-semibold">
          {t("auth.registerTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("auth.registerSubtitle")}
        </p>
      </div>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <Label htmlFor="name">{t("auth.name")}</Label>
          <Input id="name" name="name" required autoComplete="name" />
        </div>
        <div>
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div>
          <Label htmlFor="password">{t("auth.password")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading || !mounted}>
          {loading ? <Spinner /> : t("auth.register")}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        {t("auth.haveAccount")}{" "}
        <a
          href={`/${locale === "en" ? "" : locale + "/"}login`}
          className="font-medium text-primary hover:underline"
        >
          {t("auth.signInLink")}
        </a>
      </p>
    </div>
  );
}
