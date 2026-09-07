# מסמך דרישות

## 1. סקירת האפליקציה

### שם האפליקציה
qodo-v24 Upgrade - מערכת AI Agent אוטונומית לקוד

### תיאור
שדרוג מסיבי של מערכת qodo-v24 הקיימת - AI agent אוטונומי שפועל על GitHub Actions לביצוע code review ו-implementation אוטומטיים. השדרוג כולל הוספת Mission Control Dashboard (אפליקציית ווב לניהול), שיפורים ארכיטקטוריים ב-pipeline, שיפורי DX, אבטחה, AI, observability ו-testing.

## 2. משתמשים ותרחישי שימוש

### משתמשי יעד
- DevOps engineers
- Senior developers
- Open source maintainers

### תרחישי שימוש עיקריים
- ניהול ומעקב אחר pipeline runs בזמן אמת
- ניתוח עלויות ושימוש ב-tokens
- אישור/דחייה של commits ממתינים
- ניהול skills registry
- הרצה מקומית ו-testing של המערכת
- מעקב אחר security ו-compliance

## 3. מבנה דפים ותיאור פונקציונליות

### מבנה כללי
```
qodo-v24 Upgrade
├── Mission Control Dashboard (אפליקציית ווב)
│   ├── Pipeline Runs View
│   ├── Cost Analytics
│   ├── PR History
│   ├── Skill Registry UI
│   └── Mentor Approval Interface
├── Pipeline Enhancements (שיפורי backend)
│   ├── Multi-step Coder
│   ├── Streaming Patches
│   ├── Smart Retry
│   ├── Diff Conflict Detection
│   └── Incremental File Map
├── CLI Interactive Mode
├── Security Enhancements
│   ├── SBOM Generation
│   ├── License Checker
│   ├── CVE Scanner
│   ├── Audit Log
│   └── Permission Scoping
├── AI Strategy Improvements
│   ├── Multi-model Consensus
│   ├── Confidence Scoring
│   ├── Prompt Versioning
│   ├── Skill Auto-discovery
│   └── Context Window Optimization
├── Observability & Monitoring
│   ├── OpenTelemetry Traces
│   ├── Prometheus Metrics
│   ├── Alerting Rules
│   └── SLO Definitions
└── Testing & Quality
    ├── Property-based Testing
    ├── Snapshot Testing
    ├── Load Testing
    └── Coverage Enforcement
```

### 3.1 Mission Control Dashboard

#### 3.1.1 Pipeline Runs View
- הצגת כל pipeline runs פעילים ועבר
- ציר זמן אינטראקטיבי המציג את 11 ה-phases: idle → architect → coder → gate → commit → astdoc → canary → merge → postmerge → review → done
- Live log streaming מ-Axiom או Redis event stream
- סטטוס real-time של כל run: running/success/failure/pending
- פירוט agents פעילים בכל phase

#### 3.1.2 Cost Analytics
- גרפים של token usage לאורך זמן
- עלות בדולרים per run
- Breakdown של עלויות per agent (architect, coder, reviewer, meta-agent, warden, darwin-engine, compliance-oracle, context-enricher, infra-oracle, janitor, style-aligner, ui-synthesizer)
- השוואה בין runs שונים

#### 3.1.3 PR History
- רשימת כל ה-runs עם success/failure status
- Diff viewer להצגת שינויים בקוד
- קישור ל-PR המקורי ב-GitHub
- פילטר לפי תאריך, סטטוס, branch

#### 3.1.4 Skill Registry UI
- הצגת רשימת skills קיימים
- הוספת skill חדש: שם, תיאור, קוד
- עריכת skill קיים
- מחיקת skill
- חיפוש וסינון skills

#### 3.1.5 Mentor Approval Interface
- הצגת commits ממתינים לאישור
- הצגת diff של כל commit
- כפתורי אישור/דחייה
- הוספת הערות לcommit
- היסטוריית אישורים/דחיות

### 3.2 Pipeline Enhancements

#### 3.2.1 Multi-step Coder
- הcoder מחלק משימה גדולה למספר steps מקביליים
- יצירת dependency graph בין steps
- ביצוע steps במקביל כשאין תלות
- איחוד תוצאות לpatch אחד

#### 3.2.2 Streaming Patches
- קבלת תוצאות מ-Groq בstreaming במקום המתנה לתגובה מלאה
- הצגת progress בזמן אמת
- שמירת partial results ב-Redis

