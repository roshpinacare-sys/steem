"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { TriangleAlert, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations();
  React.useEffect(() => {
    console.error("[titai] route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-danger/12 text-danger">
        <TriangleAlert className="size-7" />
      </div>
      <div>
        <h1 className="font-display text-lg font-semibold">
          {t("errors.generic")}
        </h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {error.message || t("errors.generic")}
        </p>
      </div>
      <Button onClick={reset}>
        <RotateCw className="size-4" />
        {t("common.retry")}
      </Button>
    </div>
  );
}
