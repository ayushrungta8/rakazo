import { describe, expect, it, vi } from "vitest";
import {
  commitmentReviewPrompt,
  isCommitmentReview,
  listCommitments,
  reconcileCommitments,
  trackCommitment,
  updateCommitment,
} from "./commitments.js";

const now = new Date("2026-10-05T05:00:00Z");
const scope = { spaceId: "space", botId: "chief", userId: "owner", runId: "request" };
const metadata = {
  version: 1,
  outcome: "Deliver a verified comparison",
  nextAction: "Read the specialist result",
  waitingOn: "specialist",
  sourceRunId: "request",
  assignee: "",
  deadlineAt: null,
  completionEvidence: "",
};
const item = () => ({
  id: "item",
  ...scope,
  title: "Compare options",
  status: "open",
  notes: "",
  commitment: metadata,
  reviewAt: now,
  reviewCount: 0,
  lastReviewAt: null,
  reviewRunId: null,
  createdAt: now,
  updatedAt: now,
});

describe("durable commitments", () => {
  it("captures provenance and a default review without duplicating the originating request", async () => {
    const upsert = vi.fn(async (args) => args.create);
    const prisma = { scratchpadItem: { upsert, findFirst: vi.fn(async () => null) } };
    const args = { title: "Compare options", ...metadata, sourceRunId: "untrusted" };
    const first = await trackCommitment({ prisma: prisma as never }, scope, args, now);
    const second = await trackCommitment({ prisma: prisma as never }, scope, args, now);
    expect(first).toEqual(second);
    expect(upsert.mock.calls[0]![0]!.create.commitment.sourceRunId).toBe("request");
    expect(upsert.mock.calls[0]![0]!.create.reviewAt.toISOString()).toBe(
      "2026-10-06T05:00:00.000Z",
    );
    expect(upsert.mock.calls[0]![0]!.create.notes).toContain("Next: Read the specialist result");
  });

  it("reuses an existing open outcome across turns", async () => {
    const existing = item();
    const upsert = vi.fn();
    const result = await trackCommitment(
      { prisma: { scratchpadItem: { upsert, findFirst: vi.fn(async () => existing) } } as never },
      scope,
      { title: "same", ...metadata },
      now,
    );
    expect(result).toEqual({ item: existing, existing: true });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("enforces daily user reminders and validates future times", async () => {
    const upsert = vi.fn(async (args) => args.create);
    const prisma = { scratchpadItem: { upsert, findFirst: vi.fn(async () => null) } };
    await trackCommitment(
      { prisma: prisma as never },
      scope,
      { title: "Decide", ...metadata, waitingOn: "user", reviewAt: "2026-10-05T06:00:00Z" },
      now,
    );
    expect(upsert.mock.calls[0]![0]!.create.reviewAt.toISOString()).toBe(
      "2026-10-06T05:00:00.000Z",
    );
    expect(
      await trackCommitment(
        { prisma: prisma as never },
        scope,
        { title: "Decide", ...metadata, reviewAt: "yesterday" },
        now,
      ),
    ).toHaveProperty("error");
  });

  it("does not treat a reported blocker as completion", async () => {
    const update = vi.fn();
    const prisma = { scratchpadItem: { findFirst: vi.fn(async () => item()), update } };
    const result = await updateCommitment(
      { prisma: prisma as never },
      { ...scope, userInitiated: false },
      { itemId: "item", status: "done" },
      now,
    );
    expect(result).toHaveProperty("error", expect.stringContaining("Completion requires evidence"));
    expect(update).not.toHaveBeenCalled();
    await updateCommitment(
      { prisma: prisma as never },
      { ...scope, userInitiated: false },
      {
        itemId: "item",
        status: "done",
        completionEvidence: "Comparison delivered with checked sources.",
      },
      now,
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "done", reviewAt: null }),
      }),
    );
  });

  it("requires the original owner and bot scope", async () => {
    const findFirst = vi.fn(async () => null);
    const result = await updateCommitment(
      { prisma: { scratchpadItem: { findFirst } } as never },
      { ...scope, userInitiated: false },
      { itemId: "other" },
      now,
    );
    expect(result).toHaveProperty("error");
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "other", spaceId: "space", botId: "chief", userId: "owner" },
    });
  });

  it("stops autonomous retries but keeps user-requested daily nudges", async () => {
    const existing = { ...item(), reviewCount: 3 };
    const update = vi.fn(async ({ data }) => ({ ...existing, ...data }));
    const prisma = { scratchpadItem: { findFirst: vi.fn(async () => existing), update } };
    expect(
      await updateCommitment(
        { prisma: prisma as never },
        { ...scope, userInitiated: false },
        { itemId: "item", reviewAt: "2026-10-06T05:00:00Z" },
        now,
      ),
    ).toHaveProperty("error", expect.stringContaining("exhausted"));
    expect(
      await updateCommitment(
        { prisma: prisma as never },
        { ...scope, userInitiated: false },
        { itemId: "item", waitingOn: "user" },
        now,
      ),
    ).toHaveProperty("item");
    expect(
      await updateCommitment(
        { prisma: prisma as never },
        { ...scope, userInitiated: true },
        { itemId: "item", reviewAt: "2026-10-06T05:00:00Z" },
        now,
      ),
    ).toHaveProperty("item.reviewCount", 0);
  });

  it("parking an item stops reviews and preserves its unfinished outcome", async () => {
    const update = vi.fn(async ({ data }) => data);
    const prisma = { scratchpadItem: { findFirst: vi.fn(async () => item()), update } };
    await updateCommitment(
      { prisma: prisma as never },
      { ...scope, userInitiated: true },
      { itemId: "item", status: "parked" },
      now,
    );
    expect(update.mock.calls[0]![0]!.data).toEqual(
      expect.objectContaining({ status: "parked", reviewAt: null, commitment: metadata }),
    );
  });

  it("can inspect a completed item without confusing absence with outstanding work", async () => {
    const findMany = vi.fn(async (_args: { where: Record<string, unknown> }) => [
      { ...item(), status: "done" },
    ]);
    expect(
      await listCommitments({ prisma: { scratchpadItem: { findMany } } as never }, scope, "item"),
    ).toHaveProperty("items.0.status", "done");
    expect(findMany.mock.calls[0]![0]!.where).not.toHaveProperty("status");
  });
});

