export function getProjectReviewPrompt(projectTitle: string): string {
  return `Manage project "${projectTitle}" as the project lead:

1. Get the project details and review current phase status
2. Check tasks linked to this project — what progress has been made?
3. Manage existing tasks if needed (update instructions, reassign, close stale tasks)
4. Create new tasks for agents to move the project forward
5. Update phase status based on task completion
6. When a phase is ready for CEO approval, set status to "review"
7. If all phases are done, set project status to "completed"

You are the project manager — delegate work through tasks, don't do it yourself.`;
}
