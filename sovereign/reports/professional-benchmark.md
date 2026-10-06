# Professional Systems Benchmark - מה מערכות מקצועיות מפרסמות, ומה קרה אצלנו

**Task ID:** R61-A · **תאריך מדידה:** 2026-09-19 (שעות UTC הערב)
**שיטה:** חילוץ ישיר של ה-HTML הגולמי ב-curl עם User-Agent של דפדפן אמיתי. שום דבר בדוח הזה לא נכתב מזיכרון או משיחה - כל סעיף ניווט, כל כותרת וכל מספר נלקח מהקובץ שירד מהרשת בזמן המדידה. כל טענה על האתר שלנו נבדקה מול הכתובות הציבוריות החיות.

**הרקע לדוח:** תלונת המפעיל הייתה שהתוכן הציבורי שלנו לא מקצועי - שנדחפו אליו דברים מתוך השיחות שלנו והזיות. הדוח הזה בודק את הטענה מול ארבע מערכות מקצועיות אמיתיות, ללא חיוך למצלמה וללא הגנה על אף צד.

---

## Sources and Method - מה נמדד ומתי

**מערכות מקצועיות שנמדדו בהצלחה (HTTP 200):**

| מערכת | כתובת | גודל HTML שירד | כותרת שנמדדה |
|---|---|---|---|
| Chainlink | chain.link | 417,465 בייטים | Chainlink: The Industry-Standard Oracle Platform |
| OpenZeppelin | openzeppelin.com | 185,029 בייטים | OpenZeppelin · The Security Standard for Onchain Finance |
| QuickNode | quicknode.com | 1,344,730 בייטים | The Blockchain Development Platform |
| Blocknative | blocknative.com | 108,003 בייטים | Blocknative (מודעת סגירה/מעבר ל-Deloitte) |
| Moralis (גיבוי) | moralis.io | 283,235 בייטים | Moralis · Enterprise-Grade Web3 APIs |

**מערכות שלא נמדדו כי הן חוסמות בוטים בתוקף:** etherscan.io (אתגר Cloudflare, קוד 403), tenderly.co (מחסום Vercel, קוד 429), alchemy.com (403). הן הוחלפו לפי ההנחייה. עובדה שיש לציין ביושר: חסימת הבוטים האגרסיבית שלהן היא בעצמה סימן של תשתית מקצועית - הן משקיעות בהגנה על הנכס הציבורי שלהן.

**האתר שלנו שנמדד (כל הכתובות החיות):** עמוד הבית (200, 157,900 בייטים) · מרכז התוכן hub/index.html (200, 18,230 בייטים) · sitemap.xml (200, 92 כתובות) · truth.html (200, 30,001 בייטים) · truth/latest.json (200, פסק-דין ALL-GREEN) · index של ארכיון הדוחות hub/docs/reports/index.html (200, 39 קישורים לדוחות). שורש הדומיין https://roshpinacare-sys.github.io/ החזיר 404 - נמדד, לא משוער.

---

## 1. What Professional Systems Publish - מה מערכות מקצועיות מפרסמות

### Chainlink (chain.link)

**מיקוד (נמדד מהכותרת):** "The Industry-Standard Oracle Platform". משפט אחד שאומר מה המערכת ולמי.

**סעיפי ניווט ראשיים שחולצו מהדף:** מוצרים - CCIP (Cross-Chain Interoperability Protocol), Chainlink Runtime Environment (CRE), Chainlink for Agents, Data Streams, Data and Market Feeds, Proof of Reserve, SmartData, VRF, Automated Compliance Engine (ACE) · Use Cases לפי קהל - asset managers, commercial banks, digital asset custodians, exchanges and trading venues, DeFi protocols, government · Community - certification בשיתוף Cyfrin, advocates, hackathon, bootcamps, code of conduct · Docs בדומיין ייעודי docs.chain.link (נמדד 200) · Insights ו-Blog.

