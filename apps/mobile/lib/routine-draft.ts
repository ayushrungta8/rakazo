import type { Routine } from "@rakazo/contracts";
import { CreateRoutineInput } from "@rakazo/contracts";
import { isOneShotRoutineCrons } from "@rakazo/core";

export function routineInput(
  botId: string,
  draft: {
    name: string;
    prompt: string;
    schedules: string;
    timezone: string;
    active: boolean;
    notify: boolean;
    webhookEnabled: boolean;
    githubEnabled: boolean;
    messageProvider: string;
  },
) {
  const result = CreateRoutineInput.parse({
    ...draft,
    botId,
    name: draft.name.trim(),
    prompt: draft.prompt.trim(),
    timezone: draft.timezone.trim(),
    crons: draft.schedules
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    messageProvider: draft.messageProvider.trim() || null,
  });
  try {
    new Intl.DateTimeFormat("en", { timeZone: result.timezone });
  } catch {
    throw new Error("Enter a valid timezone");
  }
  return result;
}
export function oneShotRunAt(
  crons: string[],
  local: string,
  existing?: Pick<Routine, "nextRunAt" | "lastRunAt">,
  active = true,
): string | undefined {
  if (!active || !isOneShotRoutineCrons(crons) || existing?.nextRunAt || existing?.lastRunAt)
    return undefined;
  const date = new Date(local);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())
    throw new Error("Choose a future date and time");
  return date.toISOString();
}
