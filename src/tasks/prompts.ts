import type { Task } from "./types.js";

export const TASK_WORK_PROMPT = `Check your current task status and take appropriate action:

1. Review the task details in the <Task> block above
2. Check your progress against the steps
3. If steps are not defined, create a plan with update_steps
4. Work on the next incomplete step
5. Update step status as you make progress
6. If you need user input, set status to "waiting" and explain what you need
7. If complete, use complete_task to finish

Focus on making concrete progress. Be thorough but efficient.`;

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
