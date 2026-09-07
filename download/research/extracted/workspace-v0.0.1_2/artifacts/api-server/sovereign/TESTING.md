# TFA Test Kit (ECOS-derived, zero-dependency)
שכבת בדיקות/audit ריבונית ל-TFA. רצה על Node 22+ עם TypeScript מובנה — בלי vitest/jest/tsx.

## התקנה
העתיקו לתוך `artifacts/api-server/`:
- `scripts/ecos-audit.mjs`, `scripts/gen-contract-tests.mjs`
- `tests/_harness.mjs` (+ טסטי-החוזה תחת `tests/contract/`)

## הרצה
`node scripts/ecos-audit.mjs` (ראו MANIFEST.md). זה הכל.

## למה אפס-תלות
Node 22+ מריץ `.ts` ישירות (strip-types מובנה). ה-harness הוא ~30 שורות. עצמאות מלאה — בלי שרשרת build לטסטים.
