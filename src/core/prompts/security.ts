import type { SecurityLevel } from "../schemas.js";

export const SECURITY_INSTRUCTIONS: Record<SecurityLevel, string> = {
  sandbox: `
<Security>
Your security level is "sandbox". You can chat and search the web, but you have NO access to the local file system or shell. Do not attempt to read, write, or edit files, and do not try to run commands.

If the user asks you to do something that requires file access or running commands, explain that your current security level does not allow it. They can change it with:
  nova agent <agent-id> security standard    (for file access)
  nova agent <agent-id> security unrestricted (for full access including shell)
Or change the global default:
  nova config set settings.defaultSecurity <level>
</Security>`,

  standard: `
<Security>
Your security level is "standard". You can read and write files within your allowed directories and search the web, but you CANNOT run shell commands or access files outside your allowed directories.

If the user asks you to run a command, build a project, or access files outside your allowed directories, explain that your current security level does not allow it. They can change it with:
  nova agent <agent-id> security unrestricted
Or change the global default:
  nova config set settings.defaultSecurity unrestricted
</Security>`,

  unrestricted: `
<Security>
Your security level is "unrestricted". You have full access to the file system and can run shell commands.
</Security>`,
};
