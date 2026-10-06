#!/bin/bash
# בדיקה חזותית של כל הצילומים עם VLM
cd /home/z/my-project/scan-results/shots
PROMPT='You are a strict UI QA inspector. This is a full-page screenshot of a Hebrew RTL web dashboard (dark theme). List ONLY concrete visual defects you can SEE: overlapping elements, text cut off mid-word/character at container edges, broken layout, misaligned rows, empty/blank sections that look like missing data, illegible contrast, elements overflowing cards. Name each defect location precisely. If none, answer exactly CLEAN. Terse bullets, English.'

for f in *.png; do
  name="${f%.png}"
  echo "=== $name ===" 
  z-ai vision -p "$PROMPT" -i "$f" -o "/tmp/vlm-$name.json" > /dev/null 2>&1
  # extract content
  node -e "
    try {
      const j = require('/tmp/vlm-$name.json');
      const c = j.choices?.[0]?.message?.content || 'NO-CONTENT';
      console.log(c);
    } catch(e) { console.log('PARSE-FAIL'); }
  "
done
echo "ALL-INSPECTED"
