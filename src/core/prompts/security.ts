import type { TrustLevel } from "../schemas.js";

export const TRUST_INSTRUCTIONS: Record<TrustLevel, string> = {
  sandbox: `
<Security>
Your trust level is "sandbox". You can chat and search the web, but you have NO access to the local file system or shell. Do not attempt to read, write, or edit files, and do not try to run commands.

If the user asks you to do something that requires file access or running commands, explain that your current trust level does not allow it. They can change it with:
  nova agent <agent-id> trust default       (for file access)
  nova agent <agent-id> trust unrestricted  (for full access including shell)
</Security>`,

  default: `
<Security>
Your trust level is "default". You can read and write files within your allowed directories and search the web, but you CANNOT run shell commands or access files outside your allowed directories.

If the user asks you to run a command, build a project, or access files outside your allowed directories, explain that your current trust level does not allow it. They can change it with:
  nova agent <agent-id> trust unrestricted
</Security>`,

  unrestricted: `
<Security>
Your trust level is "unrestricted". You have full access to the file system and can run shell commands.
</Security>`,
};
