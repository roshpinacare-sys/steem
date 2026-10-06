// scripts/charter-republish.ts — פרסום-מחדש של כל המרשם והכרטיסים לקנון.
// שימוש: bun run scripts/charter-republish.ts
// מטרה: ריפוי אחרי כשל-פרסום זמני, או אחזקה לאחר איפוס-סנדבוקס.
import { db } from "../src/lib/db";
import { CHARTER, publishCanon } from "../src/lib/charter";

async function main() {
  const all = await db.charterProject.findMany({
    orderBy: { createdAt: "asc" },
    include: { builder: true },
  });
  console.log(`נמצאו ${all.length} פרויקטים לפרסום.`);
  for (const p of all) {
    const card = [
      `# ${p.name}`,
      ``,
      `| שדה | ערך |`,
      `| --- | --- |`,
      `| slug | \`${p.slug}\` |`,
      `| מצב | ${p.status} |`,
      `| בונה | ${p.builder.name} |`,
      `| זהות | \`${p.builder.ethAddress}\` |`,
      p.attSeq != null ? `| אימות-הקמה | seq ${p.attSeq} · entryHash \`${(p.attEntryHash ?? "").slice(0, 18)}…\` |` : "",
      `| מסמכים | ${p.artifactsCount} |`,
      `| הוקם | ${p.createdAt.toISOString()} |`,
      ``,
      `## מטרה`,
      ``,
      p.purpose,
      ``,
      `---`,
      `צ'רטר זה נחתם EIP-191 בספר האימותים של THE WEAVE ומפורסם לקנון.`,
    ]
      .filter(Boolean)
      .join("\n");
    const r = await publishCanon(
      `${CHARTER.projectDir}/${p.slug}/README.md`,
      card,
      `charter: republish card "${p.slug}"`,
    );
    console.log(`${p.slug}: card ${r.ok ? "OK" : "FAIL " + (r.error ?? "")}`);
  }
  const registry = {
    publishedAt: new Date().toISOString(),
    projects: all.map((p) => ({
      slug: p.slug,
      name: p.name,
      purpose: p.purpose,
      status: p.status,
      builderName: p.builder.name,
      builderAddress: p.builder.ethAddress,
      attSeq: p.attSeq,
      attEntryHash: p.attEntryHash,
      artifacts: p.artifactsCount,
      charterAt: p.createdAt.toISOString(),
    })),
  };
  const rr = await publishCanon(
    CHARTER.registryPath,
    JSON.stringify(registry, null, 2) + "\n",
    `charter: registry republished (${all.length} projects)`,
  );
  console.log(`registry: ${rr.ok ? "OK " + (rr.url ?? "") : "FAIL " + (rr.error ?? "")}`);
  process.exit(0);
}

main();
