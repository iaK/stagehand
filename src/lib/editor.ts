import { invoke } from "@tauri-apps/api/core";

export async function openInExternalEditor(command: string, path: string): Promise<void> {
  await invoke("open_in_external_editor", { command, path });
}
