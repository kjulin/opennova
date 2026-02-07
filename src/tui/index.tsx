import React from "react";
import { render } from "ink";
import { App } from "./app.js";

interface Options {
  agentId?: string | undefined;
}

export function run(options: Options = {}) {
  // Enter alternate screen buffer for full-screen experience
  process.stdout.write("\x1b[?1049h");
  process.stdout.write("\x1b[H");

  const { unmount, waitUntilExit } = render(<App agentId={options.agentId} />);

  waitUntilExit().then(() => {
    // Return to normal screen buffer
    process.stdout.write("\x1b[?1049l");
  });
}
