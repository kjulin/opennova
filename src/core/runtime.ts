import { claudeEngine, type Engine, type EngineOptions, type EngineResult, type EngineCallbacks } from "./engine/index.js";
import { trustOptions, type TrustLevel } from "./security.js";
import type { Model } from "./models.js";

export interface RuntimeOptions {
  cwd?: string | undefined;
  directories?: string[] | undefined;
  systemPrompt?: string | undefined;
  model?: Model | undefined;
  maxTurns?: number | undefined;
  agents?: EngineOptions["agents"];
  mcpServers?: EngineOptions["mcpServers"];
  extraAllowedTools?: string[] | undefined;
}

export interface Runtime {
  run(
    message: string,
    options: RuntimeOptions,
    trust: TrustLevel,
    sessionId?: string,
    callbacks?: EngineCallbacks,
    abortController?: AbortController,
  ): Promise<EngineResult>;
}

export function createRuntime(engine: Engine = claudeEngine): Runtime {
  return {
    async run(message, options, trust, sessionId, callbacks, abortController) {
      const securedOptions: EngineOptions = {
        ...options,
        ...trustOptions(trust, options.extraAllowedTools),
      };
      return engine.run(message, securedOptions, sessionId, callbacks, abortController);
    },
  };
}

export const runtime = createRuntime();
