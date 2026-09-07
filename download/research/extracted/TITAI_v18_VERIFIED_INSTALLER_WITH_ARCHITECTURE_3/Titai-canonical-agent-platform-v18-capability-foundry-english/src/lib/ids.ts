import { createId as cuid } from "@paralleldrive/cuid2";

export function createId(): string {
  return cuid();
}
