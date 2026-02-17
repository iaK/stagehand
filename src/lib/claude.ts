import { invoke, Channel } from "@tauri-apps/api/core";
import type { ClaudeStreamEvent, SpawnClaudeArgs } from "./types";

export async function spawnClaude(
  args: SpawnClaudeArgs,
  onEvent: (event: ClaudeStreamEvent) => void,
): Promise<string> {
  const channel = new Channel<ClaudeStreamEvent>();
  channel.onmessage = onEvent;

  return invoke<string>("spawn_claude", {
    args,
    onEvent: channel,
  });
}

export async function killProcess(processId: string): Promise<void> {
  return invoke("kill_process", { processId });
}

export async function listProcesses(): Promise<string[]> {
  return invoke<string[]>("list_processes");
}

export interface ProcessInfo {
  processId: string;
  stageExecutionId: string | null;
}

export async function listProcessesDetailed(): Promise<ProcessInfo[]> {
  return invoke<ProcessInfo[]>("list_processes_detailed");
}

export async function checkClaudeAvailable(): Promise<string> {
  return invoke<string>("check_claude_available");
}
