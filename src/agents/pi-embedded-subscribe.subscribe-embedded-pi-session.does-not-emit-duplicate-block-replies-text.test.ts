import type { AssistantMessage } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import {
  createStubSessionHarness,
  createSubscribedSessionHarness,
  createTextEndBlockReplyHarness,
  emitAssistantTextDelta,
  emitAssistantTextEnd,
} from "./pi-embedded-subscribe.e2e-harness.js";
import { subscribeEmbeddedPiSession } from "./pi-embedded-subscribe.js";

describe("subscribeEmbeddedPiSession", () => {
  it("does not emit duplicate block replies when text_end repeats", async () => {
    const onBlockReply = vi.fn();
    const { emit, subscription } = createTextEndBlockReplyHarness({ onBlockReply });

    emitAssistantTextDelta({ emit, delta: "Hello block" });
    emitAssistantTextEnd({ emit });
    emitAssistantTextEnd({ emit });
    await Promise.resolve();

    expect(onBlockReply).toHaveBeenCalledTimes(1);
    expect(subscription.assistantTexts).toEqual(["Hello block"]);
  });
  it("does not duplicate assistantTexts when message_end repeats", () => {
    const { session, emit } = createStubSessionHarness();

    const subscription = subscribeEmbeddedPiSession({
      session,
      runId: "run",
    });

    const assistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Hello world" }],
    } as AssistantMessage;

    emit({ type: "message_end", message: assistantMessage });
    emit({ type: "message_end", message: assistantMessage });

    expect(subscription.assistantTexts).toEqual(["Hello world"]);
  });
  it("does not duplicate assistantTexts when message_end repeats with trailing whitespace changes", () => {
    const { session, emit } = createStubSessionHarness();

    const subscription = subscribeEmbeddedPiSession({
      session,
      runId: "run",
    });

    const assistantMessageWithNewline = {
      role: "assistant",
      content: [{ type: "text", text: "Hello world\n" }],
    } as AssistantMessage;

    const assistantMessageTrimmed = {
      role: "assistant",
      content: [{ type: "text", text: "Hello world" }],
    } as AssistantMessage;

    emit({ type: "message_end", message: assistantMessageWithNewline });
    emit({ type: "message_end", message: assistantMessageTrimmed });

    expect(subscription.assistantTexts).toEqual(["Hello world"]);
  });
  it("does not store raw pseudo tool-call text from message_end", () => {
    const { session, emit } = createStubSessionHarness();

    const subscription = subscribeEmbeddedPiSession({
      session,
      runId: "run",
    });

    emit({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: '{"tool":"read","args":{"path":"/tmp/secret"}}',
          },
        ],
      } as AssistantMessage,
    });

    expect(subscription.assistantTexts).toEqual([]);
  });
  it("keeps visible text while stripping leaked pseudo tool-call text", () => {
    const { emit, subscription } = createTextEndBlockReplyHarness();

    emitAssistantTextDelta({
      emit,
      delta: [
        "Running diagnostics.",
        "",
        '{"tool":"read","args":{"path":"/tmp/secret"}}',
        "",
        "Done.",
      ].join("\n"),
    });
    emitAssistantTextEnd({ emit });

    expect(subscription.assistantTexts).toEqual(["Running diagnostics.\n\nDone."]);
  });
  it("does not emit raw pseudo tool-call text through streamed assistant updates", async () => {
    const onBlockReply = vi.fn();
    const { emit, subscription } = createTextEndBlockReplyHarness({ onBlockReply });

    emitAssistantTextDelta({
      emit,
      delta: 'to=exec commentary code\n{"command":"pwd","yieldMs":1000}\n\nDone.',
    });
    emitAssistantTextEnd({ emit });
    await Promise.resolve();

    expect(subscription.assistantTexts).toEqual(["Done."]);
    expect(onBlockReply).toHaveBeenCalledWith(expect.objectContaining({ text: "Done." }));
  });
  it("does not store assistant text from toolUse message_end", () => {
    const { session, emit } = createStubSessionHarness();

    const subscription = subscribeEmbeddedPiSession({
      session,
      runId: "run",
    });

    emit({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "toolUse",
        content: [
          {
            type: "text",
            text: "[[reply_to_current]] 我先直接查主机上的蓝牙与音频状态。",
          },
          {
            type: "toolCall",
            id: "tool_1",
            name: "exec",
            arguments: { command: "bluetoothctl info 24:C4:06:FA:00:37" },
          },
        ],
      } as AssistantMessage,
    });

    expect(subscription.assistantTexts).toEqual([]);
  });
  it("keeps only the later stop reply when a toolUse assistant message carried early answer text", () => {
    const { session, emit } = createStubSessionHarness();

    const subscription = subscribeEmbeddedPiSession({
      session,
      runId: "run",
    });

    emit({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "toolUse",
        content: [
          {
            type: "text",
            text: "[[reply_to_current]] 晚上好，林先森，我先查一下。",
          },
          {
            type: "toolCall",
            id: "tool_1",
            name: "read",
            arguments: { path: "/tmp/USER.md" },
          },
        ],
      } as AssistantMessage,
    });

    emit({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "[[reply_to_current]] Result: 设备已连接。" }],
      } as AssistantMessage,
    });

    expect(subscription.assistantTexts).toEqual(["[[reply_to_current]] Result: 设备已连接。"]);
  });
  it("does not duplicate assistantTexts when message_end repeats with reasoning blocks", () => {
    const { session, emit } = createStubSessionHarness();

    const subscription = subscribeEmbeddedPiSession({
      session,
      runId: "run",
      reasoningMode: "on",
    });

    const assistantMessage = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Because" },
        { type: "text", text: "Hello world" },
      ],
    } as AssistantMessage;

    emit({ type: "message_end", message: assistantMessage });
    emit({ type: "message_end", message: assistantMessage });

    expect(subscription.assistantTexts).toEqual(["Hello world"]);
  });
  it("does not emit commentary block replies from a toolUse assistant message (message_end mode)", async () => {
    const onBlockReply = vi.fn();
    const { emit, subscription } = createSubscribedSessionHarness({
      runId: "run",
      onBlockReply,
      blockReplyBreak: "message_end",
    });

    emit({ type: "message_start", message: { role: "assistant" } });
    emitAssistantTextDelta({ emit, delta: "我先检查本机蓝牙和音频状态。" });
    emitAssistantTextEnd({ emit });
    emitAssistantTextDelta({ emit, delta: "进展还行：设备和音频后端已在查。" });
    emitAssistantTextEnd({ emit });

    emit({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "toolUse",
        content: [
          { type: "text", text: "我先检查本机蓝牙和音频状态。" },
          {
            type: "toolCall",
            id: "call_1",
            name: "exec",
            arguments: { command: "bluetoothctl show" },
          },
          { type: "text", text: "进展还行：设备和音频后端已在查。" },
        ],
      } as AssistantMessage,
    });
    await Promise.resolve();

    expect(onBlockReply).not.toHaveBeenCalled();
    expect(subscription.assistantTexts).toEqual([]);
  });
  it("delivers the final stop reply after suppressing toolUse interim text (message_end mode)", async () => {
    const onBlockReply = vi.fn();
    const { emit, subscription } = createSubscribedSessionHarness({
      runId: "run",
      onBlockReply,
      blockReplyBreak: "message_end",
    });

    // First message: toolUse with commentary — should be suppressed
    emit({ type: "message_start", message: { role: "assistant" } });
    emitAssistantTextDelta({ emit, delta: "让我检查一下。" });
    emitAssistantTextEnd({ emit });
    emit({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "toolUse",
        content: [
          { type: "text", text: "让我检查一下。" },
          { type: "toolCall", id: "call_1", name: "exec", arguments: { command: "ls" } },
        ],
      } as AssistantMessage,
    });
    await Promise.resolve();
    expect(onBlockReply).not.toHaveBeenCalled();

    // Second message: final stop reply — should be delivered
    emit({ type: "message_start", message: { role: "assistant" } });
    emitAssistantTextDelta({ emit, delta: "检查完毕，一切正常。" });
    emitAssistantTextEnd({ emit });
    emit({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "检查完毕，一切正常。" }],
      } as AssistantMessage,
    });
    await Promise.resolve();

    expect(onBlockReply).toHaveBeenCalledTimes(1);
    expect(onBlockReply).toHaveBeenCalledWith(
      expect.objectContaining({ text: "检查完毕，一切正常。" }),
    );
    expect(subscription.assistantTexts).toEqual(["检查完毕，一切正常。"]);
  });
  it("populates assistantTexts for non-streaming models with chunking enabled", () => {
    // Non-streaming models (e.g. zai/glm-4.7): no text_delta events; message_end
    // must still populate assistantTexts so providers can deliver a final reply.
    const { session, emit } = createStubSessionHarness();

    const subscription = subscribeEmbeddedPiSession({
      session,
      runId: "run",
      blockReplyChunking: { minChars: 50, maxChars: 200 }, // Chunking enabled
    });

    // Simulate non-streaming model: only message_start and message_end, no text_delta
    emit({ type: "message_start", message: { role: "assistant" } });

    const assistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Response from non-streaming model" }],
    } as AssistantMessage;

    emit({ type: "message_end", message: assistantMessage });

    expect(subscription.assistantTexts).toEqual(["Response from non-streaming model"]);
  });
});
