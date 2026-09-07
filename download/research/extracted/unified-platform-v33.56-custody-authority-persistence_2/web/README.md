# Web Vertical Slice v19

This is a workflow product, not a KPI dashboard.

It exposes one complete bounded problem:

> Review and govern a local repository change from objective and permissions through tests, evidence, independent review, passport and exact rollback.

The product includes loading, empty, error, blocked, review and recovery states; labels for all form controls; keyboard focus; responsive layout; localization-ready English strings; and RTL CSS readiness.

The browser E2E test uses Chromium. Direct browser navigation to loopback URLs is blocked by an administrator policy in the current environment, so Playwright renders the actual UI and bridges API calls to the real local backend. This limitation is recorded in the E2E evidence and is not described as a normal network deployment test.