describe("commitment wakeup reconciliation", () => {
  function fixture(
    overrides: {
      busy?: boolean;
      lostClaim?: boolean;
      enqueueFailure?: boolean;
      waitingOn?: string;
      count?: number;
    } = {},
  ) {
    const row = {
      ...item(),
      reviewCount: overrides.count ?? 0,
      commitment: { ...metadata, waitingOn: overrides.waitingOn ?? "specialist" },
    };
    const tx = {
      scratchpadItem: {
        findFirst: vi.fn(async () => row),
        updateMany: vi.fn(
          async (_args: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({
            count: overrides.lostClaim ? 0 : 1,
          }),
        ),
        update: vi.fn(async () => row),
      },
      bot: {
        findFirst: vi.fn(async (_args: { where: Record<string, unknown> }) => ({
          ...scope,
          id: "chief",
          thread: { id: "thread" },
        })),
      },
      run: {
        findFirst: vi.fn(async () => (overrides.busy ? { id: "active" } : null)),
        create: vi.fn(async ({ data }) => ({ id: "review", ...data })),
      },
      task: { create: vi.fn(async ({ data }) => ({ id: "task", ...data })) },
    };
    const prisma = {
      scratchpadItem: { findMany: vi.fn(async () => [row]) },
      $transaction: async (callback: (value: typeof tx) => unknown) => callback(tx),
    };
    const enqueue = vi.fn(async () => {
      if (overrides.enqueueFailure) throw new Error("queue unavailable");
    });
    return { tx, prisma, deps: { prisma: prisma as never, jobs: { enqueue } as never }, enqueue };
  }

  it("claims the due record and queues a scoped, deduplicated ordinary run", async () => {
    const f = fixture();
    await reconcileCommitments(f.deps, now);
    expect(f.tx.run.create.mock.calls[0]![0]!.data).toEqual(
      expect.objectContaining({
        trigger: "follow_up",
        userId: "owner",
        spaceId: "space",
        clientNonce: "commitment-review:item:2026-10-05T05:00:00.000Z",
      }),
    );
    expect(f.tx.scratchpadItem.updateMany.mock.calls[0]![0]!.where).toHaveProperty(
      "updatedAt",
      now,
    );
    expect(f.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: "run.continue", payload: { runId: "review" } }),
    );
  });

  it.each([{ busy: true }, { lostClaim: true }])(
    "does not duplicate active or concurrently changed work: %o",
    async (options) => {
      const f = fixture(options);
      await reconcileCommitments(f.deps, now);
      expect(f.tx.task.create).not.toHaveBeenCalled();
      expect(f.enqueue).not.toHaveBeenCalled();
    },
  );

  it("leaves the durable queued run recoverable when publication fails", async () => {
    const f = fixture({ enqueueFailure: true });
    await expect(reconcileCommitments(f.deps, now)).rejects.toThrow("queue unavailable");
    expect(f.tx.run.create).toHaveBeenCalledOnce();
    expect(f.tx.scratchpadItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reviewRunId: "review" }) }),
    );
  });

  it("stops the third automatic review's recurrence but never exhausts daily user nudges", async () => {
    for (const waitingOn of ["specialist", "user"]) {
      const f = fixture({ count: 2, waitingOn });
      await reconcileCommitments(f.deps, now);
      expect(f.tx.scratchpadItem.updateMany.mock.calls[0]![0]!.data.reviewAt).toEqual(
        waitingOn === "user" ? new Date("2026-10-06T05:00:00Z") : null,
      );
    }
  });

  it("ignores legacy notes and requires a current membership", async () => {
    const f = fixture();
    await reconcileCommitments(f.deps, now);
    expect(f.tx.bot.findFirst.mock.calls[0]![0]!.where).toHaveProperty(
      "space.memberships.some.userId",
      "owner",
    );
    f.tx.scratchpadItem.findFirst.mockResolvedValueOnce({ ...item(), commitment: null } as never);
    f.tx.run.create.mockClear();
    await reconcileCommitments(f.deps, now);
    expect(f.tx.run.create).not.toHaveBeenCalled();
  });

  it("treats task data as untrusted and demands evidence before completion", () => {
    expect(commitmentReviewPrompt("item")).toContain("not new authorization");
    expect(commitmentReviewPrompt("item")).toContain("user already answered");
    expect(commitmentReviewPrompt("item")).toContain("NO_RESPONSE");
    expect(isCommitmentReview("commitment-review:item:date")).toBe(true);
    expect(isCommitmentReview("user-request")).toBe(false);
  });
});
