import { describe, expect, it, vi } from "vitest";
import {
  createTextEndBlockReplyHarness,
  emitAssistantTextDelta,
  emitAssistantTextEnd,
} from "./pi-embedded-subscribe.e2e-harness.js";

describe("subscribeEmbeddedPiSession codex commentary filtering", () => {
  it("does not emit codex tool-call commentary blocks to onBlockReply", async () => {
    const onBlockReply = vi.fn();
    const { emit } = createTextEndBlockReplyHarness({ onBlockReply });

    emitAssistantTextDelta({
      emit,
      delta:
        'to=exec commentary code\n{"command":["bash","-lc","bluetoothctl info 24:C4:06:FA:00:37"],"yieldMs":1000}',
    });
    emitAssistantTextDelta({ emit, delta: "Connected: yes" });
    emitAssistantTextEnd({ emit, content: "Connected: yes" });
    await Promise.resolve();

    expect(onBlockReply).toHaveBeenCalledTimes(1);
    expect(onBlockReply.mock.calls[0]?.[0]?.text).toBe("Connected: yes");
  });
});
