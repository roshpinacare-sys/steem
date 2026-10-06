// ─────────────────────────────────────────────────────────────────────
// /api/exchange/mcp — מניפסט-כלים לסוכני-AI (דפוס-1inch "AI-ready").
//
// הוראת המפעיל (trace 1a1068761637cf9d): "לפתוח את הדקס לעוד רשתות
// חכמות לכולן" + מודיעין-r193 §4.2: "להשלים דוק-MCP דק בכתיבה-אחת".
//
// מניפסט-קריאה-בלבד, אפס-מפתחות, אפס-פעולה: סוכן שקורא אותו מקבל
// את מפת-הכלים החיים של ה-DEX הריבוני (ציטוט, תכנון-מסלול, ארביטראז,
// גריד-מתנגד, כוננות-הדלקה) עם דוגמאות-curl מדויקות וכתובות-קבלה.
// ─────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = new Date().toISOString();
  return NextResponse.json(
    {
      mcp: "1.0",
      server: {
        name: "sovereign-dex",
        title: "ה-DEX הריבוני — THE WEAVE",
        version: "1.1.0-r194",
        description: "זירת-החלפות על פסי Steem/Hive/Blurt + נכסי-הרשת שלנו: בריכות-AMM עם עמלות-דינמיות, פגי-פדיון-אמת 1:1, ספרי-שרשרת חיים, גריד-מתנגד, ושוק-ארביטראז לסוכנים (ERC-8004 + x402). כנות-מלאה: עומק בר-ביצוע בכל ציטוט, אין-נזילות-מדומה.",
        protocols: ["ERC-8004 (אימות-סוכנים 13/13)", "x402 (HTTP-402)", "hash-chained ledger"],
      },
      tools: [
        {
          name: "dex.quote",
          description: "ציטוט-חי להמרה בין שני נכסים בבריכה (CPMM, עמלה-כלולה).",
          input: { pair: "WSTEEM/WSBD | WBLURT/USDS | SAOS/USDS", side: "A2B | B2A", amountIn: "number" },
          example: "curl http://<host>/api/exchange?with=quote&pair=WSTEEM%2FWSBD&side=A2B&amountIn=0.01",
        },
        {
          name: "dex.planRoute",
          description: "תכנון-מסלול רב-רגלי בין כל-שני נכסים (בריכות+פגים+ספרים+תור-המרות), עם עומק בר-ביצוע לכל רגל ופיצול-מים לסכומים-גדולים.",
          input: { from: "USDS|WSTEEM|WSBD|WHIVE|WHBD|WBLURT|...", to: "...", amountIn: "number" },
          example: "curl http://<host>/api/exchange/plan?from=USDS&to=WSTEEM&amountIn=2",
        },
        {
          name: "dex.agentArb",
          description: "פלייבוק-ארביטראז לסוכן: הזדמנויות הגלאי + הרגל-בת-הביצוע על הרשת שלנו + קפסות-השער.",
          input: {},
          example: "curl http://<host>/api/exchange/agent/arb",
        },
        {
          name: "dex.gridStatus",
          description: "מצב-הגריד-המתנגד: סולם סביב פאריטת-הפיד, הטיית-התנגדות לסקיו-ספר-השרשרת, מילויים ו-PnL ממילויים-בלבד.",
          input: {},
          example: "curl http://<host>/api/dex-grid",
        },
        {
          name: "dex.ignite",
          description: "דוח-כוננות-הדלקה: האם-המנוע-מוכן לפעולה-חיה, עומק-בריכה מול סף-הזריעה, שרשרת-הדלק, וכתובות-קבלה לכל רשת.",
          input: {},
          example: "curl http://<host>/api/dex-grid?with=ignite",
        },
        {
          name: "dex.drill",
          description: "סדרת-הדלקה יבשה: selftest + קפסות + מרכזים + quote-חי + מתמטיקת-PnL — בלי-שידור-כסף.",
          input: {},
          example: "curl http://<host>/api/dex-grid?with=drill",
        },
      ],
      resources: {
        receiveAddresses: {
          steem: "headcorner",
          hive: "headcorner",
          blurt: "headcorner",
          tron: "TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy",
          note: "הראוטר מקבל בכל רשת ומחליף דרך דלפק-הזירה; כתובות-ציבוריות בלבד — חתימה דרך שער-המפעיל בלבד (חוק-הברזל).",
        },
        honestyRules: [
          "L1 — עומק בר-ביצוע בכל רגל; אין ציטוט שלא ניתן לבצע",
          "L3 — מרכז=פיד-חי; אין פיד → דילוג כנה (אין מחיר מומצא)",
          "L4 — קפסות מקודדות + kill-switch; אובדן-יומי מעל התקרה = עצירה-עצמית",
          "L5 — PnL ממילויים בלבד, מדוד מול המרכז בשעת הביצוע",
        ],
      },
      at: now,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
