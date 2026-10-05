import type { AgentSkillCatalogEntry } from "@rakazo/contracts";
import type { ComposerMention } from "@rakazo/core";
import { mentionChipKey } from "@rakazo/core";
import type { MobileMessage, MobileSnapshot } from "./api";
import type { PickedAttachment } from "./pick-attachments";
import { mobileResourceCache } from "./resource-cache";

export type ThreadViewState = {
  draft: string;
  selectedMentions: ComposerMention[];
  selectedSkill: AgentSkillCatalogEntry | null;
  pendingAttachments: Array<PickedAttachment & { threadKey: string }>;
  replyTarget: MobileMessage | null;
  attachmentNotice: string | null;
  distanceFromLatest: number;
  expandedHistoryThreadId: string | null;
};

const MAX_THREAD_VIEWS = 12;
const THREAD_VIEW_TTL_MS = 5 * 60_000;
let activeScope: string | null = null;
const views = new Map<string, { value: ThreadViewState; savedAt: number }>();
const composers = new Map<string, ThreadViewState>();

mobileResourceCache.subscribe(() => {
  views.clear();
  composers.clear();
  activeScope = null;
});

function hasUnfinishedComposer(value: ThreadViewState): boolean {
  return Boolean(
    value.draft.length > 0 ||
      value.pendingAttachments.length > 0 ||
      value.selectedSkill ||
      value.selectedMentions.length > 0 ||
      value.replyTarget,
  );
}

// Native navigation state stays in memory. A new identity discards it, including an
// A → B → A switch; a late cleanup from A cannot put A's draft back into B's cache.
export function loadThreadViewState(
  scope: string,
  key: string,
  now = Date.now(),
): ThreadViewState | undefined {
  if (activeScope !== scope) {
    views.clear();
    composers.clear();
    activeScope = scope;
  }
  for (const [savedKey, entry] of views) {
    if (now - entry.savedAt >= THREAD_VIEW_TTL_MS) views.delete(savedKey);
  }
  const entry = views.get(key);
  if (!entry) {
    const composer = composers.get(key);
    return composer
      ? { ...composer, distanceFromLatest: 0, expandedHistoryThreadId: null }
      : undefined;
  }
  views.delete(key);
  views.set(key, entry);
  return entry.value;
}

export function isOlderThreadSnapshot(
  current: MobileSnapshot | null,
  next: MobileSnapshot,
): boolean {
  return Boolean(
    current?.threadId === next.threadId &&
      current.cursor !== undefined &&
      next.cursor !== undefined &&
      next.cursor < current.cursor,
  );
}

export function saveThreadViewState(
  scope: string,
  key: string,
  value: ThreadViewState,
  now = Date.now(),
): void {
  if (activeScope !== scope) return;
  // Unfinished work has no TTL or navigation limit. Sending/clearing the composer
  // releases it; identity changes release every draft. Neither map is persisted.
  if (hasUnfinishedComposer(value)) composers.set(key, value);
  else composers.delete(key);
  views.delete(key);
  views.set(key, { value, savedAt: now });
  while (views.size > MAX_THREAD_VIEWS) {
    const oldest = views.keys().next().value;
    if (oldest === undefined) break;
    views.delete(oldest);
  }
}

export function restoreUnsentThreadViewState(
  scope: string,
  key: string,
  submitted: ThreadViewState,
  fallback: ThreadViewState,
): ThreadViewState | undefined {
  if (activeScope !== scope) return undefined;
  const current = loadThreadViewState(scope, key) ?? fallback;
  const restored = {
    ...current,
    draft: current.draft ? `${submitted.draft}\n${current.draft}` : submitted.draft,
    selectedSkill: current.selectedSkill ?? submitted.selectedSkill,
    selectedMentions: [
      ...submitted.selectedMentions,
      ...current.selectedMentions.filter(
        (item) =>
          !submitted.selectedMentions.some(
            (previous) => mentionChipKey(previous) === mentionChipKey(item),
          ),
      ),
    ],
    pendingAttachments: [
      ...submitted.pendingAttachments,
      ...current.pendingAttachments.filter(
        (item) => !submitted.pendingAttachments.some((previous) => previous.id === item.id),
      ),
    ],
    replyTarget: current.replyTarget ?? submitted.replyTarget,
    attachmentNotice: current.attachmentNotice ?? submitted.attachmentNotice,
  };
  saveThreadViewState(scope, key, restored);
  return restored;
}
