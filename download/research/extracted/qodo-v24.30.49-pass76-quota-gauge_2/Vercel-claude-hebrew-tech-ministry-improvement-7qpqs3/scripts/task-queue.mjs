#!/usr/bin/env node
// scripts/task-queue.mjs
//
// Small, dependency-free helper for tasks/agent-task-queue.json. Intended
// for an agent (or human) picking up this repo to find the next eligible
// task without hand-parsing JSON, and to update task status consistently
// (status + completedInPass + updatedAt) instead of ad-hoc edits.
//
// Usage:
//   node scripts/task-queue.mjs list                 # show all tasks, grouped by status
//   node scripts/task-queue.mjs next                 # show the single highest-priority eligible task
//   node scripts/task-queue.mjs start <id>            # mark a queued task as in-progress (status: "in-progress")
//   node scripts/task-queue.mjs done <id> <passNumber> # mark a task done, recording which pass closed it
//
// Exit code 0 on success, 1 on any usage/lookup error.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const QUEUE_PATH = resolve(process.cwd(), "tasks/agent-task-queue.json");

function loadQueue() {
  return JSON.parse(readFileSync(QUEUE_PATH, "utf8"));
}

function saveQueue(queue) {
  queue.updatedAt = new Date().toISOString();
  writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + "\n");
}

function isEligible(task, queue) {
  if (task.status !== "queued") return false;
  return task.blockedBy.every((depId) => {
    const dep = queue.tasks.find((t) => t.id === depId);
    return dep && dep.status === "done";
  });
}

function cmdList(queue) {
  const byStatus = { "in-progress": [], queued: [], blocked: [], done: [] };
  for (const t of queue.tasks) (byStatus[t.status] ??= []).push(t);

  for (const status of ["in-progress", "queued", "blocked", "done"]) {
    const tasks = byStatus[status] || [];
    if (tasks.length === 0) continue;
    console.log(`\n${status.toUpperCase()} (${tasks.length})`);
    for (const t of tasks.sort((a, b) => a.priority - b.priority)) {
      const eligible = status === "queued" && isEligible(t, queue) ? " [eligible now]" : "";
      console.log(`  ${t.id}  p${t.priority}  ${t.title}${eligible}`);
    }
  }
}

function cmdNext(queue) {
  const eligible = queue.tasks
    .filter((t) => isEligible(t, queue))
    .sort((a, b) => a.priority - b.priority);

  if (eligible.length === 0) {
    console.log("No eligible task: everything queued is blocked, or the queue is empty/done.");
    return;
  }
  const t = eligible[0];
  console.log(`Next task: ${t.id} — ${t.title}`);
  console.log(`Priority: ${t.priority}`);
  console.log(`Summary: ${t.summary}`);
  console.log(`Why hard: ${t.whyHard}`);
  if (t.notes) console.log(`Notes: ${t.notes}`);
}

function cmdStart(queue, id) {
  const t = queue.tasks.find((x) => x.id === id);
  if (!t) { console.error(`No such task: ${id}`); process.exitCode = 1; return; }
  if (!isEligible(t, queue)) {
    console.error(`Task ${id} is not eligible to start (status="${t.status}", check blockedBy).`);
    process.exitCode = 1;
    return;
  }
  t.status = "in-progress";
  saveQueue(queue);
  console.log(`${id} marked in-progress.`);
}

function cmdDone(queue, id, passNumber) {
  const t = queue.tasks.find((x) => x.id === id);
  if (!t) { console.error(`No such task: ${id}`); process.exitCode = 1; return; }
  if (!passNumber) {
    console.error("Usage: node scripts/task-queue.mjs done <id> <passNumber>");
    process.exitCode = 1;
    return;
  }
  t.status = "done";
  t.completedInPass = Number(passNumber);
  saveQueue(queue);
  console.log(`${id} marked done (Pass ${passNumber}). Remember to also update 06-CHANGELOG.md in the same pass.`);
}

function main() {
  const [, , cmd, arg1, arg2] = process.argv;
  const queue = loadQueue();

  switch (cmd) {
    case "list": return cmdList(queue);
    case "next": return cmdNext(queue);
    case "start": return cmdStart(queue, arg1);
    case "done": return cmdDone(queue, arg1, arg2);
    default:
      console.error("Usage: node scripts/task-queue.mjs <list|next|start|done> [args]");
      process.exitCode = 1;
  }
}

main();
