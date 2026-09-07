/**
 * TFA Frontend Component Primitives — canonical kit.
 *
 * Four primitive components (Button, Input, Table, Card) × six states
 * (hover / focus / active / disabled / loading / empty).
 * All colours are OKLCH semantic tokens. Zero runtime dependencies.
 */

export type {
  ComponentState,
  ButtonVariant,
  ButtonSpec,
  InputType,
  InputSpec,
  TableSortDir,
  TableColumn,
  TableRow,
  TableSpec,
  CardKind,
  VerdictKind,
  CardSpec,
} from "./types.ts";

export { ALL_STATES } from "./types.ts";

export type { BuildButtonOptions } from "./button.ts";
export { buildButton, buildButtonKit } from "./button.ts";

export type { BuildInputOptions } from "./input.ts";
export { buildInput, buildInputKit } from "./input.ts";

export type { BuildTableOptions } from "./table.ts";
export { buildTable, buildTableKit } from "./table.ts";

export type { BuildCardOptions } from "./card.ts";
export { buildCard, buildCardKit } from "./card.ts";

export {
  renderButtonHtml,
  renderInputHtml,
  renderTableHtml,
  renderCardHtml,
} from "./render-html.ts";
