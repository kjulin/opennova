import React from "react";
import { render } from "ink";
import { App } from "./app.js";

interface Options {
  agentId?: string | undefined;
}

export function run(options: Options = {}) {
  render(<App agentId={options.agentId} />);
}
