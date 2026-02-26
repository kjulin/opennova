export const TASK_WORK_PROMPT = `Check your current task status and take appropriate action:

1. Review the task details in the <Task> block above
2. Use get_task to check your full task details, steps, and progress
3. If steps are not defined, create a plan with update_steps
4. For steps with linked subtasks (#id), use get_task to check their status before proceeding
5. Work on the next incomplete step
6. Update step status as you make progress
7. If you need user input, use notify_user to ask and continue when they respond
8. If complete, use complete_task to finish

Focus on making concrete progress. Be thorough but efficient.`;