**בלוקים בעמוד הבית (מכותרות H2/H3 שחולצו):** סיפור הפלטפורמה ("The Chainlink Platform: unlock onchain finance at scale") · "Why Chainlink is the global standard" · בלוק מוסדות עם שמות אמיתיים ומאומתים בשוק: J.P. Morgan Kinexys, Ondo Finance, ANZ, ADDX, MAS Project Guardian, Swift, UBS Asset Management, Fidelity International, Sygnum, 21X, GMX, Aave · חדשות (In the news) · קריאה לפעולה ("Future-proof your move onchain with Chainlink").

**סוגי תוכן שהם מפרסמים:** עמודי מוצר לכל יכולת, עמודי use-case לכל קהל, תיעוד מפתחים מלא, חדשות משפטיות-עסקיות, חינוך והסמכות, קהילה עם קוד התנהגות ציבורי.

### OpenZeppelin (openzeppelin.com)

**מיקוד (נמדד):** "The security standard for onchain finance" ובמטא: "The smart contracts, standards, and continuous security trusted by the institutions and technology innovators moving finance onchain."

**סעיפי ניווט שחולצו:** Security Audits (openzeppelin.com/security-audits, נמדד 200) · Continuous Security Program · שירותים לפי קהל - Banks, Asset Managers, Payment Networks, Blockchain Networks · מוצרים - Contracts Libraries, Contracts Wizard, Upgrades Plugins, UI Builder, Safe Utils, Role Manager · רשתות נתמכות (11 שרשרות בשמות) · Research · Customer Stories · Stats (openzeppelin.com/stats, נמדד 200) · Documentation בדומיין ייעודי docs.openzeppelin.com · Forum · Ethernaut CTF (משחק לימוד אבטחה) · About Us, News, Careers, FAQs · Newsletter ("The Onchain Brief").

**בלוקים בעמוד הבית שחולצו:** H1 יחיד וברור · מספר ענק מדיד - "$31,160,337,760,351" (שווי onchain שרץ על הרכיבים שלהם) · "9 of the top 10 stablecoins" ו-"10 of the top 10 tokenized money market funds" - סטטיסטיקות שוק שניתנות לאימות חיצוני · בלוקי ביטחון לפי סוג לקוח · Latest from OpenZeppelin (מאמרים אקטואליים, למשל על סיכוני קוונטים ועל חוק GENIUS).

**סוגי תוכן:** עמודי ביקורת אבטחה מסחריים, ספריות קוד פתוחות, מחקר, סטטיסטיקה ציבורית, סיפורי לקוח, פורום, דף השוואה מול החלופות, חדשות.

### QuickNode (quicknode.com)

**מיקוד (נמדד מהמטא, שווה ציטוט מילה במילה):** "The fastest RPC is now the whole stack: nodes, real-time streams, indexed data, and trading execution from one Quicknode account. **Measured, not claimed.**" המשפט הזה רלוונטי אלינו במיוחד - ראו סעיף 3.

**סעיפי ניווט שחולצו:** מוצרים - Core RPC API, Dedicated Clusters, IPFS, Validator as a Service, Key-Value Store, Add-ons · נתונים בזמן אמת - Streams, Webhooks, Solana gRPC · נתונים מאונדקסים - SQL Explorer, Blockbook, Ordinals and Runes API · מסחר - Swap API · Use Cases - DeFi, Gaming, Trading Firms, AI, Finance, Wallets, Startups, Enterprises · משאבים - Documentation, Guides, Sample Apps, Courses, CLI, SDK, MCP · **Status** (status.quicknode.com, נמדד 200) · **Benchmarks** (quicknode.com/benchmarks, נמדד 200) · Faucet · Gas Tracker · About, Blog, Case Studies, Events, Careers, Contact Us, Pricing.

**בלוקים בעמוד הבית שחולצו:** "Build Without Compromise" · "Your infra team without the infra work" · בלוק לכל שכבת מוצר (יסודות, נתונים בזמן אמת, מסחר) · "Enterprise Infrastructure Without Constraints" · "Trusted by Industry Leaders" · "Built for Every Use Case" · מדרגות התחלה לפי סוג בונה. בפוטר אפילו עמוד "Agents, use LLMs.txt" - תאימות לסוכני AI, נושא שקרוב אלינו.

