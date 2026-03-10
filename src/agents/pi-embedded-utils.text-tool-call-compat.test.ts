import type { AssistantMessage } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { extractAssistantText, stripDowngradedToolCallText } from "./pi-embedded-utils.js";

function makeAssistantMessage(
  message: Omit<AssistantMessage, "api" | "provider" | "model" | "usage" | "stopReason"> &
    Partial<Pick<AssistantMessage, "api" | "provider" | "model" | "usage" | "stopReason">>,
): AssistantMessage {
  return {
    api: "responses",
    provider: "openai",
    model: "gpt-5",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    ...message,
  };
}

describe("pi-embedded-utils text tool-call compat regressions", () => {
  it("keeps only final-answer text blocks when commentary blocks are present", () => {
    const msg = makeAssistantMessage({
      role: "assistant",
      content: [
        {
          type: "text",
          text: 'to=exec commentary code\n{"command":["bash","-lc","bluetoothctl info 24:C4:06:FA:00:37"]}',
          textSignature: '{"v":1,"phase":"commentary"}',
        },
        {
          type: "text",
          text: "Connected: yes",
          textSignature: '{"v":1,"phase":"final_answer"}',
        },
      ],
      timestamp: Date.now(),
    });

    expect(extractAssistantText(msg)).toBe("Connected: yes");
  });

  it("strips codex-style to=tool commentary blocks", () => {
    const text =
      'to=exec commentary code\n{"command":["bash","-lc","bluetoothctl info 24:C4:06:FA:00:37"],"yieldMs":1000}';
    expect(stripDowngradedToolCallText(text)).toBe("");
  });

  it("strips leaked codex-style to=tool text while preserving surrounding user-facing text", () => {
    const text = [
      "Running diagnostics.",
      "",
      'to=exec commentary code\n{"command":"pwd","yieldMs":1000}',
      "",
      "Done.",
    ].join("\n");

    expect(stripDowngradedToolCallText(text)).toBe("Running diagnostics.\n\nDone.");
  });

  it("does not surface commentary-only pseudo-call text", () => {
    const msg = makeAssistantMessage({
      role: "assistant",
      content: [
        {
          type: "text",
          text: 'to=exec commentary code\n{"command":"pwd"}',
          textSignature: '{"v":1,"phase":"commentary"}',
        },
      ],
      timestamp: Date.now(),
    });

    expect(extractAssistantText(msg)).toBe("");
  });
});
