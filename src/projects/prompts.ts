export function getProjectReviewPrompt(projectTitle: string): string {
  return `Work on project "${projectTitle}":

1. Get the project details and find the current phase (in_progress or first pending phase)
2. **Do the actual work** for this phase — write content, create files, implement features, whatever the phase requires
3. When the phase work is complete, set its status to "review" for CEO approval
4. If you need input from another agent, create a task for them
5. If all phases are done, set project status to "completed"

Focus on making real progress, not just checking status.
Use your project tools to update status as you complete work.`;
}
