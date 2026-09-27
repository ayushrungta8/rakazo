import type { ElementType } from "react";
import { createElement } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  start: vi.fn(),
  finish: vi.fn(),
  cancel: vi.fn(),
  speak: vi.fn(),
  stop: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("react-native", () => ({
  Modal: "Modal",
  AppState: { addEventListener: () => ({ remove: mock.remove }) },
}));
vi.mock("../components/settings-controls", () => ({
  SettingsPage: "Page",
  SettingsButton: "Button",
  SettingsChoices: "Choices",
  SettingsText: "Text",
}));
vi.mock("./use-voice-recognition", () => ({ useVoiceRecognition: () => mock }));
vi.mock("./voice", () => ({ speakText: mock.speak, stopSpeech: mock.stop }));

import { VoiceCall } from "../components/voice-call";
import type { CallSnapshot } from "./call-input";

let view: ReactTestRenderer;
const bot = {
  botId: "bot",
  botName: "Bot",
  snapshot: { messages: [], run: null } as CallSnapshot,
  onSend: vi.fn(),
  onFollowUp: vi.fn(),
  onAnswer: vi.fn(),
  onClose: vi.fn(),
};
const button = (label: string) =>
  view.root.findAllByType("Button" as ElementType).find((node) => node.props.label === label)!;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.useFakeTimers();
  mock.stop.mockResolvedValue(undefined);
  mock.cancel.mockResolvedValue(undefined);
  bot.onSend.mockResolvedValue(undefined);
  mock.speak.mockResolvedValue(true);
  await act(async () => {
    view = create(createElement(VoiceCall, bot));
  });
});
afterEach(async () => {
  await act(async () => view.unmount());
  vi.useRealTimers();
});
it("an old no-speech retry cannot restart the microphone after an interrupt submits a message", async () => {
  await act(async () => {
    button("Start listening").props.onPress();
  });
  const first = mock.start.mock.calls[0]?.[0];
  await act(async () => {
    first.onError(new Error("No speech"), true);
    button("Interrupt").props.onPress();
  });
  expect(mock.start).toHaveBeenCalledTimes(2);
  const second = mock.start.mock.calls[1]?.[0];
  await act(async () => {
    second.onText("Do this", true);
  });
  expect(bot.onSend).toHaveBeenCalledWith("Do this");
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  expect(mock.start).toHaveBeenCalledTimes(2);
});
it("hang-up ignores a late transcript and closes without sending it", async () => {
  await act(async () => {
    button("Start listening").props.onPress();
  });
  const listening = mock.start.mock.calls[0]?.[0];
  await act(async () => {
    button("Hang up").props.onPress();
    listening.onText("Late", true);
  });
  expect(bot.onSend).not.toHaveBeenCalled();
  expect(bot.onClose).toHaveBeenCalledOnce();
});

