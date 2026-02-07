export interface Logger {
  debug(tag: string, msg: string, ...args: unknown[]): void;
  info(tag: string, msg: string, ...args: unknown[]): void;
  warn(tag: string, msg: string, ...args: unknown[]): void;
  error(tag: string, msg: string, ...args: unknown[]): void;
}

const consoleLogger: Logger = {
  debug(tag, msg, ...args) {
    console.debug(`[${tag}]`, msg, ...args);
  },
  info(tag, msg, ...args) {
    console.info(`[${tag}]`, msg, ...args);
  },
  warn(tag, msg, ...args) {
    console.warn(`[${tag}]`, msg, ...args);
  },
  error(tag, msg, ...args) {
    console.error(`[${tag}]`, msg, ...args);
  },
};

export let log: Logger = consoleLogger;

export function setLogger(logger: Logger): void {
  log = logger;
}
