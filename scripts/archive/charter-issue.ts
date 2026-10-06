// scripts/charter-issue.ts — הנפקת טוקן-בונה משורת הפקודה (סנדבוקס, מפעיל בלבד).
// שימוש: bun run scripts/charter-issue.ts "שם הבונה"
import { issueBuilder } from "../src/lib/charter";

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error("שימוש: bun run scripts/charter-issue.ts \"<שם הבונה>\"");
    process.exit(1);
  }
  const issued = await issueBuilder(name);
  console.log("─ מספנת הצ'רטרים · הנפקת בונה ─");
  console.log(`בונה:        ${name}`);
  console.log(`זהות (EVM):  ${issued.address}`);
  console.log(`טוקן:        ${issued.token}`);
  console.log("⚠ הטוקן נשמר hash בלבד — זו ההזדמנות היחידה להעתיק אותו.");
  process.exit(0);
}

main();
