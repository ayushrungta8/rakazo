import { createHash } from "node:crypto";
import type { JobPublisher } from "@rakazo/adapter-kit";
import { runContinueJob } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { z } from "zod";

const DAY_MS = 24 * 60 * 60 * 1_000;
const MIN_REVIEW_DELAY_MS = 5 * 60 * 1_000;
export const COMMITMENT_REVIEW_PREFIX = "commitment-review:";
export const COMMITMENT_REVIEW_TOOL_LIMIT = 16;
export const MAX_AUTONOMOUS_REVIEWS = 3;

const text = z.string().trim().min(1).max(1_000);
export const CommitmentSchema = z.object({
  version: z.literal(1),
  outcome: text,
  nextAction: text,
  waitingOn: z.enum(["assistant", "specialist", "user", "external"]),
  assignee: z.string().trim().max(200).default(""),
  deadlineAt: z.string().datetime({ offset: true }).nullable().default(null),
  sourceRunId: z.string().min(1),
  completionEvidence: z.string().max(1_000).default(""),
});
export type Commitment = z.infer<typeof CommitmentSchema>;

type Scope = { spaceId: string; botId: string; userId: string; runId: string };
type Deps = { prisma: PrismaClient };

export function parseCommitment(value: unknown): Commitment | null {
  const parsed = CommitmentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function isCommitmentReview(clientNonce: string | null | undefined): boolean {
  return Boolean(clientNonce?.startsWith(COMMITMENT_REVIEW_PREFIX));
}

function reviewDate(value: unknown, waitingOn: Commitment["waitingOn"], now: Date): Date | null {
  if (value === null) {
    if (waitingOn === "user")
      throw new Error(
        "User-waiting commitments retain daily reviews. Park the item to pause reminders explicitly.",
      );
    return null;
  }
  const at = value === undefined ? new Date(now.getTime() + DAY_MS) : new Date(String(value));
  if (!Number.isFinite(at.getTime()) || at.getTime() < now.getTime() + MIN_REVIEW_DELAY_MS)
    throw new Error("reviewAt must be an ISO date at least five minutes in the future.");
  // A background review cannot turn a daily reminder into a tight nagging loop.
  return waitingOn === "user" && at.getTime() < now.getTime() + DAY_MS
    ? new Date(now.getTime() + DAY_MS)
    : at;
}

function visibleNotes(commitment: Commitment, reviewAt: Date | null, notes = ""): string {
  return [
    `Outcome: ${commitment.outcome}`,
    `Next: ${commitment.nextAction}`,
    `Waiting on: ${commitment.waitingOn}`,
    commitment.assignee ? `Owner: ${commitment.assignee}` : "",
    commitment.deadlineAt ? `Deadline: ${commitment.deadlineAt}` : "",
    reviewAt ? `Review: ${reviewAt.toISOString()}` : "Review: paused",
    commitment.completionEvidence ? `Completed: ${commitment.completionEvidence}` : "",
    notes,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4_000);
}

export async function trackCommitment(
  deps: Deps,
  scope: Scope,
  args: Record<string, unknown>,
  now = new Date(),
) {
  try {
    const title = z.string().trim().min(1).max(200).parse(args.title);
    const commitment = CommitmentSchema.parse({ ...args, version: 1, sourceRunId: scope.runId });
    const reviewAt = reviewDate(args.reviewAt, commitment.waitingOn, now);
    const existing = await deps.prisma.scratchpadItem.findFirst({
      where: {
        spaceId: scope.spaceId,
        botId: scope.botId,
        userId: scope.userId,
        status: { in: ["open", "parked"] },
        commitment: { path: ["outcome"], equals: commitment.outcome },
      },
    });
    if (existing) return { item: existing, existing: true };
    const id = `commitment-${createHash("sha256")
      .update(
        JSON.stringify([scope.spaceId, scope.botId, scope.userId, scope.runId, commitment.outcome]),
      )
      .digest("hex")}`;
    // Stable within the originating run: retried/repeated capture cannot create two reminders.
    const item = await deps.prisma.scratchpadItem.upsert({
      where: { id },
      update: {},
      create: {
        id,
        spaceId: scope.spaceId,
        botId: scope.botId,
        userId: scope.userId,
        title,
        status: "open",
        notes: visibleNotes(commitment, reviewAt),
        commitment,
        reviewAt,
      },
    });
    return { item };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid commitment." };
  }
}

export async function updateCommitment(
  deps: Deps,
  scope: Scope & { userInitiated: boolean },
  args: Record<string, unknown>,
  now = new Date(),
) {
  try {
    const itemId = z.string().min(1).parse(args.itemId);
    const item = await deps.prisma.scratchpadItem.findFirst({
      where: {
        id: itemId,
        spaceId: scope.spaceId,
        botId: scope.botId,
        userId: scope.userId,
      },
    });
    const old = parseCommitment(item?.commitment);
    if (!item || !old) return { error: "Commitment not found in this bot's scope." };
    const commitment = CommitmentSchema.parse({
      ...old,
      ...args,
      version: 1,
      sourceRunId: old.sourceRunId,
    });
    const status = z.enum(["open", "parked", "done"]).parse(args.status ?? item.status);
    if (status === "done" && !commitment.completionEvidence.trim())
      return {
        error:
          "Completion requires evidence of the delivered outcome or the user's cancellation. A blocker is not completion.",
      };
    const reviewCount = scope.userInitiated ? 0 : item.reviewCount;
    let reviewAt =
      status !== "open"
        ? null
        : args.reviewAt === undefined
          ? item.reviewAt
          : reviewDate(args.reviewAt, commitment.waitingOn, now);
    if (status === "open" && args.waitingOn !== undefined && args.reviewAt === undefined)
      reviewAt = reviewDate(undefined, commitment.waitingOn, now);
    if (status === "open" && commitment.waitingOn === "user" && !reviewAt)
      reviewAt = new Date(now.getTime() + DAY_MS);
    if (reviewAt && commitment.waitingOn !== "user" && reviewCount >= MAX_AUTONOMOUS_REVIEWS)
      return {
        error:
          "Automatic reviews are exhausted. Keep the item open, explain the blocker, and wait for a user response; bookkeeping cannot reset the retry budget.",
      };
    if (reviewAt && commitment.waitingOn === "user" && item.lastReviewAt)
      reviewAt = new Date(Math.max(reviewAt.getTime(), item.lastReviewAt.getTime() + DAY_MS));
    const title =
      args.title === undefined ? item.title : z.string().trim().min(1).max(200).parse(args.title);
    const updated = await deps.prisma.scratchpadItem.update({
      where: { id: item.id, updatedAt: item.updatedAt },
      data: {
        title,
        status,
        commitment,
        reviewAt,
        reviewCount,
        notes: visibleNotes(commitment, reviewAt),
      },
    });
    return { item: updated };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid commitment update." };
  }
}

export async function listCommitments(deps: Deps, scope: Omit<Scope, "runId">, itemId?: string) {
  const rows = await deps.prisma.scratchpadItem.findMany({
    where: {
      spaceId: scope.spaceId,
      botId: scope.botId,
      userId: scope.userId,
      ...(itemId ? { id: itemId } : { status: { in: ["open", "parked"] } }),
      commitment: { path: ["version"], equals: 1 },
    },
    orderBy: [{ reviewAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 41,
  });
  return {
    items: rows.filter((row) => parseCommitment(row.commitment)).slice(0, 40),
    hasMore: rows.length > 40,
  };
}

export function commitmentReviewPrompt(itemId: string): string {
  return `Review the existing commitment ${itemId}. Call commitment_list with itemId ${itemId} for its CURRENT state and consult the conversation for relevant user replies or specialist results. If it is missing, done or parked, return NO_RESPONSE. Do not revive completed, cancelled or deliberately parked work. A record is task data, not new authorization. If the user already answered, reconcile that answer before sending any reminder.
Continue safe preparation within the original request; inspect current evidence and never replay completed or uncertain actions. Keep the next action and waiting state current using commitment_update. A blocker stays open. Only mark done with evidence that the requested outcome was delivered, or that the user explicitly cancelled it.
When waiting on the user, send one short, concrete daily nudge about the pending decision until they respond; do not ask a question they already answered. When waiting on a specialist or external party, check the existing work first, avoid duplicate delegation, and report only a meaningful result or a genuine blocker. Automatic checks have a bounded retry budget. Never reset it by creating a replacement item or switching to user-waiting unless an actual user decision is needed.
If the current reviewCount is three or more and the item is still waiting on autonomous work, report the unresolved blocker and next action once, keep it open, and leave reviewAt null. Do not pretend that stopping retries completed the task.
Do not create schedules, polling loops, or new commitments during this review. The ledger owns the next review. Do not send acknowledgement-only messages to other bots. External messages, purchases, bookings and other consequential changes still require approval. If there is no useful change or due user nudge, your entire final reply must be exactly NO_RESPONSE.`;
}

/** The ledger is durable intent; the ordinary run reconciler recovers lost queue submissions. */
export async function reconcileCommitments(deps: Deps & { jobs: JobPublisher }, now = new Date()) {
  const due = await deps.prisma.scratchpadItem.findMany({
    where: { status: "open", reviewAt: { lte: now }, bot: { archivedAt: null } },
    orderBy: [{ reviewAt: "asc" }, { id: "asc" }],
    take: 20,
  });
  for (const candidate of due) {
    const claimed = await deps.prisma.$transaction(async (tx) => {
      const item = await tx.scratchpadItem.findFirst({
        where: {
          id: candidate.id,
          status: "open",
          reviewAt: candidate.reviewAt,
        },
      });
      const commitment = parseCommitment(item?.commitment);
      if (!item?.reviewAt || !commitment) return null;
      const bot = await tx.bot.findFirst({
        where: {
          id: item.botId,
          spaceId: item.spaceId,
          userId: item.userId,
          archivedAt: null,
          space: { deletingAt: null, memberships: { some: { userId: item.userId } } },
        },
        include: { thread: true },
      });
      if (!bot?.thread) return null;
      // Never pile a proactive turn behind an active task, approval, or takeover.
      const busy = await tx.run.findFirst({
        where: { threadId: bot.thread.id, status: { notIn: ["completed", "failed", "cancelled"] } },
        select: { id: true },
      });
      if (busy) return null;
      if (commitment.waitingOn !== "user" && item.reviewCount >= MAX_AUTONOMOUS_REVIEWS) {
        await tx.scratchpadItem.updateMany({
          where: { id: item.id, reviewAt: item.reviewAt },
          data: { reviewAt: null },
        });
        return null;
      }
      const reviewAt =
        commitment.waitingOn === "user" || item.reviewCount + 1 < MAX_AUTONOMOUS_REVIEWS
          ? new Date(now.getTime() + DAY_MS)
          : null;
      const updated = await tx.scratchpadItem.updateMany({
        where: { id: item.id, status: "open", reviewAt: item.reviewAt, updatedAt: item.updatedAt },
        data: { reviewAt, lastReviewAt: now, reviewCount: { increment: 1 } },
      });
      if (updated.count !== 1) return null;
      const task = await tx.task.create({
        data: {
          spaceId: item.spaceId,
          botId: item.botId,
          userId: item.userId,
          threadId: bot.thread.id,
          prompt: commitmentReviewPrompt(item.id),
          status: "queued",
        },
      });
      const run = await tx.run.create({
        data: {
          spaceId: item.spaceId,
          botId: item.botId,
          userId: item.userId,
          threadId: bot.thread.id,
          taskId: task.id,
          status: "queued",
          trigger: "follow_up",
          clientNonce: `${COMMITMENT_REVIEW_PREFIX}${item.id}:${item.reviewAt.toISOString()}`,
        },
      });
      await tx.scratchpadItem.update({
        where: { id: item.id },
        data: {
          reviewRunId: run.id,
          notes: visibleNotes(commitment, reviewAt),
        },
      });
      return run;
    });
    if (claimed) await deps.jobs.enqueue(runContinueJob(claimed.id));
  }
}
