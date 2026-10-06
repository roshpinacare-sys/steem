// /api/domains/kit — מחולל ערכת-הפריסה הריבונית.
//
// "להקים דומיינים פרטיים על הרשת" בלי GitHub ובלי ספק יישומים: השרת
// שלך + הדומיין שלך + חבילה אחת שמניחה את האתר כולו (Caddy עם HTTPS
// אוטומטי, Docker, סקריפט פריסה אחת, רשומות DNS מדויקות). החבילה
// נוצרת חיה מהדומיין שנבחר וחוזרת כקובץ ZIP מוכן להעלאה לשרת.
//
// אמת: כל קובץ כאן רץ כמו שהוא — אין בו שמות ספקים, אין בו ריפו,
// אין בו שום דבר שאינך יכול לבדוק שורה-שורה לפני ההרצה.

import { NextResponse } from "next/server";
import JSZip from "jszip";
import { domainValid } from "@/lib/agent-browser/zai";

export const dynamic = "force-dynamic";

function dockerCompose(): string {
  return `# ─────────────────────────────────────────────────────────────────────
# פריסה ריבונית · THE WEAVE — שרת אחד שלך, דומיין אחד שלך.
# הרצה: docker compose up -d --build   (או פשוט: ./deploy.sh <domain>)
# ─────────────────────────────────────────────────────────────────────
services:
  app:
    build: ./site
    restart: unless-stopped
    env_file: .env
    volumes:
      - app_data:/data
    expose:
      - "3000"

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp" # HTTP/3
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app

volumes:
  app_data:
  caddy_data:
  caddy_config:
`;
}

function caddyfile(domain: string): string {
  return `# ─────────────────────────────────────────────────────────────────────
# Caddy — השער של הדומיין הריבוני.
# HTTPS אוטומטי (Let's Encrypt) ל-{$DOMAIN} ול-www — אין סרטיפיקטים
# לנהל ידנית, אין חידוש לפחד ממנו. הכל מקומי אצלך.
# ─────────────────────────────────────────────────────────────────────
{
\temail operator@${domain}
}

{$DOMAIN} {
\tencode zstd gzip
\treverse_proxy app:3000

\theader {
\t\tStrict-Transport-Security "max-age=31536000; includeSubDomains; preload"
\t\tX-Content-Type-Options "nosniff"
\t\tReferrer-Policy "strict-origin-when-cross-origin"
\t\tPermissions-Policy "camera=(), microphone=(), geolocation=()"
\t\tX-SAOS-Sovereign "true"
\t\t-X-Frame-Options ""
\t}

\tlog {
\t\toutput file /data/access.log {
\t\t\troll_size 50MiB
\t\t\troll_keep 10
\t\t}
\t}
}

www.{\$DOMAIN} {
\tredir https://{\$DOMAIN}{uri} permanent
}
`;
}

function dockerfile(): string {
  return `# ─────────────────────────────────────────────────────────────────────
# Dockerfile — בניית האתר (Next.js standalone על Bun).
# העתק את קוד האתר לתיקיית site/ לפני הבנייה. בלי ריפו — scp/rsync.
# ─────────────────────────────────────────────────────────────────────
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM oven/bun:1 AS run
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["bun", "server.js"]
`;
}

