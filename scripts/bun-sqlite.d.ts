// ─────────────────────────────────────────────────────────────────────
// הצהרת-סביבה מינימלית ל-bun:sqlite — tsconfig הבית (Next.js) אינו כולל
// את סוגי ה-Bun, אך סקריפטי ה-WEAVE (#!/usr/bin/env bun) רצים תחת Bun.
// ההצהרה מצומצמת לשימוש בפועל בסקריפטים (query/get/all/close בלבד)
// כדי לא להתנגש בטיפוסים רחבים יותר אם יתווספו סוגי Bun מלאים בעתיד.
// ─────────────────────────────────────────────────────────────────────

declare module "bun:sqlite" {
	export interface Statement {
		get(...params: unknown[]): unknown;
		all(...params: unknown[]): unknown[];
		run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
	}
	export class Database {
		constructor(path: string, options?: { readonly?: boolean; create?: boolean });
		query(sql: string): Statement;
		close(): void;
	}
}
