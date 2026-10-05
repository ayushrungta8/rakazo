import type { PeerConversationPage, PeerMessagePage } from "@rakazo/contracts";

/** Refresh the newest page without dropping older pages the user explicitly opened. */
export function mergePeerMessagePage(
  current: PeerMessagePage | null,
  page: PeerMessagePage,
  older = false,
): PeerMessagePage {
  if (current?.threadId === page.threadId && current.historyGeneration > page.historyGeneration)
    return current;
  if (
    !current ||
    current.threadId !== page.threadId ||
    current.historyGeneration !== page.historyGeneration
  )
    return page;
  if (!page.messages.length) return older ? { ...current, olderCursor: null } : page;
  const key = (message: PeerMessagePage["messages"][number]) =>
    `${message.messageId}:${message.blockIndex}`;
  const entries = new Map(current.messages.map((message) => [key(message), message]));
  for (const message of page.messages) {
    if (!older || !entries.has(key(message))) entries.set(key(message), message);
  }
  const messages = [...entries.values()].sort(
    (a, b) => a.seq - b.seq || a.blockIndex - b.blockIndex,
  );
  const pageFirst = page.messages[0]!;
  const retainedOlder =
    messages[0] !== undefined &&
    (messages[0].seq < pageFirst.seq ||
      (messages[0].seq === pageFirst.seq && messages[0].blockIndex < pageFirst.blockIndex));
  return {
    ...page,
    messages,
    olderCursor: older || !retainedOlder ? page.olderCursor : current.olderCursor,
  };
}

export function mergePeerConversationPage(
  current: PeerConversationPage | null,
  page: PeerConversationPage,
  older = false,
): PeerConversationPage {
  if (current?.threadId === page.threadId && current.historyGeneration > page.historyGeneration)
    return current;
  if (
    !current ||
    current.threadId !== page.threadId ||
    current.historyGeneration !== page.historyGeneration
  )
    return page;
  if (!page.conversations.length) return older ? { ...current, nextCursor: null } : page;
  const entries = new Map(current.conversations.map((entry) => [entry.peerBotId, entry]));
  for (const entry of page.conversations) {
    const previous = entries.get(entry.peerBotId);
    if (
      !previous ||
      entry.lastSeq > previous.lastSeq ||
      (!older && entry.lastSeq === previous.lastSeq)
    )
      entries.set(entry.peerBotId, entry);
  }
  const conversations = [...entries.values()].sort(
    (a, b) => b.lastSeq - a.lastSeq || a.peerBotId.localeCompare(b.peerBotId),
  );
  const last = conversations.at(-1);
  return {
    ...page,
    conversations,
    nextCursor: older
      ? page.nextCursor
      : current.nextCursor && last
        ? { lastSeq: last.lastSeq, peerBotId: last.peerBotId }
        : page.nextCursor,
  };
}
