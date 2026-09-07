/**
 * lib/auth — barrel export.
 * Services import from here; never from individual files directly.
 *
 * @example
 * ```ts
 * import { CryptoProvider, defaultCryptoProvider } from "../../lib/auth/index.ts";
 * ```
 */
export type { JwtPayload, JwtOptions, VerifyResult } from "./jwt.ts";
export { signJwt, verifyJwt, decodeJwt } from "./jwt.ts";

export type { IdpClaims, MintTfaSsoTokenOptions, IdpExchangeFailReason } from "./idp-exchange.ts";
export { mintTfaSsoToken, IdpExchangeError } from "./idp-exchange.ts";

export { hashPassword, verifyPassword } from "./password.ts";

export { generateSecret, generateTotp, verifyTotp, totpUri } from "./totp.ts";

export type {
  CryptoProvider,
  CryptoProviderConfig,
  JwtProvider,
  PasswordProvider,
  TotpProvider,
} from "./crypto-provider.ts";
export { defaultCryptoProvider, testCryptoProvider } from "./crypto-provider.ts";