#### 3.2.3 Smart Retry with Context
- כאשר warden דוחה patch, העברת context של הדחייה לcoder
- כולל snippet מדויק של הבעיה
- coder מתקן את הבעיה ומנסה שוב

#### 3.2.4 Diff Conflict Detection
- לפני commit, בדיקה שהpatch לא מתנגש עם commits חדשים ב-main branch
- זיהוי conflicts אוטומטי
- התראה למשתמש במקרה של conflict

#### 3.2.5 Incremental File Map
- cartographer שומר cache של file map
- עדכון רק קבצים שהשתנו במקום סריקה מלאה
- שמירת cache ב-Redis או R2

### 3.3 CLI Interactive Mode
- הרצת `node cli.ts --interactive`
- prompts אינטראקטיביים לבחירת פעולות
- הצגת תפריט עם אפשרויות: run pipeline, view status, manage skills, approve commits
- ממשק ידידותי עם צבעים ו-formatting

### 3.4 Local Dev Mode
- הרצה מקומית ללא GitHub Actions
- mock של GitHub API
- שימוש ב-local files במקום repository
- debugging מקומי

### 3.5 Hot Reload Config
- שינוי env vars בזמן ריצה
- טעינה מחדש של config ללא restart
- validation של config חדש לפני החלפה

### 3.6 Progress Bar
- הצגת progress bar ב-terminal
- spinners לכל phase
- אחוזי התקדמות
- זמן משוער לסיום

### 3.7 Dry Run Mode
- הרצת `--dry-run`
- הצגת מה היה קורה ללא ביצוע commit בפועל
- הצגת patches שהיו נוצרים
- הצגת validation results

### 3.8 Security Enhancements

#### 3.8.1 SBOM Generation
- יצירת Software Bill of Materials לכל dependency בpatch
- רשימת כל packages עם גרסאות
- שמירה כקובץ JSON

#### 3.8.2 License Checker
- בדיקת licenses של packages חדשים
- השוואה ל-policy מוגדר
- התראה על licenses לא מאושרים
- חסימת commit במקרה של license לא תואם

#### 3.8.3 CVE Scanner
- סריקת vulnerabilities בdependencies חדשות
- שימוש במאגרי CVE
- התראה על vulnerabilities קריטיים
- המלצה על גרסאות מתוקנות

#### 3.8.4 Audit Log
- רישום כל פעולה ב-append-only log
- cryptographic hash chain לכל entry
- שמירה ב-R2 או Upstash
- אי-אפשרות למחיקה או שינוי

#### 3.8.5 Permission Scoping
- הגדרת אילו files ה-agent יכול לגעת
- config file עם whitelist/blacklist של paths
- validation לפני כל file operation
- התראה על ניסיון גישה לfile אסור

### 3.9 AI Strategy Improvements

#### 3.9.1 Multi-model Consensus
- שליחת request לשני models שונים (Groq + OpenRouter)
- השוואת תוצאות
- קבלת consensus לפני יצירת patch
- במקרה של אי-הסכמה, escalation ל-human review

#### 3.9.2 Confidence Scoring
- כל patch מקבל confidence score (0-100)
- חישוב לפי: model certainty, code complexity, test coverage
- patches עם score נמוך → human review
- הצגת score ב-dashboard

#### 3.9.3 Prompt Versioning
- שמירת גרסאות של prompts עם changelog
- A/B testing אוטומטי בין גרסאות
- מעקב אחר performance של כל גרסה
- rollback לגרסה קודמת במקרה של בעיה

#### 3.9.4 Skill Auto-discovery
- agent שמחפש patterns בrepo
- זיהוי אוטומטי של skills חדשים
- הצעת skills למשתמש לאישור
- הוספה אוטומטית ל-skill registry

#### 3.9.5 Context Window Optimization
- בחירה חכמה יותר של אילו files לשלוח ל-context
- prioritization לפי relevance
- דחיסת context כשצריך
- שימוש ב-semantic-cache לחיסכון בtokens

### 3.10 Observability & Monitoring

#### 3.10.1 OpenTelemetry Traces
- distributed tracing לכל pipeline phase
- מעקב אחר latency של כל agent
- זיהוי bottlenecks
- ייצוא ל-Axiom או Jaeger

#### 3.10.2 Prometheus Metrics Endpoint
- חשיפת metrics endpoint
- latency, error rates, token usage כ-metrics
- scraping על ידי Prometheus
- יצירת dashboards ב-Grafana

#### 3.10.3 Alerting Rules
- הגדרת alerts: cost spike, high error rate, lock contention
- שליחת התראות ל-Slack/email/PagerDuty
- threshold מוגדר לכל alert
- auto-resolution כשהבעיה נפתרת

