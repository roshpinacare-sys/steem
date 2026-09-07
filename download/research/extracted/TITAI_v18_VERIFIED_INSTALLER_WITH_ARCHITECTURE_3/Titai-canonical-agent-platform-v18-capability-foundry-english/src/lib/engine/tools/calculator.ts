import type { ToolDef } from "../types";

/**
 * Safe arithmetic via a shunting-yard evaluator — no eval, no Function.
 * Supports + - * / % ^, parentheses, and unary minus.
 */

type Token = { type: "num"; value: number } | { type: "op"; value: string } | { type: "paren"; value: "(" | ")" };

const PRECEDENCE: Record<string, number> = {
  "+": 1,
  "-": 1,
  "*": 2,
  "/": 2,
  "%": 2,
  "^": 3,
  "u-": 4,
};
const RIGHT_ASSOC = new Set(["^", "u-"]);

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let prevType: string | null = null;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " ") {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let num = "";
      while (i < input.length && /[0-9.]/.test(input[i])) num += input[i++];
      const value = Number(num);
      if (Number.isNaN(value)) throw new Error(`Invalid number: ${num}`);
      tokens.push({ type: "num", value });
      prevType = "num";
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "paren", value: "(" });
      prevType = "paren(";
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "paren", value: ")" });
      prevType = "paren)";
      i++;
      continue;
    }
    if ("+-*/%^".includes(ch)) {
      if (ch === "-" && (prevType === null || prevType === "op" || prevType === "paren(")) {
        tokens.push({ type: "op", value: "u-" });
      } else {
        tokens.push({ type: "op", value: ch });
      }
      prevType = "op";
      i++;
      continue;
    }
    throw new Error(`Unexpected character: ${ch}`);
  }
  return tokens;
}

function evaluate(expression: string): number {
  const tokens = tokenize(expression);
  const output: Token[] = [];
  const ops: Token[] = [];

  for (const token of tokens) {
    if (token.type === "num") {
      output.push(token);
    } else if (token.type === "op") {
      while (
        ops.length &&
        ops[ops.length - 1].type === "op" &&
        ((RIGHT_ASSOC.has(token.value) &&
          PRECEDENCE[(ops[ops.length - 1] as { value: string }).value] > PRECEDENCE[token.value]) ||
          (!RIGHT_ASSOC.has(token.value) &&
            PRECEDENCE[(ops[ops.length - 1] as { value: string }).value] >= PRECEDENCE[token.value]))
      ) {
        output.push(ops.pop()!);
      }
      ops.push(token);
    } else if (token.value === "(") {
      ops.push(token);
    } else {
      while (ops.length && !(ops[ops.length - 1].type === "paren")) {
        output.push(ops.pop()!);
      }
      if (!ops.length) throw new Error("Mismatched parentheses");
      ops.pop();
    }
  }
  while (ops.length) {
    const op = ops.pop()!;
    if (op.type === "paren") throw new Error("Mismatched parentheses");
    output.push(op);
  }

  const stack: number[] = [];
  for (const token of output) {
    if (token.type === "num") {
      stack.push(token.value);
    } else if (token.value === "u-") {
      const a = stack.pop();
      if (a === undefined) throw new Error("Invalid expression");
      stack.push(-a);
    } else {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) throw new Error("Invalid expression");
      switch (token.value) {
        case "+": stack.push(a + b); break;
        case "-": stack.push(a - b); break;
        case "*": stack.push(a * b); break;
        case "/": stack.push(a / b); break;
        case "%": stack.push(a % b); break;
        case "^": stack.push(a ** b); break;
        default: throw new Error(`Unknown operator: ${token.value}`);
      }
    }
  }
  if (stack.length !== 1) throw new Error("Invalid expression");
  return stack[0];
}

export const calculatorTool: ToolDef = {
  name: "calculator",
  description:
    "Evaluate a basic arithmetic expression (+, -, *, /, %, ^, parentheses).",
  risk: "low",
  schemaVersion: 1,
  effect: "read",
  idempotency: "intrinsic",
  network: false,
  filesystem: false,
  timeoutMs: 2000,
  maxOutputBytes: 10000,
  parameters: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description: "The arithmetic expression to evaluate, e.g. '42 * 3 + 7'.",
        minLength: 1,
        maxLength: 500,
      },
    },
    required: ["expression"],
    additionalProperties: false,
  },
  async execute(args) {
    const expr = String(args.expression ?? "");
    try {
      const result = evaluate(expr);
      return { ok: true, output: { expression: expr, result } };
    } catch (err) {
      return {
        ok: false,
        output: null,
        error: err instanceof Error ? err.message : "Evaluation failed",
      };
    }
  },
};

export { evaluate as evaluateExpression };
