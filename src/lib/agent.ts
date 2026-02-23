import { invoke, Channel } from "@tauri-apps/api/core";
import type { AgentStreamEvent, SpawnAgentArgs, PtyEvent, SpawnPtyArgs } from "./types";

export async function spawnAgent(
  args: SpawnAgentArgs,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<string> {
  const channel = new Channel<AgentStreamEvent>();
  channel.onmessage = onEvent;

  return invoke<string>("spawn_agent", {
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

export async function checkAgentAvailable(agent?: string): Promise<string> {
  return invoke<string>("check_agent_available", { agent: agent ?? null });
}

// === PTY (Interactive Terminal) ===

export async function spawnPty(
  args: SpawnPtyArgs,
  onEvent: (event: PtyEvent) => void,
): Promise<string> {
  const channel = new Channel<PtyEvent>();
  channel.onmessage = onEvent;

  return invoke<string>("spawn_pty", {
    args,
    onEvent: channel,
  });
}

export async function writeToPty(id: string, data: string): Promise<void> {
  return invoke("write_to_pty", { id, data });
}

export async function resizePty(id: string, cols: number, rows: number): Promise<void> {
  return invoke("resize_pty", { id, cols, rows });
}

export async function killPty(id: string): Promise<void> {
  return invoke("kill_pty", { id });
}
