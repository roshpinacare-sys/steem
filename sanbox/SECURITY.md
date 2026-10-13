# SECURITY — מודל-איום של מישור-sanbox (כנות מלאה)

## מה מוגן ואיך
| משטח | הגנה |
|---|---|
| אתר-מפעיל (:3046) | שער scrypt (N=16384, r=8, p=1, keylen=64) · cookie `HttpOnly; SameSite=Strict; Path=/` · rate-limit 5 ניסיונות/5 דק' · binding loopback בלבד |
| אתחול-ראשוני | חלון-מוגבל בזמן (ברירת-מחדל 20 דק' מעלייה) · מינימום 8 תווים · אישור-כפול |
| גישת-סוכנים | token 192-bit ב-`state/agent-token` (git-ignored, mode 600, לא מוחזר ב-HTTP, לא בלוגים) |
| ריפו | `state/*` git-ignored נאכף (ונבדק ב-verify) · סריקת-דפוסי-סודות ב-verify.sh · gitleaks קיים בשורש |
| פעולות-ריצה | whitelist סגור: bootstrap / verify / push בלבד — אין eval, אין קלט-משתמש ב-shell |
| headers | `Cache-Control: no-store` · `X-Content-Type-Options: nosniff` · `Referrer-Policy: no-referrer` |

## מה מודע-ולא-מוגן (כנות, לא קישוט)
- פורטי-הצי (3040-3043) אינם דורשים אימות-HTTP — הם מחזירים מצב-ציבורי בלבד (השרשרת ציבורית ממילא). גישה: loopback ושער-Caddy בלבד.
- cockpit (:3000) פתוח לתצוגה — אין מאחוריו סודות.
- ה-hash של הסיסמה חי ב-`state/` (git-ignored). **אסור** לעשות לו commit לפני החלטת-מפעיל מפורשת — סיכון brute-force אופליין אם הסיסמה חלשה.
- ה-rate-limit בזיכרון — איפוס בהפעלה-מחדש (מתועד, לא מוסתר).
- סשנים בזיכרון — restart = התחברות-מחדש (מכוון: פשטות > state-מיותר).

## חוקי-סודות
1. סיסמה/טוקן/PAT לעולם לא בקוד, בריפו, בלוג, או בפלט-כלי.
2. קבצי-סודות: `sanbox/state/*` בלבד (git-ignored, chmod 600).
3. דליפה-חשודה: מחיקת `state/credentials.json` + אתחול-חדש + תיעוד ב-worklog.
4. אתחול-headless (סוכנים): `auth/gen-hash.sh` עם `OPERATOR_BOOTSTRAP_PASSWORD` בסביבה — הסיסמה לא נוגעת בדיסק כטקסט.
