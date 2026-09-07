// @tfa/passport-client — standalone, zero-dependency Action Passport verifier.
// Re-exports the canonical verifier so external parties verify TFA passports with no kernel access.
export { verifyPassport, canonicalStringify } from "./verify-passport.mjs";