**דף ה-Benchmarks שלהם (נמדד בנפרד):** "RPC performance, measured in the open. Live latency across chains, regions, and providers. Same payloads, same schedule, cold connections. **We publish exactly how we measure it.**" זו המקבילה הכי קרובה בעולם המקצועי למכונת האמת שלנו - חברה שמפרסמת מדידה עצמאית של ביצועים, כולל מתודולוגיה גלויה.

**סוגי תוכן:** תיעוד, מדריכים, קורסים, אפליקציות דוגמה, עמוד סטטוס חי, עמוד מדידות ציבורי, תמחור גלוי, סיפורי לקוח, קריירה, בלוג.

### Blocknative (blocknative.com)

מקרה מיוחד שחשוב להביא דווקא בגלל הכנות שבו. Blocknative נרכשה על ידי Deloitte, והעמוד הראשי שלהם כרגע הוא **מודעת סגירה מסודרת**: "Blocknative joins Deloitte", עם ציר זמן לכיבוי ה-API והנחיות הגירה ללקוחות ("API sunset timeline and migration"). גם במוות של מוצר, הם מפרסמים לוח זמנים ברור ואחריות ללקוח. בפוטר: Contact, Gas Network, Gas Estimator, About, Blog, Brand, Careers, Docs (docs.blocknative.com), Research, Privacy Policy, Terms of Service.

**הלקח שנמדד כאן:** מקצועיות היא לא רק "מה מפרסמים בזמן צמיחה" אלא גם איך מודיעים על שינוי, סוף שירות וליקוי - בלי להשאיר את הלקוח בערפל.

### Moralis (moralis.io) - גיבוי, בפירוט קצר

"Enterprise-Grade Web3 APIs". ניווט: Data APIs (Wallet, Token, NFT, Price, DeFi, Blockchain) · Streams · Datashare · Data Feeds · RPC Nodes · 50+ שרשרות בעמודים ייעודיים · Case Studies - 16 לקוחות בשמות מלאים (Wirex, ChainGPT, Ronin Wallet, Kriptomat ועוד) · Use Cases · **Comparisons** - עמודי "Moralis vs QuickNode / vs DeBank / vs Zerion" · Enterprise · **Security and Compliance** ("Certifications, audits and...") · Resources - Documentation, API Reference, FAQ, Help Center · מחקר עצמאי ("The State of Web3 Indexing") · Pricing.

### המכנה המשותף שנמדד בכולן

1. **משפט מיקוד אחד** בראש העמוד - מה המערכת ולמי היא.
2. **עמודי מוצר** שמסבירים יכולת, לא פעימת עבודה.
3. **תיעוד מפתחים** בדומיין ייעודי (docs.chain.link, docs.openzeppelin.com, docs.blocknative.com, docs.moralis.com - כולן נמדדו 200).
4. **הוכחות שוק בנות-אימות**: מספרים, שמות מוסדות, אחוזים מהשוק, סיפורי לקוח בשמות.
5. **דפי סטטוס ומדידה**: status.quicknode.com חי; benchmarks של QuickNode מפרסמים מתודולוגיה מלאה; stats של OpenZeppelin ציבורי.
6. **אבטחה כתוכן גלוי**: עמודי ביקורות אבטחה, תוכנית אבטחה מתמשכת, עמוד Security and Compliance.
7. **מסגרת משפטית**: Privacy Policy ו-Terms בכולן (חיפוש מילות מפתח נמדד בכל אחת מה-HTML שירדו).
8. **קריירה, מותג, קהילה**: עמודי Careers, Brand, קוד התנהגות, הסמכות, האקתונים.
9. **כל פריט תוכן שייך לקהל חיצוני**: מפתח, רוכש ארגוני, עיתונאי או מועמד. אף פריט לא פונה לעובד של עצמם.

---

## 2. What They Would Never Publish - ומה דומה לזה היה אצלנו

### מה אף אחת מהן לעולם לא הייתה מפרסמת

