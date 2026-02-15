import type { Task } from "./types.js";

export function buildTaskContext(task: Task): string {
  const stepsText = task.steps.length > 0
    ? task.steps.map((s, i) => {
        const marker = s.done ? "✓" : (i === task.steps.findIndex(st => !st.done) ? "→" : "○");
        return `${i + 1}. ${marker} ${s.title}`;
      }).join("\n")
    : "(no steps defined)";

  return `<Task>
You are working on the following task. Focus solely on progressing this task. Do not work on anything else.

Title: ${task.title}
Description: ${task.description}
Status: ${task.status}
Owner: ${task.owner}
Steps:
${stepsText}
</Task>`;
}
