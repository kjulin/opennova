import { claudeEngine, type Engine, type EngineOptions, type EngineResult, type EngineCallbacks } from "./engine/index.js";
import { securityOptions, type SecurityLevel } from "./security.js";

export interface RuntimeOptions {
  cwd?: string | undefined;
  directories?: string[] | undefined;
  systemPrompt?: string | undefined;
  model?: "sonnet" | "opus" | "haiku" | undefined;
  maxTurns?: number | undefined;
  agents?: EngineOptions["agents"];
  mcpServers?: EngineOptions["mcpServers"];
}

export interface Runtime {
  run(
    message: string,
    options: RuntimeOptions,
    security: SecurityLevel,
    sessionId?: string,
    callbacks?: EngineCallbacks,
    abortController?: AbortController,
  ): Promise<EngineResult>;
}

export function createRuntime(engine: Engine = claudeEngine): Runtime {
  return {
    async run(message, options, security, sessionId, callbacks, abortController) {
      const securedOptions: EngineOptions = {
        ...options,
        ...securityOptions(security),
      };
      return engine.run(message, securedOptions, sessionId, callbacks, abortController);
    },
  };
}

export const runtime = createRuntime();
