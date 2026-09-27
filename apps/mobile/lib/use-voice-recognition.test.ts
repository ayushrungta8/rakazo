import { createElement } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  recorder: {
    uri: "file:///cache/clip.m4a",
    record: vi.fn(),
    stop: vi.fn(),
    prepareToRecordAsync: vi.fn(),
    getStatus: vi.fn(),
  },
  mode: vi.fn(),
  permission: vi.fn(),
  api: vi.fn(),
  context: vi.fn(),
  consent: vi.fn(),
  deleted: vi.fn(),
}));
vi.mock("expo-audio", () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  useAudioRecorder: () => mock.recorder,
  requestRecordingPermissionsAsync: mock.permission,
  setAudioModeAsync: mock.mode,
}));
vi.mock("expo-file-system", () => ({
  File: class {
    size = 20;
    base64 = async () => "AAAA";
    delete = mock.deleted;
  },
}));
vi.mock("./native-dictation", () => ({
  cancelDictation: vi.fn(),
  finishDictation: vi.fn(),
  listenNative: vi.fn(),
}));
vi.mock("./api", () => ({ captureApiRequestContext: mock.context, rpc: mock.api }));
vi.mock("./ai-consent", () => ({ promptAiConsent: mock.consent }));

import { useVoiceRecognition } from "./use-voice-recognition";

let view: ReactTestRenderer;
let recognition: ReturnType<typeof useVoiceRecognition>;
function Harness() {
  recognition = useVoiceRecognition();
  return null;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mock.permission.mockResolvedValue({ granted: true });
  mock.context.mockResolvedValue({
    apiBase: "https://voice.example",
    headers: { authorization: "Bearer fake" },
  });
  mock.api.mockImplementation(async (path: string) =>
    path === "voice/status" ? { transcribe: true } : { version: "2026-09-14", recipients: [] },
  );
  mock.recorder.getStatus.mockReturnValue({ metering: -50 });
  await act(async () => {
    view = create(createElement(Harness));
  });
});
afterEach(async () => {
  await act(async () => {
    view.unmount();
  });
  vi.unstubAllGlobals();
});
it("does not record after cancellation while microphone permission is pending", async () => {
  let grant: (value: { granted: boolean }) => void = () => {};
  mock.permission.mockImplementation(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  const operation = recognition.start({ mode: "provider", onText: vi.fn(), onError: vi.fn() });
  await vi.waitFor(() => expect(mock.permission).toHaveBeenCalled());
  await recognition.cancel();
  grant({ granted: true });
  await operation;
  expect(mock.recorder.record).not.toHaveBeenCalled();
});
it("keeps transcription on the account captured at recording start and deletes its cache", async () => {
  const onText = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ text: "Hello" }))),
  );
  await recognition.start({ mode: "provider", onText, onError: vi.fn() });
  mock.context.mockResolvedValue({ apiBase: "https://changed.example", headers: {} });
  await recognition.finish();
  expect(fetch).toHaveBeenCalledWith(
    "https://voice.example/api/voice/transcribe",
    expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer fake" }) }),
  );
  expect(onText).toHaveBeenCalledWith("Hello", true);
  expect(mock.deleted).toHaveBeenCalled();
});
it("does not submit late transcription after hang-up", async () => {
  const onText = vi.fn();
  let resolveResponse: (response: Response) => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    ),
  );
  await recognition.start({ mode: "provider", onText, onError: vi.fn() });
  const finish = recognition.finish();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  const canceled = recognition.cancel();
  resolveResponse(new Response(JSON.stringify({ text: "Late" })));
  await finish;
  await canceled;
  expect(onText).not.toHaveBeenCalled();
  expect(mock.deleted).toHaveBeenCalled();
});

it("does not restart recording after hang-up during an earlier stop", async () => {
  await recognition.start({ mode: "provider", onText: vi.fn(), onError: vi.fn() });
  let release: () => void = () => {};
  mock.recorder.stop.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const restarting = recognition.start({ mode: "provider", onText: vi.fn(), onError: vi.fn() });
  await vi.waitFor(() => expect(mock.recorder.stop).toHaveBeenCalled());
  const canceled = recognition.cancel();
  release();
  await restarting;
  await canceled;
  expect(mock.recorder.record).toHaveBeenCalledTimes(1);
});
it("serializes preparation so canceled setup cannot delete a fresh recording", async () => {
  let release: () => void = () => {};
  mock.recorder.prepareToRecordAsync.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const first = recognition.start({ mode: "provider", onText: vi.fn(), onError: vi.fn() });
  await vi.waitFor(() => expect(mock.recorder.prepareToRecordAsync).toHaveBeenCalled());
  const canceled = recognition.cancel();
  const second = recognition.start({ mode: "provider", onText: vi.fn(), onError: vi.fn() });
  release();
  await first;
  await canceled;
  await second;
  expect(mock.recorder.record).toHaveBeenCalledTimes(1);
  expect(mock.deleted).toHaveBeenCalledTimes(1);
});

it("restores playback mode after finishing and after cancellation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ text: "Hello" }))),
  );
  await recognition.start({ mode: "provider", onText: vi.fn(), onError: vi.fn() });
  expect(mock.mode).toHaveBeenLastCalledWith(expect.objectContaining({ allowsRecording: true }));
  await recognition.finish();
  expect(mock.mode).toHaveBeenLastCalledWith(expect.objectContaining({ allowsRecording: false }));
  await recognition.start({ mode: "provider", onText: vi.fn(), onError: vi.fn() });
  await recognition.cancel();
  expect(mock.mode).toHaveBeenLastCalledWith(expect.objectContaining({ allowsRecording: false }));
});