#### 3.10.4 SLO Definitions
- הגדרת Service Level Objectives: 90% runs complete <15 min
- מעקב אחר SLO compliance
- דוחות תקופתיים
- התראה כש-SLO לא מתקיים

### 3.11 Testing & Quality

#### 3.11.1 Property-based Testing
- שימוש ב-fast-check
- testing של edge cases בvalidators (blast-radius, dom-xray, shadow-traffic, lockfile-guardian, chaos-monkey, secret-guard)
- יצירת test cases אוטומטית
- זיהוי bugs שלא נתפסו ב-unit tests

#### 3.11.2 Snapshot Testing
- snapshot testing ל-AI outputs
- baseline comparison
- זיהוי שינויים לא צפויים
- אישור/דחייה של snapshots חדשים

#### 3.11.3 Load Testing
- k6 scripts להרצת pipeline תחת עומס
- סימולציה של מספר runs מקבילים
- מדידת throughput ו-latency
- זיהוי נקודות כשל

#### 3.11.4 Coverage Enforcement
- Istanbul/v8 coverage
- threshold מינימלי (80%)
- enforcement ב-CI
- דוחות coverage מפורטים

## 4. כללים עסקיים ולוגיקה

### 4.1 Pipeline Flow
- Pipeline עובר דרך 11 phases לפי הסדר: idle → architect → coder → gate → commit → astdoc → canary → merge → postmerge → review → done
- כל phase מופעל על ידי agent מתאים
- מעבר ל-phase הבא רק לאחר הצלחה
- במקרה של כשלון, retry או escalation ל-human

### 4.2 Cost Tracking
- כל קריאה ל-AI מתועדת עם token count
- חישוב עלות לפי מחירון Groq/OpenRouter
- צבירת עלויות per run, per agent, per day
- שמירה ב-cost-tracker service

### 4.3 Mentor Approval Flow
- commits מסוימים דורשים אישור mentor
- commit ממתין ב-queue עד לאישור
- mentor רואה diff ויכול לאשר/לדחות
- במקרה של דחייה, context מועבר לcoder לתיקון

### 4.4 Security Validation
- כל patch עובר דרך validators: blast-radius, dom-xray, shadow-traffic, lockfile-guardian, chaos-monkey, secret-guard
- כל validator מחזיר pass/fail
- במקרה של fail, הpatch נחסם
- warden מקבל החלטה סופית

### 4.5 Skill Management
- skills מאוחסנים ב-skill registry
- כל skill כולל: שם, תיאור, קוד
- agents יכולים להשתמש ב-skills בזמן ריצה
- skills יכולים להתווסף/להשתנות/להימחק דרך UI או API

### 4.6 State Management
- RunState נשמר ב-Redis (Upstash)
- כל שינוי ב-state מתועד
- state כולל: current phase, agents status, logs, errors
- state נשמר גם ב-R2 לarchive

### 4.7 Caching Strategy
- semantic-cache (Upstash Vector) לשמירת תוצאות AI
- file map cache ב-Redis
- invalidation כשקבצים משתנים
- TTL מוגדר לכל cache entry

### 4.8 Error Handling
- circuit-breaker למניעת overload של services
- retry logic עם exponential backoff
- fallback ל-model אחר במקרה של כשלון
- logging מפורט ל-Axiom

### 4.9 Canary Deployment
- patch נבדק ב-canary environment (Vercel)
- הרצת tests אוטומטיים
- במקרה של הצלחה, merge ל-main
- במקרה של כשלון, rollback

### 4.10 Compliance
- compliance-oracle בודק עמידה בstandards
- בדיקת licenses, security, code style
- דוח compliance לכל run
- חסימת merge במקרה של אי-עמידה

## 5. חריגים ומקרי קצה