function deploySh(domain: string): string {
  return `#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# deploy.sh — פריסה ריבונית בפקודה אחת על שרת לינוקס פרטי.
#
# שימוש:   ./deploy.sh ${domain}
# דורש:   Docker + Docker Compose, קוד האתר ב-site/, רשומות DNS
#          שמצביעות על ה-IP של השרת הזה (ראה dns-records.txt).
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

DOMAIN="\${1:-${domain}}"

say() { printf '\u25b8 %s\\n' "$1"; }
die() { printf '\u2717 %s\\n' "$1" >&2; exit 1; }

say "פריסה ריבונית — \${DOMAIN}"

# 1) תלויות
command -v docker >/dev/null 2>&1 || die "Docker לא מותקן — התקן קודם: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "Docker Compose לא זמין"

# 2) קונפיגורציה
[ -f .env ] || { cp .env.example .env; say "נוצר .env — ערוך והרץ שוב אם צריך"; }
sed -i.bak "s|^DOMAIN=.*|DOMAIN=\${DOMAIN}|" .env && rm -f .env.bak
export DOMAIN="\${DOMAIN}"

# 3) חומת אש (אם ufw קיים)
if command -v ufw >/dev/null 2>&1; then
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw allow 443/udp >/dev/null 2>&1 || true
  say "חומת אש: 80/443 פתוחים"
fi

# 4) בנייה והרצה
[ -d site ] || die "חסרה תיקיית site/ — העתק אליה את קוד האתר"
say "בונה ומעלה את השירותים…"
docker compose up -d --build

# 5) אימות גולמי — לא מאמינים ל"הצלחה", בודקים בפועל
say "ממתין לסרטיפיקט (עד 120 שניות)…"
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://\${DOMAIN}" || echo 000)
  if [ "\$code" = "200" ]; then
    say "הדומיין חי: https://\${DOMAIN} (HTTP \$code)"
    curl -sI "https://\${DOMAIN}" | grep -i "x-saos-sovereign" && say "חותם ריבוני אומת"
    exit 0
  fi
  sleep 2
done

die "האתר עדיין לא עונה על https://\${DOMAIN} — בדוק: docker compose logs caddy"
`;
}

function dnsRecords(domain: string): string {
  return `; ─────────────────────────────────────────────────────────────────────
; רשומות DNS ליצירה אצל רשם הדומיינים שלך (Namecheap / Porkbun /
; Cloudflare במצב "DNS only" / כל רשם אחר). החלף <IP-של-השרת> בכתובת
; הציבורית של השרת שעליו תריצו את החבילה.
;
; חשוב: אין צורך להעביר את הניהול לשום ספק — הרשומות מצביעות
; ישירות על השרת שלך. אתה הבעלים של הפריסה כולה.
; ─────────────────────────────────────────────────────────────────────

; הדומיין הראשי — שרת האתר:
@        IN  A      <IP-של-השרת>

; תת-דומיין www — מופנה לראשי:
www      IN  CNAME  ${domain}.

; (אופציונלי, להמשך הדרך — שמות שמורים לתתי-שירותים עתידיים):
; games    IN  A      <IP-של-השרת>
; faucet   IN  A      <IP-של-השרת>
; api      IN  A      <IP-של-השרת>

; אימות בעלות עתידי (אם הרשם יבקש):
; @        IN  TXT    "saos-sovereign=<טוקן-אימות>"
`;
}

function envExample(): string {
  return `# ─────────────────────────────────────────────────────────────────────
# הגדרות הסביבה של הפריסה הריבונית — ערוך ושמור כ-.env
# ─────────────────────────────────────────────────────────────────────

# הדומיין שמוגש מהשרת הזה:
DOMAIN=example.com

# מסד הנתונים — SQLite מקומי על ווליום קבוע (לא נמחק בעדכון):
DATABASE_URL=file:/data/custom.db

# אופציונלי — סוד לחתימת סשנים (צור עם: openssl rand -hex 32):
# SESSION_SECRET=
`;
}