- **יומן פעימות פנימי של משמרות הנדסה.** אצלם תוצרי עבודה פנימיים חיים ב-Jira, ב-PR, ב-status meeting. אצלנו: 32 קבצי SAOS-PULSE - דוחות פעימה שעתיים ומחזוריים (h16 עד h28, R2 עד R22, מ-2026-09-11 עד 2026-09-13) שתיעדו מחזורי עיגון, ריפוי כספת, תחיית סביבה, נעילת PAT, נפילת שרת. זה בדיוק יומן משמרת. נמדד: כל 32 הקישורים חיים ב-index הפרוס בזמן המדידה.
- **טיוטות שנכתבו על ידי מודול שיווק פנימי מתוך שיחה.** הסוג הכי קרוב ל"הזיות שנדחפו מהשיחות" שהמפעיל תיאר: SAOS-DAILY-REPORT-2026-09-11-ADSMARKET ("מאת Adsmarket - מודול השיווק והתוכן") ו-SAOS-STRATEGY-2026-09-11-ADSMARKET. אף מערכת מקצועית לא מפרסמת מסמך אסטרטגיה שנכתב על ידי מודול AI פנימי כתוכן ציבורי.
- **נספח ראוסט פנימי.** 2026-09-11-roast-78-addendum.html - "מכתם-לשידור", נספח ביקורת מתוך שיחה פנימית. נמדד חי: 11,153 בייטים.
- **דוסייה גרסת-טיוטה של מטבע.** TOKEN-DOSSIER-2026-09-12-V77.html - "כרטיס-הזהות המלא של המטבע". הסיומת V77 היא בעצמה הודאה שזו גרסה 77 של מסמך עבודה. נמדד חי: 19,483 בייטים. Chainlink מפרסמים whitepaper; הם לעולם לא היו מפרסמים "טיוטה 77".
- **תצלומי ביקורת טענות פנימיים עם מזהי trace.** CLAIMS-AUDIT-2026-09-12.html, CLAIMS-AUDIT-PREVIEW-2026-09-12.html ועוד שלושה סבבי ביקורת (R2, R3, R6) שצורפו לפעימות. המילה PREVIEW בשם הקובץ אומרת הכל - זו הצצה פנימית לפני גמר.
- **גם ההיפך ראוי לציון כנות:** המערכות המקצועיות כן מפרסמות כישלונות - אבל בפורמט של סטטוס, post-mortem מסודר או עמוד השוואה. ההבדל הוא לא "רק דברים טובים" אלא **פורמט שנכתב לקהל חיצוני**.

### מה בדיוק חי אצלנו בזמן המדידה - הספירה המלאה

אינדקס הדוחות הפרוס (hub/docs/reports/index.html, "דוחות הרשת - הארכיון המלא") קישר בזמן המדידה ל-39 קובצי HTML, ואלו הסוגים:

| סוג חומר | כמות שנמדדה | דוגמאות שמות אמיתיים שחולצו |
|---|---|---|
| SAOS-PULSE - דוחות פעימה שעתיים ומחזוריים | 32 | SAOS-PULSE-2026-09-11-H16-SIX-OF-SIX · SAOS-PULSE-2026-09-13-R22-SURVIVABLE-HOME |
| CLAIMS-AUDIT - ביקורות טענות | 2 עצמאיות + 3 סבבים בתוך הפעימות | CLAIMS-AUDIT-2026-09-12 · CLAIMS-AUDIT-PREVIEW-2026-09-12 |
| DAILY-REPORT - דוח יומי | 2 | אחד מהם בחתימת מודול Adsmarket |
| STRATEGY - מסמך אסטרטגיה פנימי | 1 | SAOS-STRATEGY-2026-09-11-ADSMARKET |
| נספח ראוסט משיחה | 1 | 2026-09-11-roast-78-addendum |
| דוסייה מטבע בגרסת טיוטה | 1 | TOKEN-DOSSIER-2026-09-12-V77 |

הערות כנות על הספירה: ההנחייה למשימה דיברה על 33 חומרים - בשטח נמדדו 39 קישורים חיים (ההבדל נובע ככל הנראה משיטת ספירה: סבבי הביקורת שצורפו לפעימות נספרים כאן בנפרד). R61-B מסיר את החומרים במקביל, ולכן המספר זז תחת כל מי שמודד. דגימה של 4 קבצים מתוכם נבדקה חיה: כולם 200, בגדלים 11-19KB.

