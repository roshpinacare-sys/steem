---
name: xlsx
description: Authoring and editing .xlsx files via openpyxl/pandas. Trigger on requests to generate or modify spreadsheets, financial models, or tabular reports.
type: feature
---

# xlsx skill (V225 placeholder)

Stub skill — V225 ships the skill loader contract (a folder with `SKILL.md`). The actual xlsx tooling (Python via `openpyxl`, formula recalculation, financial-model conventions) is documented in the host knowledge base under `skill/xlsx`. V226 will wire `loadSkills225()` to inject the matched skill body into the agent system prompt.

Key rules to surface when this skill matches:

- Use formulas, never hard-coded calculated values.
- Always recalculate via the bundled `recalculate_formulas.py` before delivery.
- Inputs blue, formulas black, cross-sheet links green.
