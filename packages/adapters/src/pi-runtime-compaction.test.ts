import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, AssistantMessage, Message, Model, Models } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai";
import { clampMaxTokensToContext } from "@earendil-works/pi-ai/api/simple-options";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { describe, expect, it, vi } from "vitest";
import { compactRuntimeContext } from "./pi-runtime-compaction.js";

const model = {
  id: "fixture",
  api: "openai-completions",
  provider: "fixture",
  reasoning: true,
  contextWindow: 32_768,
  maxTokens: 4_096,
} as Model<Api>;
const usage = {
  input: 25_160,
  output: 985,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 26_145,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const response = {
  role: "assistant",
  content: [
    {
      type: "text",
      text: "Goal: inspect the messages. Earlier reads completed. Do not repeat writes. Remaining: report the latest result.",
    },
  ],
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage,
  stopReason: "stop",
  timestamp: 2,
} as AssistantMessage;
function fixture(): Message[] {
  return [
    { role: "system", content: "Keep the user's constraints.", timestamp: 0 },
    { role: "user", content: "Earlier facts. ".repeat(4_000), timestamp: 0 },
    { role: "user", content: "Inspect messages and summarize. Do not send mail.", timestamp: 0 },
    {
      ...response,
      timestamp: 1,
      stopReason: "toolUse",
      content: [
        { type: "toolCall", id: "read-1", name: "read_messages", arguments: { ids: ["latest"] } },
      ],
    },
    {
      role: "toolResult",
      toolCallId: "read-1",
      toolName: "read_messages",
      content: [{ type: "text", text: "x".repeat(12_001) }],
      isError: false,
      timestamp: 1,
    },
  ];
}
function options(reply = response) {
  const completeSimple = vi.fn(async () => reply);
  return { model, models: { completeSimple } as unknown as Models, completeSimple };
}

describe("in-run context compaction", () => {
  it("restores the reply budget at the observed usage boundary without breaking a tool pair", async () => {
    const messages = fixture();
    expect(estimateContextTokens(messages).tokens).toBe(29_146);
    expect(clampMaxTokensToContext(model, normalizeContext({ messages }), 4_096)).toBe(1);
    const opt = options();
    const onUsage = vi.fn();
    const compacted = await compactRuntimeContext(messages, { ...opt, onUsage });
    expect(opt.completeSimple).toHaveBeenCalledOnce();
    expect(compacted[0]).toBe(messages[0]);
    expect(compacted.slice(-2)).toEqual(messages.slice(-2));
    expect(compacted).toContainEqual(messages[2]);
    expect(estimateContextTokens(compacted as Message[]).usageTokens).toBe(0);
    expect(
      clampMaxTokensToContext(model, normalizeContext({ messages: compacted as Message[] }), 4_096),
    ).toBe(4_096);
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 25_160, outputTokens: 985 }),
    );
    // It updates context once, rather than re-summarizing on every next request.
    expect(await compactRuntimeContext(compacted, opt)).toBe(compacted);
    expect(opt.completeSimple).toHaveBeenCalledOnce();
  });

  it("does nothing below the boundary or with the correctly advertised larger window", async () => {
    const messages = fixture();
    const opt = options();
    expect(
      await compactRuntimeContext(messages, {
        ...opt,
        model: { ...model, contextWindow: 176_128 },
      }),
    ).toBe(messages);
    expect(opt.completeSimple).not.toHaveBeenCalled();
  });

  it("fails before another model/tool call when the summary is empty, truncated, or errors", async () => {
    for (const reply of [
      { ...response, content: [] },
      { ...response, stopReason: "length" as const },
      { ...response, stopReason: "error" as const },
    ]) {
      await expect(compactRuntimeContext(fixture(), options(reply))).rejects.toThrow(
        "usable summary",
      );
    }
  });

  it("does not drop an oversized latest tool group to squeeze in a reply", async () => {
    const messages = fixture();
    (messages.at(-1) as Extract<Message, { role: "toolResult" }>).content = [
      { type: "text", text: "x".repeat(100_000) },
    ];
    const opt = options();
    await expect(compactRuntimeContext(messages, opt)).rejects.toThrow("preserve the latest");
    expect(opt.completeSimple).not.toHaveBeenCalled();
  });

  it("chunks oversized initial history into bounded tool-free summary requests", async () => {
    const messages = fixture();
    (messages[1] as Extract<Message, { role: "user" }>).content = "large old history ".repeat(
      20_000,
    );
    const opt = options();
    await compactRuntimeContext(messages, opt);
    expect(opt.completeSimple.mock.calls.length).toBeGreaterThan(1);
    for (const call of opt.completeSimple.mock.calls as unknown as [
      Model<Api>,
      { messages: Message[] },
      { maxTokens: number },
    ][]) {
      expect(clampMaxTokensToContext(model, normalizeContext(call[1]), call[2].maxTokens)).toBe(
        4_096,
      );
      expect(call[1]).not.toHaveProperty("tools");
    }
  });

  it("honors cancellation before summarization", async () => {
    const controller = new AbortController();
    controller.abort();
    const opt = options();
    await expect(
      compactRuntimeContext(fixture() as AgentMessage[], { ...opt, signal: controller.signal }),
    ).rejects.toThrow();
    expect(opt.completeSimple).not.toHaveBeenCalled();
  });
});
