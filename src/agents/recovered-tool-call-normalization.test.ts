import { describe, expect, it } from "vitest";
import { normalizeRecoveredToolCallsInAssistantMessage } from "./recovered-tool-call-normalization.js";

describe("normalizeRecoveredToolCallsInAssistantMessage", () => {
  const compat = {
    textToolCalls: {
      enabled: true,
      formats: ["codex_commentary_v1"] as const,
    },
  };

  it("renumbers duplicate recovered ids across one assistant message", () => {
    const message = {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        {
          type: "toolCall",
          id: "compat_text_call_1",
          name: "read",
          arguments: { filePath: "/tmp/a" },
        },
        {
          type: "toolCall",
          id: "compat_text_call_1",
          name: "read",
          arguments: { filePath: "/tmp/b" },
        },
      ],
    };

    normalizeRecoveredToolCallsInAssistantMessage({
      message,
      provider: "compat-provider",
      modelApi: "openai-responses",
      compat,
    });

    expect(message.content).toEqual([
      {
        type: "toolCall",
        id: "compat_text_call_1",
        name: "read",
        arguments: { path: "/tmp/a" },
      },
      {
        type: "toolCall",
        id: "compat_text_call_2",
        name: "read",
        arguments: { path: "/tmp/b" },
      },
    ]);
  });

  it("canonicalizes read.file_path to read.path", () => {
    const message = {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        {
          type: "toolCall",
          id: "compat_text_call_1",
          name: "read",
          arguments: { file_path: "/tmp/test.txt" },
        },
      ],
    };

    normalizeRecoveredToolCallsInAssistantMessage({
      message,
      provider: "compat-provider",
      modelApi: "openai-responses",
      compat,
    });

    expect(message.content).toEqual([
      {
        type: "toolCall",
        id: "compat_text_call_1",
        name: "read",
        arguments: { path: "/tmp/test.txt" },
      },
    ]);
  });

  it("canonicalizes exec.cmd to exec.command", () => {
    const message = {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        {
          type: "toolCall",
          id: "compat_text_call_1",
          name: "exec",
          arguments: { cmd: "pwd" },
        },
      ],
    };

    normalizeRecoveredToolCallsInAssistantMessage({
      message,
      provider: "compat-provider",
      modelApi: "openai-responses",
      compat,
    });

    expect(message.content).toEqual([
      {
        type: "toolCall",
        id: "compat_text_call_1",
        name: "exec",
        arguments: { command: "pwd" },
      },
    ]);
  });

  it("fails closed when alias and canonical fields both exist", () => {
    const message = {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        {
          type: "toolCall",
          id: "compat_text_call_1",
          name: "read",
          arguments: { path: "/tmp/test.txt", filePath: "/tmp/other.txt" },
        },
      ],
    };

    normalizeRecoveredToolCallsInAssistantMessage({
      message,
      provider: "compat-provider",
      modelApi: "openai-responses",
      compat,
    });

    expect(message.content).toEqual([
      {
        type: "toolCall",
        id: "compat_text_call_1",
        name: "read",
        arguments: { path: "/tmp/test.txt", filePath: "/tmp/other.txt" },
      },
    ]);
  });

  it("leaves already-canonical compat content untouched", () => {
    const message = {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        {
          type: "toolCall",
          id: "compat_text_call_1",
          name: "read",
          arguments: { path: "/tmp/test.txt" },
        },
      ],
    };

    normalizeRecoveredToolCallsInAssistantMessage({
      message,
      provider: "compat-provider",
      modelApi: "openai-responses",
      compat,
    });

    expect(message.content).toEqual([
      {
        type: "toolCall",
        id: "compat_text_call_1",
        name: "read",
        arguments: { path: "/tmp/test.txt" },
      },
    ]);
  });

  it("leaves compat-disabled content untouched", () => {
    const message = {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        {
          type: "toolCall",
          id: "compat_text_call_1",
          name: "exec",
          arguments: { cmd: "pwd" },
        },
      ],
    };

    normalizeRecoveredToolCallsInAssistantMessage({
      message,
      provider: "compat-provider",
      modelApi: "openai-responses",
      compat: {},
    });

    expect(message.content).toEqual([
      {
        type: "toolCall",
        id: "compat_text_call_1",
        name: "exec",
        arguments: { cmd: "pwd" },
      },
    ]);
  });
});