| מקרה | טיפול |
|------|-------|
| AI model לא זמין | fallback ל-model אחר, אם גם הוא לא זמין → fail gracefully עם הודעה למשתמש |
| Redis connection timeout | retry 3 פעמים, אם נכשל → שמירה זמנית ב-memory ו-sync מאוחר יותר |
| R2 storage full | התראה למשתמש, מחיקת files ישנים לפי retention policy |
| Conflict ב-diff | התראה למשתמש, הצעת merge manual |
| Validator נכשל | חסימת commit, הצגת error message מפורט |
| Cost spike מעל threshold | התראה למשתמש, השהיית runs חדשים עד לאישור |
| License לא מאושר | חסימת commit, הצעת alternative packages |
| CVE קריטי נמצא | חסימת commit, המלצה על גרסה מתוקנת |
| Permission violation | חסימת פעולה, logging ל-audit log, התראה למשתמש |
| Confidence score נמוך | escalation ל-human review, הצגת patch לאישור |
| Multi-model disagreement | escalation ל-human review, הצגת שתי התוצאות |
| OpenTelemetry export failure | logging מקומי, retry export מאוחר יותר |
| Prometheus scrape timeout | המשך פעולה רגילה, metrics יאספו בscrape הבא |
| Alert storm | rate limiting של alerts, aggregation של alerts דומים |
| SLO breach | התראה למשתמש, דוח מפורט של הסיבה |
| Load test failure | זיהוי bottleneck, המלצות לשיפור |
| Coverage מתחת ל-threshold | fail ב-CI, דרישה להוספת tests |

## 6. קריטריוני קבלה

1. משתמש נכנס ל-Mission Control Dashboard ורואה רשימת pipeline runs פעילים עם ציר זמן אינטראקטיבי
2. משתמש לוחץ על run ספציפי ורואה live logs streaming בזמן אמת
3. משתמש נכנס ל-Cost Analytics ורואה גרפים של token usage ועלויות per agent
4. משתמש נכנס ל-Skill Registry UI, מוסיף skill חדש, ורואה אותו ברשימה
5. משתמש נכנס ל-Mentor Approval Interface, רואה commit ממתין, מאשר אותו, והcommit עובר ל-merge
6. משתמש מריץ `node cli.ts --interactive` ורואה תפריט אינטראקטיבי עם אפשרויות
7. משתמש מריץ pipeline ב-local dev mode ורואה שהוא פועל ללא GitHub Actions
8. משתמש משנה env var בזמן ריצה והמערכת טוענת את השינוי ללא restart
9. משתמש מריץ `--dry-run` ורואה מה היה קורה ללא commit בפועל
10. משתמש רואה SBOM נוצר אוטומטית לכל patch עם רשימת dependencies
11. משתמש רואה התראה כש-license לא מאושר נמצא בpatch
12. משתמש רואה CVE scanner מזהה vulnerability ומציע גרסה מתוקנת
13. משתמש רואה audit log עם כל הפעולות ו-hash chain
14. משתמש רואה שpatch נחסם כשמנסה לגעת בfile אסור
15. משתמש רואה שני models מסכימים על patch לפני יצירתו
16. משתמש רואה confidence score לכל patch ו-escalation ל-human review כשהוא נמוך
17. משתמש רואה A/B testing של prompt versions עם performance metrics
18. משתמש רואה skill auto-discovery מציע skills חדשים לאישור
19. משתמש רואה OpenTelemetry traces ב-Jaeger עם latency של כל phase
20. משתמש רואה Prometheus metrics ב-Grafana עם error rates ו-token usage
21. משתמש מקבל alert כש-cost spike מתרחש
22. משתמש רואה SLO compliance report עם אחוז runs שעמדו ב-SLO
23. משתמש מריץ property-based tests עם fast-check ורואה edge cases נתפסים
24. משתמש מריץ snapshot tests ורואה השוואה ל-baseline
25. משתמש מריץ load tests עם k6 ורואה throughput ו-latency תחת עומס
26. משתמש רואה coverage report עם אחוז מעל threshold

## 7. פונקציונליות שלא תיושם בשלב זה

- אינטגרציה עם GitLab/Bitbucket (רק GitHub)
- תמיכה ב-languages נוספים מעבר ל-TypeScript
- Mobile app ל-Mission Control Dashboard
- Real-time collaboration בין מספר mentors
- AI model training/fine-tuning
- Custom validators שמשתמשים יכולים לכתוב
- Integration עם Jira/Linear לניהול tasks
- Automated rollback של patches שנכשלו בproduction
- Multi-tenant support
- White-label solution
- On-premise deployment
- SAML/SSO authentication
- Role-based access control (RBAC) מתקדם
- Webhook notifications לכל event
- GraphQL API
- SDK ל-languages אחרים
- Browser extension ל-GitHub
- Slack bot לניהול pipeline
- Email notifications מפורטות
- PDF reports
- Data export ל-CSV/Excel
- Custom dashboards
- Multi-region deployment
- Disaster recovery automation
- Automated scaling
- Cost optimization recommendations
- AI model comparison tool
- Prompt playground
- Skill marketplace
- Community-contributed skills
- Plugin system
- Third-party integrations (Datadog, New Relic, etc.)