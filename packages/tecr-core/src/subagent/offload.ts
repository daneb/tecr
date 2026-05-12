/**
 * Tiered model offload (spec §8.3, S-15).
 *
 * When TECR_LOCAL_MODEL_URL is set, delegate() routes discovery tasks to the
 * local OpenAI-compatible endpoint (Ollama, MLX, llama.cpp) instead of the
 * grep/searchSymbol heuristic path. The returned localTokens are recorded in
 * telemetry but treated as zero-cost for budget accounting.
 */

import { countTokens } from '../tokenizer.js';

export interface OffloadResult {
  summary: string;
  /** Total tokens consumed by the local model (prompt + completion). */
  localTokens: number;
}

type ChatCompletionResponse = {
  choices: Array<{ message: { content: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/**
 * Call the local model and return a summary + local token count.
 * Throws if the endpoint is unreachable or returns a non-2xx status —
 * callers should catch and fall back to the grep path.
 */
export async function offload(
  task: string,
  workspaceRoot: string,
  parentContext?: string,
): Promise<OffloadResult> {
  const baseUrl = process.env['TECR_LOCAL_MODEL_URL']!;

  const systemContent = parentContext
    ? `You are a code discovery assistant. Workspace: ${workspaceRoot}. Context: ${parentContext}`
    : `You are a code discovery assistant. Workspace: ${workspaceRoot}.`;

  const messages = [
    { role: 'system', content: systemContent },
    { role: 'user', content: task },
  ];

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'local', messages, stream: false }),
  });

  if (!res.ok) {
    throw new Error(`Local model responded with status ${res.status}`);
  }

  const data = (await res.json()) as ChatCompletionResponse;
  const content = data.choices[0]?.message.content ?? '';

  // Prefer server-reported counts; fall back to cl100k estimates.
  const promptTokens =
    data.usage?.prompt_tokens ?? countTokens(messages.map((m) => m.content).join('\n'));
  const completionTokens = data.usage?.completion_tokens ?? countTokens(content);

  return {
    summary: content,
    localTokens: promptTokens + completionTokens,
  };
}
