import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ComposioEmulator } from "@rakazo/adapters";
import { answerRunInput } from "@rakazo/db";
import { describe, expect, it } from "vitest";
import { sessionCookieHeader } from "./index.js";
import { startModelEmulator } from "./model-emulator.js";

type App = { request: (input: string, init?: RequestInit) => Promise<Response> };
const databaseAvailable = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const origin = "http://127.0.0.1:5173";

// Run against an isolated migrated database only. All identities, coordinates,
// credentials and model responses below are synthetic; no device API is called.
describe.skipIf(!databaseAvailable)("one-time device location API integration", () => {
  it.each(["share", "decline"] as const)(
    "%s pauses and resumes through the real Pi runtime",
    async (decision) => {
      const fixtureKey = "offline-location-fixture-key";
      const model = await startModelEmulator({
        apiKey: fixtureKey,
        steps: [
          {
            expect(request) {
              expect(request.tools).toContainEqual(
                expect.objectContaining({
                  function: expect.objectContaining({ name: "request_location" }),
                }),
              );
              expect(JSON.stringify(request.messages)).not.toContain("latitude 12.345");
            },
            response: {
              type: "tool",
              id: "location-request",
              name: "request_location",
              arguments: { reason: "Find a nearby fixture cafe." },
            },
          },
          {
            expect(request) {
              const context = JSON.stringify(request.messages);
              if (decision === "share") {
                expect(context).toContain("latitude 12.345");
                expect(context).toContain("longitude 67.89");
                expect(context).toContain("accuracy 25 meters");
                expect(context).toContain("captured at");
              } else {
                expect(context).toContain("location sharing declined");
                expect(context).not.toContain("latitude 12.345");
              }
            },
            response: { type: "text", text: "Location fixture finished." },
          },
        ],
      });
      const dataDir = await mkdtemp(path.join(tmpdir(), "rakazo-location-test-"));
      let stop: (() => Promise<void>) | undefined;
      try {
        const { createApp } = await import("../../../apps/api/src/app.ts");
        const handles = await createApp({
          databaseUrl: process.env.DATABASE_URL!,
          realtimeDatabaseUrl: process.env.DATABASE_URL!,
          authUrl: origin,
          webOrigin: origin,
          dataDir,
          sandboxProvider: "fake",
          agentRuntime: "pi",
          wakeupDriver: "memory",
          signupsEnabled: "true",
          composio: new ComposioEmulator(),
          encryptionKey: "offline-location-encryption-key",
        });
        stop = handles.stop;
        const cookie = await signup(handles.app, "owner");
        const outsider = await signup(handles.app, "outsider");
        await rpc(handles.app, cookie, "models/connect", {
          provider: model.model.provider,
          modelId: model.model.id,
          baseUrl: model.baseUrl,
          apiKey: fixtureKey,
        });
        const bot = await rpc<{ id: string }>(handles.app, cookie, "bots/create", {
          name: "Location fixture",
          title: "",
          description: "",
          instructions: "Request device location when needed.",
          notifyOnFinish: false,
        });
        await rpc(handles.app, cookie, "bots/update", {
          botId: bot.id,
          modelProvider: model.model.provider,
          modelId: model.model.id,
        });
        const sent = await rpc<{ runId: string }>(handles.app, cookie, "threads/send", {
          botId: bot.id,
          text: "Find a nearby fixture cafe.",
        });
        const waitForRun = async (status: string) => {
          await expect
            .poll(
              async () => {
                const run = await handles.prisma.run.findUniqueOrThrow({
                  where: { id: sent.runId },
                });
                if (run.status === "failed") model.assertComplete();
                return run.status;
              },
              { timeout: 15_000, interval: 100 },
            )
            .toBe(status);
        };
        await waitForRun("waiting_input");
        expect(model.requests).toHaveLength(1);
        const card = await handles.prisma.message.findFirstOrThrow({
          where: { runId: sent.runId, role: "bot" },
          orderBy: { seq: "desc" },
        });
        expect(card.blocks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: "ask", input: "location", status: "pending" }),
          ]),
        );
        const fix = {
          kind: "device-location",
          latitude: 12.345,
          longitude: 67.89,
          accuracyMeters: 25,
          capturedAt: new Date().toISOString(),
        };
        const answerInput = (answer: string) => ({
          botId: bot.id,
          runId: sent.runId,
          messageId: card.id,
          answer,
        });

        for (const answer of [
          "share",
          "not-json",
          JSON.stringify({ ...fix, latitude: 91 }),
          JSON.stringify({ ...fix, accuracyMeters: -1 }),
          JSON.stringify({ ...fix, capturedAt: new Date(Date.now() - 300_000).toISOString() }),
          JSON.stringify({ ...fix, injected: "extra context" }),
        ]) {
          expect(
            (await request(handles.app, cookie, "threads/answer", answerInput(answer))).status,
          ).toBe(409);
        }
        expect(
          (await request(handles.app, outsider, "threads/answer", answerInput(JSON.stringify(fix))))
            .status,
        ).toBeGreaterThanOrEqual(400);

        // A same-space collaborator must not substitute their own location for the
        // person whose request owns this run. Private bot access may reject first.
        const member = await signup(handles.app, "member");
        const ownerActor = await rpc<{ userId: string; spaceId: string }>(
          handles.app,
          cookie,
          "me",
        );
        const memberActor = await rpc<{ userId: string }>(handles.app, member, "me");
        await handles.prisma.member.deleteMany({ where: { userId: memberActor.userId } });
        await handles.prisma.member.create({
          data: {
            id: randomUUID(),
            organizationId: ownerActor.spaceId,
            userId: memberActor.userId,
            role: "member",
            createdAt: new Date(),
          },
        });
        expect(
          (await request(handles.app, member, "threads/answer", answerInput(JSON.stringify(fix))))
            .status,
        ).toBeGreaterThanOrEqual(400);
        expect(
          await answerRunInput(handles.prisma, {
            spaceId: ownerActor.spaceId,
            threadId: card.threadId,
            runId: sent.runId,
            messageId: card.id,
            answeredByUserId: memberActor.userId,
            answer: JSON.stringify(fix),
          }),
        ).toBe(false);
        expect(
          (await handles.prisma.run.findUniqueOrThrow({ where: { id: sent.runId } })).status,
        ).toBe("waiting_input");
        expect(model.requests).toHaveLength(1);

        const answer =
          decision === "share"
            ? JSON.stringify({ ...fix, capturedAt: new Date().toISOString() })
            : "location-declined";
        const submissions = await Promise.all([
          request(handles.app, cookie, "threads/answer", answerInput(answer)),
          request(handles.app, cookie, "threads/answer", answerInput(answer)),
        ]);
        expect(submissions.map((response) => response.status).sort()).toEqual([200, 409]);
        await waitForRun("completed");
        model.assertComplete();
        const answered = await handles.prisma.message.findUniqueOrThrow({ where: { id: card.id } });
        const stored = JSON.stringify(answered.blocks);
        expect(stored).toContain('"status":"answered"');
        expect(stored).toContain(
          decision === "share" ? "latitude 12.345" : "location sharing declined",
        );
        expect(
          (await request(handles.app, cookie, "threads/answer", answerInput(answer))).status,
        ).toBe(409);
      } finally {
        try {
          await stop?.();
        } finally {
          await model.close();
          await rm(dataDir, { recursive: true, force: true });
        }
      }
    },
    60_000,
  );
});

async function signup(app: App, label: string): Promise<string> {
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      email: `location-${label}-${randomUUID()}@rakazo.test`,
      password: "password12",
      name: "Location fixture",
    }),
  });
  expect(response.status).toBeLessThan(400);
  return sessionCookieHeader(response);
}

function request(app: App, cookie: string, procedure: string, input: unknown = {}) {
  return app.request(`/rpc/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin },
    body: JSON.stringify({ json: input }),
  });
}

async function rpc<T>(
  app: App,
  cookie: string,
  procedure: string,
  input: unknown = {},
): Promise<T> {
  const response = await request(app, cookie, procedure, input);
  expect(response.status, procedure).toBeLessThan(400);
  return ((await response.json()) as { json: T }).json;
}
