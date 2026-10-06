"use client";

import { TruthLabel } from "./shared";

export function AppFooter() {
  return (
    <footer className="mt-auto border-t bg-muted/30">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-3 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:pb-4">
        <p className="text-center text-xs leading-relaxed text-muted-foreground sm:text-start">
          THE WEAVE v2 · אימות מחדש, לא סמיכות · רשת חיה, מוח ריבוני, אפס עלות ·
          סודות לעולם לא עולים לשרשרת
        </p>
        <div className="flex items-center gap-2" dir="ltr">
          <TruthLabel kind="REAL" compact />
          <TruthLabel kind="LOCAL" compact />
          <TruthLabel kind="NOT-YET" compact />
        </div>
      </div>
    </footer>
  );
}
