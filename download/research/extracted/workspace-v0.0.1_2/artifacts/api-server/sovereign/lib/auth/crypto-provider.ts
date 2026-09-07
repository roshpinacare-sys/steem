/**
 * CryptoProvider — unified DI interface for all sovereign crypto operations.
 *
 * Every service in TFA that touches JWT / password / TOTP must receive this
 * interface via constructor injection — never import jose/bcrypt/otplib directly.
 *
 * Default implementation (`defaultCryptoProvider`) uses the three sovereign
 * adapters: lib/auth/jwt.ts, lib/auth/password.ts, lib/auth/totp.ts.
 *
 * Swap the implementation in tests by passing a stub; in production the DI
 * container binds `defaultCryptoProvider(config)` as a singleton.
 */

import { signJwt, verifyJwt, decodeJwt } from "./jwt.ts";
import type { JwtPayload, JwtOptions, VerifyResult } from "./jwt.ts";
import { hashPassword, verifyPassword } from "./password.ts";
import {
  generateSecret,
  generateTotp,
  verifyTotp,
  totpUri,
} from "./totp.ts";

// ─── Sub-interfaces (can be injected independently if needed) ─────────────────

export interface JwtProvider {
  sign(payload: JwtPayload, opts: JwtOptions): string;
  verify(token: string, secret: string): VerifyResult;
  decode(token: string): JwtPayload | null;
}

export interface PasswordProvider {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
}

export interface TotpProvider {
  generateSecret(bytes?: number): string;
  generateCode(secret: string, atMs?: number): string;
  verify(secret: string, code: string, atMs?: number): boolean;
  uri(secret: string, account: string, issuer?: string): string;
}

// ─── Unified interface ────────────────────────────────────────────────────────

export interface CryptoProvider {
  jwt: JwtProvider;
  password: PasswordProvider;
  totp: TotpProvider;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface CryptoProviderConfig {
  /** JWT signing secret — must be ≥32 chars in production. */
  jwtSecret: string;
  /** Default token TTL in seconds (default: 3600). */
  jwtExpiresInSec?: number;
  /** Issuer claim (default: "tfa"). */
  jwtIssuer?: string;
}

// ─── Default (sovereign) factory ─────────────────────────────────────────────

/**
 * Build the default in-house CryptoProvider backed by node:crypto only.
 * No external dependencies. Call once and inject via DI container.
 *
 * @example
 * ```ts
 * const crypto = defaultCryptoProvider({ jwtSecret: process.env.JWT_SECRET! });
 * // inject into services:
 * const authService = new AuthService(crypto, db);
 * ```
 */
export function defaultCryptoProvider(config: CryptoProviderConfig): CryptoProvider {
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    throw new Error(
      "CryptoProvider: jwtSecret must be at least 32 characters. " +
      "Set JWT_SECRET env var to a 64-char random string in production."
    );
  }

  const jwt: JwtProvider = {
    sign(payload, opts) {
      return signJwt(payload, {
        ...opts,
        secret: opts.secret ?? config.jwtSecret,
        expiresInSec: opts.expiresInSec ?? config.jwtExpiresInSec ?? 3600,
        issuer: opts.issuer ?? config.jwtIssuer,
      });
    },
    verify(token, secret) {
      return verifyJwt(token, secret ?? config.jwtSecret);
    },
    decode(token) {
      return decodeJwt(token);
    },
  };

  const password: PasswordProvider = {
    hash(pw) {
      return hashPassword(pw);
    },
    verify(pw, stored) {
      return verifyPassword(pw, stored);
    },
  };

  const totp: TotpProvider = {
    generateSecret(bytes) {
      return generateSecret(bytes);
    },
    generateCode(secret, atMs) {
      return generateTotp(secret, atMs);
    },
    verify(secret, code, atMs) {
      return verifyTotp(secret, code, atMs);
    },
    uri(secret, account, issuer) {
      return totpUri(secret, account, issuer);
    },
  };

  return { jwt, password, totp };
}

// ─── Test stub factory ────────────────────────────────────────────────────────

/**
 * Build a minimal CryptoProvider stub for unit tests that don't need real crypto.
 * Uses predictable deterministic behaviour: sign returns "<sub>:<exp>", verify
 * checks that format, hash returns "hashed:<pw>", verify checks prefix, totp always
 * returns "123456".
 *
 * NEVER use in production.
 */
export function testCryptoProvider(): CryptoProvider {
  const jwt: JwtProvider = {
    sign(payload) {
      return `stub.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
    },
    verify(token) {
      try {
        const [, body, sig] = token.split(".");
        if (sig !== "sig") return { ok: false, reason: "invalid_signature" };
        const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as JwtPayload;
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp !== undefined && payload.exp < now) return { ok: false, reason: "expired" };
        return { ok: true, payload };
      } catch {
        return { ok: false, reason: "malformed" };
      }
    },
    decode(token) {
      try {
        const [, body] = token.split(".");
        return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as JwtPayload;
      } catch {
        return null;
      }
    },
  };

  const password: PasswordProvider = {
    async hash(pw) { return `hashed:${pw}`; },
    async verify(pw, stored) { return stored === `hashed:${pw}`; },
  };

  const totp: TotpProvider = {
    generateSecret() { return "TESTSECRETBASE32"; },
    generateCode() { return "123456"; },
    verify(_secret, code) { return code === "123456"; },
    uri(secret, account, issuer = "TFA") {
      return `otpauth://totp/${issuer}:${account}?secret=${secret}`;
    },
  };

  return { jwt, password, totp };
}