it("sends one phrase, waits for the run, speaks the new reply, then listens again", async () => {
  await act(async () => {
    button("Start listening").props.onPress();
  });
  await act(async () => {
    mock.start.mock.calls[0]?.[0].onText("Hello", true);
  });
  await act(async () => {
    view.update(
      createElement(VoiceCall, {
        ...bot,
        snapshot: { messages: [], run: { id: "run", status: "running" } },
      }),
    );
  });
  expect(mock.speak).not.toHaveBeenCalled();
  expect(mock.start).toHaveBeenCalledTimes(1);
  await act(async () => {
    view.update(
      createElement(VoiceCall, {
        ...bot,
        snapshot: {
          messages: [
            {
              id: "reply",
              role: "bot",
              runId: "run",
              blocks: [{ kind: "text", text: "Hello back" }],
            },
          ],
          run: { id: "run", status: "completed" },
        },
      }),
    );
  });
  expect(mock.speak).toHaveBeenCalledWith("Hello back", { botId: "bot" });
  expect(mock.start).toHaveBeenCalledTimes(2);
});
it("does not resume listening when hang-up occurs while reply audio is pending", async () => {
  let finishSpeech: (played: boolean) => void = () => {};
  mock.speak.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        finishSpeech = resolve;
      }),
  );
  await act(async () => {
    button("Start listening").props.onPress();
  });
  await act(async () => {
    mock.start.mock.calls[0]?.[0].onText("Hello", true);
  });
  await act(async () => {
    view.update(
      createElement(VoiceCall, {
        ...bot,
        snapshot: {
          messages: [
            { id: "reply", role: "bot", runId: "run", blocks: [{ kind: "text", text: "Reply" }] },
          ],
          run: { id: "run", status: "completed" },
        },
      }),
    );
  });
  await act(async () => {
    button("Hang up").props.onPress();
    finishSpeech(true);
  });
  expect(mock.start).toHaveBeenCalledTimes(1);
});
it("reads a pending normal question on start and gives the spoken-answer instruction", async () => {
  await act(async () => {
    view.update(
      createElement(VoiceCall, {
        ...bot,
        snapshot: {
          messages: [
            {
              id: "ask",
              role: "bot",
              runId: "run",
              blocks: [{ kind: "ask", text: "Continue?", status: "pending" }],
            },
          ],
          run: { id: "run", status: "waiting_input" },
        },
      }),
    );
  });
  await act(async () => {
    button("Start listening").props.onPress();
  });
  expect(mock.speak).toHaveBeenCalledWith("Continue?. Say yes or no, or answer in a sentence.", {
    botId: "bot",
  });
  expect(mock.start).toHaveBeenCalledOnce();
});
it("late dispatch completion after hang-up cannot speak or restart listening", async () => {
  let finishSend: () => void = () => {};
  bot.onSend.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finishSend = resolve;
      }),
  );
  await act(async () => {
    button("Start listening").props.onPress();
  });
  await act(async () => {
    mock.start.mock.calls[0]?.[0].onText("Hello", true);
  });
  await act(async () => {
    button("Hang up").props.onPress();
    finishSend();
  });
  await act(async () => {
    view.update(
      createElement(VoiceCall, {
        ...bot,
        snapshot: {
          messages: [
            {
              id: "reply",
              role: "bot",
              runId: "run",
              blocks: [{ kind: "text", text: "Late reply" }],
            },
          ],
          run: { id: "run", status: "completed" },
        },
      }),
    );
  });
  expect(mock.speak).not.toHaveBeenCalled();
  expect(mock.start).toHaveBeenCalledTimes(1);
});
it("keeps old completed replies silent when starting a new call", async () => {
  await act(async () => {
    view.update(
      createElement(VoiceCall, {
        ...bot,
        snapshot: {
          messages: [
            {
              id: "old",
              role: "bot",
              runId: "old-run",
              blocks: [{ kind: "text", text: "Old reply" }],
            },
          ],
          run: { id: "old-run", status: "completed" },
        },
      }),
    );
  });
  await act(async () => {
    button("Start listening").props.onPress();
  });
  expect(mock.speak).not.toHaveBeenCalled();
  expect(mock.start).toHaveBeenCalledOnce();
});
it("reads a fresh question and routes the spoken response to its ask", async () => {
  await act(async () => {
    button("Start listening").props.onPress();
  });
  await act(async () => {
    mock.start.mock.calls[0]?.[0].onText("Do this", true);
  });
  const question = {
    id: "ask",
    role: "bot" as const,
    runId: "run",
    blocks: [{ kind: "ask" as const, text: "Continue?", status: "pending" as const }],
  };
  await act(async () => {
    view.update(
      createElement(VoiceCall, {
        ...bot,
        snapshot: { messages: [question], run: { id: "run", status: "waiting_input" } },
      }),
    );
  });
  expect(mock.speak).toHaveBeenCalledWith("Continue?. Say yes or no, or answer in a sentence.", {
    botId: "bot",
  });
  await act(async () => {
    mock.start.mock.calls[1]?.[0].onText("yes", true);
  });
  expect(bot.onAnswer).toHaveBeenCalledWith(question, "yes");
});
