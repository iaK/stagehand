import { spawnClaude } from "./claude";
import type { ClaudeStreamEvent } from "./types";

/**
 * Fire a lightweight, tool-less agent call and return its text output.
 * Spawns with noSessionPersistence, maxTurns: 1, allowedTools: [] (maps to _none_ in backend).
 * Returns trimmed text or null on timeout/error.
 */
export async function quickAgentCall(params: {
  prompt: string;
  workingDirectory: string;
  timeoutMs?: number;
}): Promise<string | null> {
  const { prompt, workingDirectory, timeoutMs = 15_000 } = params;

  return new Promise<string | null>((resolve) => {
    let text = "";
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    }, timeoutMs);

    const finish = (result: string | null) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(result);
      }
    };

    spawnClaude(
      {
        prompt,
        workingDirectory,
        noSessionPersistence: true,
        maxTurns: 1,
        allowedTools: [],
        outputFormat: "stream-json",
      },
      (event: ClaudeStreamEvent) => {
        switch (event.type) {
          case "stdout_line":
            try {
              const parsed = JSON.parse(event.line);
              if (parsed.type === "assistant" && parsed.message?.content) {
                for (const block of parsed.message.content) {
                  if (block.type === "text") text += block.text;
                }
              } else if (parsed.type === "result") {
                const output = parsed.result;
                if (output != null && output !== "") {
                  text = typeof output === "string" ? output : JSON.stringify(output);
                }
              }
            } catch {
              // Not JSON — ignore
            }
            break;
          case "completed":
            finish(text.trim() || null);
            break;
          case "error":
            finish(null);
            break;
        }
      },
    ).catch(() => finish(null));
  });
}
