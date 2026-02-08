import React from "react";
import { render } from "ink";
import { App } from "./app.js";

export type AppMode = "chat" | "cowork";

interface Options {
  agentId?: string | undefined;
  mode?: AppMode | undefined;
  workingDir?: string | undefined;
}

export function run(options: Options = {}) {
  // Enter alternate screen buffer for full-screen experience
  process.stdout.write("\x1b[?1049h");
  process.stdout.write("\x1b[H");

  const { waitUntilExit } = render(
    <App
      agentId={options.agentId}
      mode={options.mode ?? "chat"}
      workingDir={options.workingDir}
    />
  );

  waitUntilExit().then(() => {
    // Return to normal screen buffer
    process.stdout.write("\x1b[?1049l");
  });
}
