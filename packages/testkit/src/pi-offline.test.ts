import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentRunRequest, AgentRuntimeEvent, ConnectorTool } from "@rakazo/adapter-kit";
import { PiAgentRuntime } from "@rakazo/adapters";
import { afterEach, describe, expect, it } from "vitest";
import { type ModelEmulatorRequest, startModelEmulator } from "./model-emulator.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const writeTool: ConnectorTool = {
  name: "write_file",
  description: "Save a UTF-8 file",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
    additionalProperties: false,
  },
};

function runRequest(
  model: AgentRunRequest["model"],
  overrides: Partial<AgentRunRequest> = {},
): AgentRunRequest {
  return {
    botId: "fixture-bot",
    threadId: "fixture-thread",
    runId: randomUUID(),
    prompt: "Save hello to notes.txt.",
    instructions: "Complete the requested task.",
    history: [],
    tools: [writeTool],
    model,
    ...overrides,
  };
}

async function collect(stream: AsyncIterable<AgentRuntimeEvent>, events: AgentRuntimeEvent[] = []) {
  for await (const event of stream) events.push(event);
  return events;
}

function latestToolResult(request: ModelEmulatorRequest) {
  return request.messages.findLast((message) => message.role === "tool");
}

describe("real Pi against an offline model HTTP endpoint", () => {
  it("compacts between tool rounds at the one-token boundary and executes each action once", async () => {
    const calls: string[] = [];
    const outputBudget = (request: ModelEmulatorRequest) => {
      expect(request.max_completion_tokens ?? request.max_tokens).toBe(4_096);
    };
    const summaryStep = {
      expect(request: ModelEmulatorRequest) {
        outputBudget(request);
        expect(request.tools ?? []).toHaveLength(0);
        expect(JSON.stringify(request.messages)).toContain("Earlier facts");
      },
      response: {
        type: "text" as const,
        text: "Earlier facts: summarize mail without sending it. Earlier reads completed; retain their findings. Do not repeat completed actions.",
      },
    };
    const server = await startModelEmulator({
      steps: [
        {
          expect: outputBudget,
          response: {
            type: "tool",
            id: "read-1",
            name: "write_file",
            arguments: { path: "notes.txt", content: "first" },
          },
          usage: { prompt_tokens: 25_160, completion_tokens: 985, total_tokens: 26_145 },
        },
        summaryStep,
        {
          expect(request) {
            outputBudget(request);
            expect(latestToolResult(request)?.tool_call_id).toBe("read-1");
            expect(String(latestToolResult(request)?.content)).toHaveLength(12_001);
            expect(request.messages.some((m) => m.tool_calls?.some((t) => t.id === "read-1"))).toBe(
              true,
            );
          },
          response: {
            type: "tool",
            id: "read-2",
            name: "write_file",
            arguments: { path: "notes.txt", content: "second" },
          },
          usage: { prompt_tokens: 25_160, completion_tokens: 985, total_tokens: 26_145 },
        },
        summaryStep,
        {
          expect(request) {
            outputBudget(request);
            expect(latestToolResult(request)?.tool_call_id).toBe("read-2");
            expect(request.messages.some((m) => m.tool_calls?.some((t) => t.id === "read-2"))).toBe(
              true,
            );
          },
          response: { type: "text", text: "Both steps completed; here is the summary." },
        },
      ],
    });
    cleanups.push(() => server.close());
    const events = await collect(
      new PiAgentRuntime().run(
        runRequest(
          { ...server.model, contextWindow: 32_768, maxTokens: 4_096 },
          {
            history: [{ role: "user", content: "Earlier facts. ".repeat(4_000) }],
            async executeTool(_name, _args, id) {
              calls.push(String(id));
              return {
                kind: "agent_tool_result",
                content: [{ type: "text", text: "x".repeat(12_100) }],
              };
            },
          },
        ),
      ),
    );
    server.assertComplete();
    expect(calls).toEqual(["read-1", "read-2"]);
    expect(events.at(-1)).toEqual({
      type: "done",
      text: "Both steps completed; here is the summary.",
    });
    expect(
      events.filter((event) => event.type === "progress" && event.text === "Compacting context…"),
    ).toHaveLength(2);
  });

  it("assembles fragmented tool arguments, executes the write, and sends its result back", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rakazo-pi-offline-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const calls: Array<{ name: string; args: Record<string, unknown>; id?: string }> = [];
    const server = await startModelEmulator({
      apiKey: "fixture-only-key",
      steps: [
        {
          expect(request) {
            expect(request.messages.at(-1)).toMatchObject({
              role: "user",
              content: [{ type: "text", text: "Save hello to notes.txt." }],
            });
            expect(request.tools).toContainEqual(
              expect.objectContaining({
                function: expect.objectContaining({ name: "write_file" }),
              }),
            );
          },
          response: {
            type: "tool",
            id: "write-1",
            name: "write_file",
            arguments: { path: "notes.txt", content: "hello\n" },
            argumentChunks: ['{"pa', 'th":"notes.', 'txt","content":"hel', "lo\\", 'n"}'],
          },
        },
        {
          expect(request) {
            expect(
              request.messages.find((message) => message.role === "assistant")?.tool_calls,
            ).toEqual([
              {
                id: "write-1",
                type: "function",
                function: {
                  name: "write_file",
                  arguments: JSON.stringify({ path: "notes.txt", content: "hello\n" }),
                },
              },
            ]);
            expect(latestToolResult(request)).toMatchObject({ tool_call_id: "write-1" });
            expect(JSON.parse(String(latestToolResult(request)?.content))).toEqual({
              path: "notes.txt",
              bytes: 6,
            });
          },
          response: { type: "text", text: "Saved notes.txt." },
        },
      ],
    });
    cleanups.push(() => server.close());
    const events = await collect(
      new PiAgentRuntime().run(
        runRequest(server.model, {
          async executeTool(name, args, id) {
            calls.push({ name, args, id });
            expect(name).toBe("write_file");
            expect(args.path).toBe("notes.txt");
            await writeFile(path.join(dir, "notes.txt"), String(args.content));
            return { path: "notes.txt", bytes: Buffer.byteLength(String(args.content)) };
          },
        }),
      ),
    ).catch((error) => {
      try {
        server.assertComplete();
      } catch (fixtureError) {
        throw new AggregateError(
          [error, fixtureError],
          "Pi failed and model fixture validation also failed",
        );
      }
      throw error;
    });
    server.assertComplete();
    expect(calls).toEqual([
      { name: "write_file", args: { path: "notes.txt", content: "hello\n" }, id: "write-1" },
    ]);
    expect(await readFile(path.join(dir, "notes.txt"), "utf8")).toBe("hello\n");
    expect(events.at(-1)).toEqual({ type: "done", text: "Saved notes.txt." });
  });

  it("returns tool failure to the model and continues without claiming a successful write", async () => {
    let calls = 0;
    const server = await startModelEmulator({
      steps: [
        {
          expect() {},
          response: {
            type: "tool",
            id: "denied-write",
            name: "write_file",
            arguments: { path: "notes.txt", content: "hello" },
          },
        },
        {
          expect(request) {
            expect(latestToolResult(request)).toMatchObject({ tool_call_id: "denied-write" });
            expect(String(latestToolResult(request)?.content)).toContain("Fixture write denied");
          },
          response: { type: "text", text: "The file could not be saved." },
        },
      ],
    });
    cleanups.push(() => server.close());
    const events = await collect(
      new PiAgentRuntime().run(
        runRequest(server.model, {
          executeTool: async () => {
            calls++;
            throw new Error("Fixture write denied");
          },
        }),
      ),
    );
    server.assertComplete();
    expect(calls).toBe(1);
    expect(events.at(-1)).toEqual({ type: "done", text: "The file could not be saved." });
  });

  it("propagates a provider rejection without dispatching tools or emitting done", async () => {
    let calls = 0;
    const server = await startModelEmulator({
      steps: [
        {
          expect() {},
          response: { type: "error", status: 400, message: "Fixture request rejected" },
        },
      ],
    });
    cleanups.push(() => server.close());
    const events: AgentRuntimeEvent[] = [];
    await expect(
      collect(
        new PiAgentRuntime().run(
          runRequest(server.model, {
            executeTool: async () => {
              calls++;
              return {};
            },
          }),
        ),
        events,
      ),
    ).rejects.toThrow(/Fixture request rejected/);
    server.assertComplete();
    expect(calls).toBe(0);
    expect(events.some((event) => event.type === "done")).toBe(false);
  });

  it("rejects an interrupted SSE response without emitting successful completion", async () => {
    const server = await startModelEmulator({
      steps: [{ expect() {}, response: { type: "disconnect", text: "Working" } }],
    });
    cleanups.push(() => server.close());
    const events: AgentRuntimeEvent[] = [];
    await expect(
      collect(new PiAgentRuntime().run(runRequest(server.model)), events),
    ).rejects.toThrow();
    server.assertComplete();
    expect(events.some((event) => event.type === "done")).toBe(false);
  });

  it("cancels a quiet HTTP stream and closes the provider connection", async () => {
    const opened = deferred();
    const closed = deferred();
    const server = await startModelEmulator({
      steps: [
        {
          expect() {},
          response: {
            type: "hold",
            onOpen: opened.resolve,
            onClose: closed.resolve,
          },
        },
      ],
    });
    cleanups.push(() => server.close());
    const controller = new AbortController();
    const events: AgentRuntimeEvent[] = [];
    const work = collect(
      new PiAgentRuntime().run(runRequest(server.model), { signal: controller.signal }),
      events,
    );
    // Attach the rejection handler before aborting to avoid an unhandled rejection.
    const outcome = work.then(
      () => undefined,
      (error: unknown) => error,
    );
    await opened.promise;
    controller.abort();
    expect(await outcome).toBeInstanceOf(Error);
    await closed.promise;
    server.assertComplete();
    expect(events.some((event) => event.type === "done")).toBe(false);
  });

  it("keeps two model connections and their responses isolated", async () => {
    const first = await startModelEmulator({
      modelId: "fixture-first",
      apiKey: "first-fixture-key",
      steps: [{ expect() {}, response: { type: "text", text: "First connection" } }],
    });
    const second = await startModelEmulator({
      modelId: "fixture-second",
      apiKey: "second-fixture-key",
      steps: [{ expect() {}, response: { type: "text", text: "Second connection" } }],
    });
    cleanups.push(
      () => first.close(),
      () => second.close(),
    );
    const runtime = new PiAgentRuntime();
    const results = await Promise.all(
      [first, second].map((server) => collect(runtime.run(runRequest(server.model)))),
    );
    expect(results.map((events) => events.at(-1))).toEqual([
      { type: "done", text: "First connection" },
      { type: "done", text: "Second connection" },
    ]);
    first.assertComplete();
    second.assertComplete();
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
