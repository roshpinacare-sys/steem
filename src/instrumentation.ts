/**
 * T-10 · Next.js instrumentation hook: נקודת-העלייה של הריבונות.
 * נרשם פעם-אחת כששרת-Next עולה (dev וגם production), ללא כל הפעלה-אנושית.
 * ה-SovereignCore מתחיל לדאוג לעצמו: watchdog, מחזורים אוטומטיים, selftests.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureSovereign } = await import("./lib/sovereign");
    ensureSovereign("instrumentation");
  }
}
