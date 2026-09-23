import { Trans } from "@lingui/react/macro";
import { Button } from "@rakazo/ui-web";
import { useEffect, useRef, useState } from "react";
import { requestDeviceLocation } from "../lib/device-location";

export function LocationAskActions({ onAnswer }: { onAnswer: (answer: string) => Promise<void> }) {
  const operation = useRef<AbortController | null>(null);
  const [pending, setPending] = useState<"locating" | "sending" | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const cancel = () => {
      if (document.visibilityState === "hidden") operation.current?.abort();
    };
    document.addEventListener("visibilitychange", cancel);
    return () => {
      operation.current?.abort();
      document.removeEventListener("visibilitychange", cancel);
    };
  }, []);

  async function answer(share: boolean) {
    if (operation.current) {
      if (share || pending === "sending") return;
      operation.current.abort();
    }
    const controller = new AbortController();
    operation.current = controller;
    setError(null);
    setPending(share ? "locating" : "sending");
    try {
      const value = share ? await requestDeviceLocation(controller.signal) : "location-declined";
      if (controller.signal.aborted) return;
      setPending("sending");
      await onAnswer(value);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not share location. Please try again.",
        );
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setPending(null);
      }
    }
  }

  return (
    <div className="mt-3.5 space-y-3" data-testid="location-ask-actions">
      <p className="text-[13px] leading-5 text-muted-foreground">
        <Trans>Shared with this bot and its AI provider. Saved in this conversation.</Trans>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={pending !== null}
          onClick={() => void answer(true)}
        >
          {pending === "locating" ? (
            <Trans>Finding location…</Trans>
          ) : pending === "sending" ? (
            <Trans>Sending…</Trans>
          ) : (
            <Trans>Share current location</Trans>
          )}
        </Button>
        <Button
          variant="outline"
          className="min-h-11 sm:min-h-8"
          disabled={pending === "sending"}
          onClick={() => void answer(false)}
        >
          <Trans>Not now</Trans>
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
