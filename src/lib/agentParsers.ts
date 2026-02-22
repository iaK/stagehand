/**
 * Parses a single stdout line from an agent's stream-json format.
 * Returns structured output if the line contains a recognized event.
 */
export interface ParsedAgentLine {
  assistantText?: string;
  resultText?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    total_cost_usd?: number;
    duration_ms?: number;
    num_turns?: number;
  };
}

export function parseAgentStreamLine(line: string): ParsedAgentLine | null {
  try {
    const parsed = JSON.parse(line);
    if (parsed.type === "assistant" && parsed.message?.content) {
      let text = "";
      for (const block of parsed.message.content) {
        if (block.type === "text") {
          text += block.text;
        }
      }
      if (text) return { assistantText: text };
    } else if (parsed.type === "result") {
      const output = parsed.structured_output ?? parsed.result;
      const resultText =
        output != null && output !== ""
          ? typeof output === "string"
            ? output
            : JSON.stringify(output)
          : undefined;
      const usage = parsed.usage
        ? {
            input_tokens: parsed.usage.input_tokens,
            output_tokens: parsed.usage.output_tokens,
            cache_creation_input_tokens: parsed.usage.cache_creation_input_tokens,
            cache_read_input_tokens: parsed.usage.cache_read_input_tokens,
            total_cost_usd: parsed.total_cost_usd,
            duration_ms: parsed.duration_ms,
            num_turns: parsed.num_turns,
          }
        : undefined;
      return { resultText, usage };
    } else if (parsed.type === "content_block_delta" && parsed.delta?.text) {
      return { assistantText: parsed.delta.text };
    }
  } catch {
    // Not JSON
  }
  return null;
}
