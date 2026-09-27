export type TeachInput = {
  kind: "pointer" | "key" | "clipboard" | "scroll";
  payload: Record<string, unknown>;
};
/** Serializes sandbox actions; only unsent move events are replaceable. */
export function createTeachInputQueue(
  send: (input: TeachInput) => Promise<unknown>,
  onError: (error: unknown) => unknown,
) {
  let pending: TeachInput[] = [];
  let running = false;
  let closed = false;
  let failure: unknown;
  const waiters: Array<() => void> = [];
  async function pump() {
    if (running) return;
    running = true;
    while (pending.length) {
      const input = pending.shift()!;
      try {
        await send(input);
      } catch (error) {
        failure = error;
        closed = true;
        pending = [];
        try {
          await onError(error);
        } catch {
          /* Preserve the original input failure. */
        }
      }
    }
    running = false;
    for (const resolve of waiters.splice(0)) resolve();
  }
  return {
    push(input: TeachInput) {
      if (closed) return;
      const last = pending.at(-1);
      if (
        input.kind === "pointer" &&
        input.payload.type === "move" &&
        last?.kind === "pointer" &&
        last.payload.type === "move"
      )
        pending[pending.length - 1] = input;
      else pending.push(input);
      void pump();
    },
    async drain() {
      if (running || pending.length) await new Promise<void>((resolve) => waiters.push(resolve));
      if (failure) throw failure;
    },
    reset() {
      if (running || pending.length) throw new Error("Input is still pending");
      closed = false;
      failure = undefined;
    },
    close() {
      closed = true;
    },
  };
}