הקשר היסטורי שחובה לתעד: בתוך הדוחות עצמם כתובה שורת ייחוס - "הדוח שוחזר לגישה ציבורית בהוראת המפעיל (2026-09-17)". כלומר החומרים הועלו במפורש ב-R26 כדי שיהיו נקודת גישה ציבורית לארכיון הפרטי. זו הייתה החלטה מתועדת עם ייחוס sha256 לכל קובץ מקור. R61 מפרק אותה עכשיו לפי הוראת המפעיל החדשה - וזה לגיטימי לגמרי: השאלה "מה מתאים לציבור" היא שאלת בעלים, והתשובה החדשה היא שיומן משמרות הוא לא תוכן לציבור.

### איפה הבעיה לא הייתה - גם זה נמדד

מרכז התוכן שלנו מכיל גם סוגי תוכן שכן קיימים אצל המקצוענים, ובכמות שאין לזלזל בה: 7 מאמרי EN (What Is SAOS, Why Everyone Claims and Nobody Proves, The Sub-Cent Notary, Key Guardianship ועוד), מדריכים, API Reference ל-Identity API, Fact Sheet, Press Kit, Brand, עמוד השוואה כנה מול חלופות, מדיניות גילוי (disclosure-policy), עמודי שרשרת. הכשל לא היה "אין תוכן" אלא **ערבוב תוכן ציבורי בן-קהל עם חומרי-שיחות פנימיים באותו מדף ארכיון**, והצגת שניהם כ"דוחות הרשת - הארכיון המלא". פריט גבולי שראוי לאזכור: ערכת "20 פוסטים מוכנים" וחבילת מודעות - חומר שיווקי פנימי שגם אותו מערכת מקצועית הייתה משאירה מחוץ לאתר הציבורי.

---

## 3. Gap Table - טבלת פערים

### מה יש להן וחסר לנו (נכון למועד המדידה)

| פער | מה נמדד אצלן | מה נמדד אצלנו |
|---|---|---|
| דומיין שורש תקין | כל אחת מהן נטענת מהשורש של הדומיין שלה | השורש roshpinacare-sys.github.io מחזיר 404 (נמדד). האתר חי רק תחת /Console/ |
| עמודי משפטים | Privacy Policy + Terms בכל ארבע המערכות שנמדדו | אין עמוד Privacy ואין Terms בכל 92 כתובות המפה |
| עמודי תמחור | QuickNode ו-Moralis מפרסמים Pricing גלוי; האחרות "Talk to an Expert" | אין עמוד תמחור (סביר לשלב הזה, אבל זה פער מול שתיים מהן) |
| סיפורי לקוח | 16 לקוחות בשמות אצל Moralis · Customer Stories אצל OpenZeppelin ו-QuickNode | אפס לקוחות חיצוניים - אמת פשוטה של מערכת צעירה |
| קריירה | Careers בכולן | אין (מערכת של מפעיל יחיד כרגע) |
| דומיין תיעוד ייעודי | docs.chain.link · docs.openzeppelin.com · docs.blocknative.com · docs.moralis.com | יש API Reference ומדריכים בתוך ה-hub, אין דומיין/מבנה תיעוד נפרד |
| חדשות עם אירועי שוק אמיתיים | כיסוי רכישות, רגולציה, שותפויות מוסדיות | אין ערוץ חדשות חיצוני-פונה-החוצה |
| מותג ונכסי תקשורת | Brand / Brand Resources אצל Blocknative, Moralis | קיים עמוד brand ב-hub - פער קטן יחסית |
| הגנת תשתית ברמת הדלת | חסימת בוטים אגרסיבית (etherscan, tenderly, alchemy - לא ניתנות לגישה אפילו לכלי מדידה מנומס) | האתר פתוח לחלוטין לכל סורק |

### מה יש לנו ואין להן - בלי להתחנף, לפי מה שנמדד

