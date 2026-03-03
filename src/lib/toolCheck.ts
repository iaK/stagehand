import { invoke } from "@tauri-apps/api/core";
import { checkAgentAvailable } from "./agent";
import { AVAILABLE_AGENTS } from "./agents";

export interface ToolStatus {
  available: boolean;
  version?: string;
}

export async function checkGhAvailable(): Promise<ToolStatus> {
  try {
    const output = await invoke<string>("run_gh_command", {
      args: ["--version"],
      workingDirectory: "/",
    });
    const match = output.match(/gh version ([\d.]+)/);
    return { available: true, version: match?.[1] ?? output.trim() };
  } catch {
    return { available: false };
  }
}

export async function checkGhAuth(): Promise<{ authenticated: boolean; account?: string }> {
  try {
    const output = await invoke<string>("run_gh_command", {
      args: ["auth", "status"],
      workingDirectory: "/",
    });
    const match = output.match(/Logged in to .+ account (.+?)[\s(]/);
    return { authenticated: true, account: match?.[1]?.trim() };
  } catch {
    return { authenticated: false };
  }
}

export async function checkAllAgents(): Promise<Record<string, ToolStatus>> {
  const results: Record<string, ToolStatus> = {};
  const checks = AVAILABLE_AGENTS.map(async (agent) => {
    try {
      const version = await checkAgentAvailable(agent.value);
      results[agent.value] = { available: true, version };
    } catch {
      results[agent.value] = { available: false };
    }
  });
  await Promise.all(checks);
  return results;
}
