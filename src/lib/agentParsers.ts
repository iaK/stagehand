export type ParsedStreamLine =
  | { type: "text"; text: string }
  | {
      type: "result";
      text: string;
      usage: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
        total_cost_usd?: number;
        duration_ms?: number;
        num_turns?: number;
      } | null;
    }
  | null;

/**
 * Parse a single stdout line from an agent's stream-json output.
 * Returns a typed result or null if the line isn't relevant.
 */
export function parseAgentStreamLine(line: string): ParsedStreamLine {
  try {
    const parsed = JSON.parse(line);

    if (parsed.type === "assistant" && parsed.message?.content) {
      const texts: string[] = [];
      for (const block of parsed.message.content) {
        if (block.type === "text") {
          texts.push(block.text);
        }
      }
      if (texts.length > 0) {
        return { type: "text", text: texts.join("") };
      }
      return null;
    }

    if (parsed.type === "result") {
      // With --json-schema, the output is in structured_output, not result
      const output = parsed.structured_output ?? parsed.result;
      let text = "";
      if (output != null && output !== "") {
        text = typeof output === "string" ? output : JSON.stringify(output);
      }
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
        : null;
      return { type: "result", text, usage };
    }

    if (parsed.type === "content_block_delta") {
      if (parsed.delta?.text) {
        return { type: "text", text: parsed.delta.text };
      }
      return null;
    }

    return null;
  } catch {
    // Not JSON — return null so caller can handle raw lines
    return null;
  }
}
