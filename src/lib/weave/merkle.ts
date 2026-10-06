// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Merkle — עץ Merkle על keccak256 (עמיד לשיבוש בודד)
// אלגוריתם: עץ בינארי שמרנו את הסדר (order-preserving), עלה אי-זוגי
// בכל רמה משוכפל. השיטה מתועדת — ולכן כל צומת יכול לחשב מחדש ולהתאים.
// ─────────────────────────────────────────────────────────────────────

import { keccak256 } from "ethers";

function concatBytes32(a: string, b: string): string {
  return keccak256(a + b.slice(2));
}

/** שורש Merkle מעל רשימת leaves (bytes32 hex) */
export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) {
    throw new Error("merkleRoot: רשימה ריקה — אין מה לאמת");
  }
  let level = leaves.slice();
  while (level.length > 1) {
    if (level.length % 2 === 1) {
      level.push(level[level.length - 1]); // שכפול עלה אחרון — כלל מתועד
    }
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(concatBytes32(level[i], level[i + 1]));
    }
    level = next;
  }
  return level[0];
}

/** הוכחת הכללה (Merkle proof) לעלה באינדקס i — לאימות מול root בשרשרת */
export function merkleProof(leaves: string[], index: number): string[] {
  if (index < 0 || index >= leaves.length) {
    throw new Error("merkleProof: אינדקס מחוץ לטווח");
  }
  const proof: string[] = [];
  let level = leaves.slice();
  let idx = index;
  while (level.length > 1) {
    if (level.length % 2 === 1) {
      level.push(level[level.length - 1]);
    }
    const sibling = idx % 2 === 0 ? idx + 1 : idx - 1;
    proof.push(level[sibling]);
    idx = Math.floor(idx / 2);
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(concatBytes32(level[i], level[i + 1]));
    }
    level = next;
  }
  return proof;
}

/** אימות הוכחה בודדת — בלי גישה לעץ כולו, רק root + proof + leaf */
export function verifyMerkleProof(
  leaf: string,
  proof: string[],
  root: string,
  index: number
): boolean {
  let computed = leaf;
  let idx = index;
  for (const p of proof) {
    computed =
      idx % 2 === 0 ? concatBytes32(computed, p) : concatBytes32(p, computed);
    idx = Math.floor(idx / 2);
  }
  return computed === root;
}
