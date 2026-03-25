import type { AssistantMessage } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { resolveEffectiveBlockReplyBreak } from "./pi-embedded-runner/run/attempt.js";
import {
  createSubscribedSessionHarness,
  emitAssistantTextDelta,
} from "./pi-embedded-subscribe.e2e-harness.js";

const LAB_TOOL_COMMENTARY = "我先检查蓝牙和音频状态。";
const LAB_TOOL_COMMAND = "bluetoothctl show";
const LAB_FINAL_REPLY = "[[reply_to_current]] 已处理，`Aura Studio 5` 这边我成功触发了一次测试音。";
const TEXT_TOOL_CALL_COMPAT = {
  textToolCalls: {
    enabled: true,
    formats: ["codex_commentary_v1"],
    requireKnownToolName: true,
    allowMixedText: true,
    maxCallsPerMessage: 4,
  },
} as const;

function createCompatHarness() {
  const onBlockReply = vi.fn();
  const { emit, subscription } = createSubscribedSessionHarness({
    runId: "compat-text-tool-call-replay",
    onBlockReply,
    blockReplyBreak: resolveEffectiveBlockReplyBreak({
      compat: TEXT_TOOL_CALL_COMPAT,
      requested: "text_end",
    }),
  });
  return { emit, subscription, onBlockReply };
}

async function flushAsyncHandlers() {
  await Promise.resolve();
  await Promise.resolve();
}

function emitToolExecutionStart(emit: (evt: unknown) => void) {
  emit({
    type: "tool_execution_start",
    toolName: "exec",
    toolCallId: "compat_text_call_2",
    args: { command: LAB_TOOL_COMMAND },
  });
}

function emitToolUseMessageEnd(emit: (evt: unknown) => void) {
  emit({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        {
          type: "toolCall",
          id: "compat_text_call_2",
          name: "exec",
          arguments: { command: LAB_TOOL_COMMAND },
        },
      ],
    } as AssistantMessage,
  });
}

function emitFinalStopReply(emit: (evt: unknown) => void) {
  emit({
    type: "message_start",
    message: { role: "assistant" },
  });
  emitAssistantTextDelta({ emit, delta: LAB_FINAL_REPLY });
  emit({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: LAB_FINAL_REPLY }],
    } as AssistantMessage,
  });
}

async function replayCompatToolUseTurn(emit: (evt: unknown) => void) {
  // Real compat leak shape:
  // 1. Compat text-tool-call mode rewrites text_end delivery to message_end.
  // 2. The model streams commentary text before requesting tools.
  // 3. tool_execution_start flushes the buffer before toolUse message_end can suppress it.
  emit({
    type: "message_start",
    message: { role: "assistant" },
  });
  emitAssistantTextDelta({ emit, delta: LAB_TOOL_COMMENTARY });
  emitToolExecutionStart(emit);
  await flushAsyncHandlers();
  emitToolUseMessageEnd(emit);
  emitFinalStopReply(emit);
  await flushAsyncHandlers();
}

describe("subscribeEmbeddedPiSession compat replay", () => {
  it("keeps compat toolUse commentary internal until the later final stop reply arrives", async () => {
    const { emit, subscription, onBlockReply } = createCompatHarness();

    await replayCompatToolUseTurn(emit);

    expect(onBlockReply).toHaveBeenCalledTimes(1);
    expect(onBlockReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "已处理，`Aura Studio 5` 这边我成功触发了一次测试音。",
        replyToCurrent: true,
      }),
    );
    expect(subscription.assistantTexts).toEqual([LAB_FINAL_REPLY]);
  });
});
