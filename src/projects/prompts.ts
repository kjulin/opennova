export function getProjectReviewPrompt(projectTitle: string): string {
  return `Review project "${projectTitle}" and take appropriate action:

1. Check current phase status — is it still accurate?
2. Review tasks linked to this project — any completed? any blocked?
3. Update phase status if work has progressed
4. Create tasks for other agents if the current phase needs their input
5. If a phase is ready for CEO review, set its status to "review"
6. If the project is complete, set project status to "completed"

Use your project and tasklist tools.
Share your thinking as you review.`;
}