function readme(domain: string): string {
  return `# פריסה ריבונית · ${domain}

חבילה זו מקימה את האתר כולו על **שרת פרטי שלך** — תחת הדומיין הפרטי שלך,
עם HTTPS אוטומטי, **בלי GitHub, בלי ספק יישומים, בלי תלות באף אחד**.

## מה יש בחבילה

| קובץ | תפקיד |
|---|---|
| \`docker-compose.yml\` | שני שירותים: האתר (app) + השעת (caddy) עם HTTPS אוטומטי |
| \`Caddyfile\` | הגדרות השעת: דומיין, כותרות אבטחה, חותם ריבוני \`X-SAOS-Sovereign\` |
| \`Dockerfile\` | בניית האתר (Next.js standalone על Bun) — נמצא בתוך \`site/\` |
| \`deploy.sh\` | פריסה בפקודה אחת + אימות חי בסוף |
| \`dns-records.txt\` | רשומות ה-DNS המדויקות ליצירה אצל רשם הדומיינים |
| \`.env.example\` | הגדרות סביבה — להעתיק ל-\`.env\` ולערוך |

## המסלול — 5 צעדים

1. **שרת**: השג שרת לינוקס פרטי (VPS) עם גישת root — כל ספק
   תשתית שמוכר לך מכבד את התוכן שלך (למשל: Hetzner, Contabo, OVH,
   או שרת פיזי שלך). התקן Docker.

2. **דומיין**: רכוש את \`${domain}\` אצל כל רשם שתבחר, וצור את
   רשומות ה-DNS מתוך \`dns-records.txt\` — הן מצביעות על ה-IP
   של השרת **ישירות** (בלי פרוקסי של אף ספק).

3. **קוד**: העתק את קוד האתר לתיקייה \`site/\` (rsync/scp מהמחשב
   שלך — לא מריפו ציבורי, לא מספק ענן):
   \`\`\`bash
   rsync -av --exclude node_modules --exclude .next ./ user@server:~/sovereign/site/
   \`\`\`
   יחד עם החבילה הזו לצידו:
   \`\`\`bash
   scp docker-compose.yml Caddyfile Dockerfile deploy.sh dns-records.txt .env.example user@server:~/sovereign/
   \`\`\`

4. **הרצה**: בשרת — פקודה אחת:
   \`\`\`bash
   cd ~/sovereign && chmod +x deploy.sh && ./deploy.sh ${domain}
   \`\`\`
   הסקריפט בונה, מעלה, פותח חומת-אש, ומחכה לסרטיפיקט.

5. **אימות** (הסקריפט עושה זאת, וגם אתה יכול):
   \`\`\`bash
   curl -sI https://${domain} | grep -iE "HTTP|x-saos-sovereign"
   \`\`\`
   הצפי: \`HTTP/2 200\` ו-\`x-saos-sovereign: true\`. זו ההוכחה הגולמת
   שהדומיין חי — מהשרת שלך, עם הסרטיפיקט שלך.

## עדכונים עתידיים

\`\`\`bash
rsync -av --delete --exclude node_modules --exclude .next ./ user@server:~/sovereign/site/
cd ~/sovereign && docker compose up -d --build
\`\`\`

הנתונים (DB על ווליום \`app_data\`) שורדים כל עדכון — אין מסד נתונים
מנוהל, אין חשבון ענן, אין מפתח API של ספק.

## האמת על החזקת שרת

- **גיבויים**: אחריותך — \`sqlite3 /var/lib/docker/volumes/*/_data/custom.db .dump\` מדי פעם.
- **עדכוני אבטחה**: \`apt update && apt upgrade\` בשרת, ועדכון תמונות Docker.
- **אף אחד לא יכול לכבות לך את זה** חוץ מספק התשתית שבחרת ואתה עצמך —
  ולכן בחר ספק תשתית (רק מכונה) ולא ספק פלטפורמה (שכבת תוכן).

נוצר חי על-ידי מרכז הדומיינים · THE WEAVE
`;
}

export async function POST(req: Request) {
  let domain = "";
  try {
    const body = (await req.json()) as { domain?: unknown };
    domain = String(body?.domain ?? "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "");
  } catch {
    return NextResponse.json(
      { ok: false, error: "גוף הבקשה אינו JSON תקין" },
      { status: 400 },
    );
  }
  if (!domainValid(domain)) {
    return NextResponse.json(
      { ok: false, error: "פורמט דומיין לא תקין (למשל: example.com)" },
      { status: 400 },
    );
  }

  const zip = new JSZip();
  zip.file("docker-compose.yml", dockerCompose());
  zip.file("Caddyfile", caddyfile(domain));
  zip.file("site/Dockerfile", dockerfile());
  zip.file("deploy.sh", deploySh(domain), { unixPermissions: 0o755 });
  zip.file("dns-records.txt", dnsRecords(domain));
  zip.file(".env.example", envExample());
  zip.file("README.md", readme(domain));

  const bytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="sovereign-${domain}.zip"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "no-store",
    },
  });
}