| יתרון | מה נמדד אצלנו | מה קיים אצלן שקרוב לזה |
|---|---|---|
| מכונת אמת ציבורית שמודדת את האתר עצמו | CI ב-GitHub Actions מודד את האתר הציבורי כל שעה; פסק-דין ALL-GREEN (7 עוברים, 0 נכשלים, 2 דלוגים מתועדים); היסטוריה ציבורית של 15 ריצות כולל ריצה אדומה אחת שלא נמחקה; מזהה ריצה ב-GitHub Actions לכל מדידה | status.quicknode.com חי (200) - אבל סטטוס בלבד; ה-Benchmarks של QuickNode מודדים את השוק, לא את עצמם. אף אחת מהן לא מפרסמת היסטוריית בדיקות עצמית עם אדומים שנשמרים בכפייה |
| טריות עדות קריפטוגרפית בזמן אמת | cp#248 · 255 עדויות · גיל 0.4 שעות (נמדד בפסק-הדין החי) | אין מקבילה ציבורית בסטטוס-פייג'ים סטנדרטיים |
| SLO עם תקציבי שגיאה פומביים | 4 יעדי שירות, חלון 30 יום, יומן שריפת תקציב שלא נמחק (שער G9 ירוק, נמדד) | אצלן בדרך כלל אחוז זמינות בלבד, בלי יומן שריפה פומבי |
| דו-לשוניות מלאה EN/HE | החלפת שפה חיה בכל עמוד מערכת | אצלן אנגלית בלבד (חלקן מוסיפות שפות אסייתיות) |
| מדיניות גילוי כתובה | hub/disclosure-policy.html | OpenZeppelin מפרסמים שירותי אבטחה; מדיניות גילוי-חולשות קיימת אצל חלק מהענף - לא נמדדה אצל ארבעת אלה בעמוד הבית |

הערת כנות על היתרון המרכזי: ההשוואה ההוגנת היא שמכונת האמת שלנו היא **בגדר status page מסוג מתקדם** - היא עושה מה ש-status.quicknode.com עושה, אבל מוסיפה שכבה שאין להם: מדידה עצמית של האתר שמפרסמת את כישלונותיה ולא רק את הזמינות. זה יתרון אמיתי, אבל הוא לא תחליף לעמודי מוצר, תיעוד ולקוחות - הוא שכבת אמינות שיושבת מעל תוכן, לא מחליפה אותו.

---

## 4. What R61 Already Fixes - מה כבר מתוקן במקביל (R61-B)

נמדד בכפילויות נפרדות: **האתר הפרוס** ו**העותק העבודה** ב-/tmp/console. בזמן המדידה שלי ההבדל ביניהם הראה בדיוק איפה R61-B נמצא:

1. **תשעת עמודי המערכת חוזרים כעמודים אמיתיים.** בפרוס: עשרה עמודים בגודל 1,992-2,014 בייטים (סטאבים של R58). בעותק העבודה של R61-B כבר נמדדו הגדלים המשוחזרים: money 41,343 · net 14,598 · acid 41,635 · gate 38,931 · defi 41,176 · deposits 29,714 · readiness 30,968 · sovereign 37,840 · versus 28,965 בייטים - כולם עם acid-engine.js שחזר לשרת את acid. כלומר: הכיוון של "מפה מלאה" כבר בשלבי ביצוע, מה שנשאר הוא פריסה.
2. **roast.html מפורק לטובת truth.html החי.** roast נשאר בכוונה סטאב - תוכנו היה תמונת-מצב קפואה של ביקורת טענות, והגרסה החיה של אותו רעיון היא שער האמת שמתעדכן מדי שעה (30,001 בייטים, פסק-דין ALL-GREEN נמדד בזמן אמת). זו בדיוק ההפרדה שמערכת מקצועית הייתה עושה: תוצר חד-פעמי יוצא מהאתר; התהליך החי נשאר.
3. **39 חומרי השיחות בדרך החוצה מהאתר הציבורי.** בזמן המדידה הם עוד חיו בפרוס (דגימות נבדקו 200); בעותק העבודה הם עוד לא נמחקו - כלומר ההסרה בעיצומה. הם יישארו בהיסטוריית הגיט אבל לא יוגשו לציבור כתוכן.
4. **שער G8 נכתב מחדש** מדוקטרינת "עשרה סטאבים" לדוקטרינת "מפה מלאה" - כלומר מכונת האמת תדרוש מעתה את המצב המקצועי, לא את המצב המקוצץ.
5. **גריד הידע בעמוד הבית חוזר למפה מלאה** במקום ארבעה כרטיסים.

