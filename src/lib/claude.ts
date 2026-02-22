/**
 * @deprecated This module is kept for backwards compatibility.
 * Import from "./agent" instead.
 */
export {
  spawnAgent,
  spawnAgent as spawnClaude,
  killProcess,
  listProcesses,
  listProcessesDetailed,
  checkAgentAvailable,
  checkAgentAvailable as checkClaudeAvailable,
  spawnPty,
  writeToPty,
  resizePty,
  killPty,
} from "./agent";

export type { ProcessInfo } from "./agent";
