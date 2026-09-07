import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// next-intl owns the middleware. Auth is enforced in the (app) layout via
// `await auth()`, not here — this avoids the well-known Auth.js v5 beta +
// next-intl middleware composition pitfalls.
export default createMiddleware(routing);

export const config = {
  // Match all pathnames except API, static assets, and files with an extension.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
