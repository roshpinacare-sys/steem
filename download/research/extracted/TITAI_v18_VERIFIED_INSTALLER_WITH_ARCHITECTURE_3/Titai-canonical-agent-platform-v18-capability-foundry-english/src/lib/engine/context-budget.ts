import type { ChatMessage } from "./types";

export interface ContextBudgetResult {
  messages: ChatMessage[];
  originalChars: number;
  selectedChars: number;
  droppedMessages: number;
  truncatedMessages: number;
}

function messageChars(message: ChatMessage): number {
  return message.content.length + JSON.stringify(message.toolCalls ?? []).length;
}

function truncateMessage(message: ChatMessage, maxChars: number): ChatMessage {
  if (message.content.length <= maxChars) return message;
  const marker = "\n[content truncated by context budget]";
  const keep = Math.max(0, maxChars - marker.length);
  return { ...message, content: message.content.slice(0, keep) + marker };
}

/**
 * Preserve the system and objective messages, then keep the newest complete
 * assistant/tool segments that fit. This prevents old tool transcripts from
 * evicting current policy and task context.
 */
export function applyContextBudget(
  messages: ChatMessage[],
  maxChars: number,
): ContextBudgetResult {
  const budget = Math.max(2_000, maxChars);
  const originalChars = messages.reduce((sum, message) => sum + messageChars(message), 0);
  if (originalChars <= budget) {
    return {
      messages: structuredClone(messages),
      originalChars,
      selectedChars: originalChars,
      droppedMessages: 0,
      truncatedMessages: 0,
    };
  }

  const mandatory = messages.slice(0, Math.min(2, messages.length));
  const optional = messages.slice(mandatory.length);
  const selectedMandatory: ChatMessage[] = [];
  let used = 0;
  let truncatedMessages = 0;

  for (const message of mandatory) {
    const remaining = Math.max(256, budget - used);
    const truncated = truncateMessage(message, remaining);
    if (truncated.content !== message.content) truncatedMessages += 1;
    selectedMandatory.push(truncated);
    used += messageChars(truncated);
  }

  const segments: ChatMessage[][] = [];
  let current: ChatMessage[] = [];
  for (const message of optional) {
    if (message.role === "assistant") {
      if (current.length) segments.push(current);
      current = [message];
    } else if (current.length) {
      current.push(message);
    } else {
      segments.push([message]);
    }
  }
  if (current.length) segments.push(current);

  const selectedSegments: ChatMessage[][] = [];
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    const chars = segment.reduce((sum, message) => sum + messageChars(message), 0);
    if (used + chars <= budget) {
      selectedSegments.unshift(structuredClone(segment));
      used += chars;
      continue;
    }
    if (selectedSegments.length === 0 && budget - used >= 256) {
      const first = truncateMessage(segment[0], budget - used);
      if (first.content !== segment[0].content) truncatedMessages += 1;
      selectedSegments.unshift([first]);
      used += messageChars(first);
    }
    break;
  }

  const selected = [...selectedMandatory, ...selectedSegments.flat()];
  return {
    messages: selected,
    originalChars,
    selectedChars: selected.reduce((sum, message) => sum + messageChars(message), 0),
    droppedMessages: messages.length - selected.length,
    truncatedMessages,
  };
}
