type LogLevel = "debug" | "info" | "warn" | "error";
const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
let minLevel: LogLevel = "warn";

export const logger = {
  debug: (msg: string, ...args: unknown[]) => log("debug", msg, ...args),
  info: (msg: string, ...args: unknown[]) => log("info", msg, ...args),
  warn: (msg: string, ...args: unknown[]) => log("warn", msg, ...args),
  error: (msg: string, ...args: unknown[]) => log("error", msg, ...args),
  setLevel: (level: LogLevel) => { minLevel = level; },
};

function log(level: LogLevel, msg: string, ...args: unknown[]) {
  if (LEVELS[level] < LEVELS[minLevel]) return;
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(`[${level.toUpperCase()}]`, msg, ...args);
}
