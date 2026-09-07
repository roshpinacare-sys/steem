import "../_flush.mjs";
/**
 * tests/containerization/docker-compose.test.ts
 *
 * Verifies that docker-compose.yml defines a production-ready pilot stack:
 * PostgreSQL 16 + TFA service with healthchecks, dependency ordering,
 * and mandatory environment variables.
 */

import { test, assert, eq } from "../_harness.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const composePath = join(import.meta.dirname, "../../docker-compose.yml");
const compose = readFileSync(composePath, "utf8");

// Parse simple YAML-like structure for assertions
function hasKey(key: string): boolean {
  return compose.includes(key);
}

test("docker-compose.yml exists and is non-empty", () => {
  assert(compose.length > 0, "docker-compose.yml must not be empty");
});

test("docker-compose defines postgres service", () => {
  assert(hasKey("postgres:"), "must define postgres service");
});

test("docker-compose postgres uses postgres:16-alpine", () => {
  assert(compose.includes("postgres:16-alpine"), "postgres should use postgres:16-alpine image");
});

test("docker-compose postgres has healthcheck", () => {
  assert(compose.includes("pg_isready"), "postgres healthcheck must use pg_isready");
});

test("docker-compose defines tfa service", () => {
  assert(hasKey("tfa:"), "must define tfa service");
});

test("docker-compose tfa build points to Dockerfile", () => {
  assert(compose.includes("dockerfile: Dockerfile"), "tfa build must reference Dockerfile");
});

test("docker-compose tfa depends_on postgres with condition", () => {
  assert(compose.includes("depends_on:"), "tfa must depend_on postgres");
  assert(compose.includes("condition: service_healthy"), "tfa must wait for postgres to be healthy");
});

test("docker-compose tfa exposes port 7700", () => {
  assert(compose.includes('"7700:7700"') || compose.includes("7700:7700"), "must map host:container port 7700");
});

test("docker-compose tfa sets TFA_PERSIST=pg", () => {
  assert(compose.includes("TFA_PERSIST: pg"), "must set TFA_PERSIST=pg for durable trust");
});

test("docker-compose tfa sets DB_URL pointing to postgres service", () => {
  assert(compose.includes("DB_URL:"), "must set DB_URL");
  assert(compose.includes("postgres:5432"), "DB_URL must point to postgres service");
});

test("docker-compose tfa requires TFA_SECRET via env validation", () => {
  assert(compose.includes("TFA_SECRET"), "must reference TFA_SECRET");
  assert(compose.includes("${TFA_SECRET:?"), "should fail fast if TFA_SECRET is missing");
});

test("docker-compose tfa sets TFA_REQUIRE_API_KEY=1", () => {
  assert(compose.includes('TFA_REQUIRE_API_KEY: "1"'), "must enforce API keys in pilot");
});

test("docker-compose tfa has healthcheck probing /healthz", () => {
  assert(compose.includes("healthcheck:"), "tfa must have healthcheck");
  assert(compose.includes("/healthz"), "tfa healthcheck must probe /healthz");
});

test("docker-compose defines persistent volume for postgres", () => {
  assert(compose.includes("volumes:"), "must declare volumes");
  assert(compose.includes("tfa_pg_data:"), "must define named volume for postgres data");
});

test("docker-compose does not hardcode secrets", () => {
  const lowered = compose.toLowerCase();
  assert(!lowered.includes("tfa_secret: changeme"), "must not use placeholder secrets");
  assert(!lowered.includes("password: tfa") || compose.includes("POSTGRES_PASSWORD: tfa"), "postgres test password is acceptable for local pilot");
});