מה שחשוב להבין מהמבט הכפול הזה: התלונה של המפעיל ("שברים, לא אתר") תוקנה ברמת הכיוון, ובזמן כתיבת הדוח היא בדרך לפריסה. האמת המדודה נרשמת כאן לפני ואחרי, כדי שאף אחד לא יצטרך להאמין למילים.

---

## 5. What Remains for Operator Decision Only - מה נשאר להחלטת המפעיל בלבד

אלה פערים שסוכן לא יכול לסגור לבד, כי הם דורשים בעלות, כסף או סמכות שיש רק למפעיל:

1. **ריפו-שורש לדומיין.** השורש roshpinacare-sys.github.io מחזיר 404 כי אין ריפו בשם roshpinacare-sys.github.io, והטוקן שלנו חסום מליצור ריפו (נמדד ותועד ב-R61). רק המפעיל יכול ליצור אותו ידנית ב-GitHub. בלעדיו, לכל מבקר שמקליד את שם הארגון יש דלת ראשית סגורה.
2. **דומיין עצמאי או השארות תחת github.io.** שם משלנו (למשל saos.network או דומה) משנה את הנראות המקצועית יותר מכל תיקון תוכן - זה רכישה של בעלים.
3. **ריבונות VPS (OL-11).** מעבר מתשתית חינמית לשרת בבעלות - החלטת תקציב מובהקת של המפעיל. ההערכה כבר מוכנה ב-BENCHMARK.
4. **מיקום מסחרי מול מיקום תשתיתי.** הפערים "תמחור" ו"סיפורי לקוח" נסגרים רק כשיש מה למכור ולמי. אם ההחלטה היא שהמערכת היא תשתית עצמאית ללא מכירות - הפערים האלה מפסיקים להיות פערים. זו שאלה עסקית, לא הנדסית.
5. **עמודי משפטים (Privacy / Terms).** אפשר לנסח אותם טכנית, אבל מסמך משפטי שמתחייב בשם הגוף הוא חתימה של בעלים.

ושני סעיפים שכן תלויים בנו ולא במפעיל, ולכן לא נכללים ברשימת ההחלטות - רק נמנים לגילוי נאות: רצף 30 הירוקות (OL-9) ומילוי חלון ה-SLO (OL-10) נסגרים בזמן בלבד, אם המכונה תמשיך לרוץ. אין להאיץ אותם בעבודה; הם הוכחה שנצברת לבד.

---

## Bottom Line for the Operator - שורה תחתונה

המפעיל צדק באבחנה המרכזית, והיא נמדדה במספרים: 39 מתוך 39 הקישורים בארכיון הדוחות הציבורי שלנו היו חומרי-שיחות פנימיים - פעימות משמרת, טיוטות מודול שיווק, נספח ראוסט, דוסייה בגרסה 77. שום מערכת מקצועית שנמדדה כאן לא הייתה מפרסמת אף אחד מהם. במקביל, לא נכון לומר ש"אין לנו כלום": יש לנו hub עם סוגי תוכן לגיטימיים, ויש לנו שכבת אמינות ציבורית שחזקה מסטטוס-פייג'ים של המקצוענים דווקא במקום שבו הם חלשים - מדידה עצמית פומבית עם היסטוריית אדומים שלא נמחקת. העבודה של R61 מסלקת את החומרים הלא-מקצועיים ומחזירה את תשעת עמודי המערכת כעמודים מלאים; מה שנשאר בידי המפעיל הוא הדלת הראשית (ריפו-שורש ודומיין), הריבונות (VPS) וההחלטה העסקית לגבי מה אנחנו בשביל העולם.

*דוח R61-A · כל המדידות נערכו ידנית מול הכתובות הציבוריות ב-2026-09-19 · קבצי ה-HTML הגולמיים נשמרו בסנדבוקס לצורך אימות חוזר.*
