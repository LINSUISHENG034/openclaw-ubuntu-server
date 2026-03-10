import { describe, expect, it } from "vitest";
import { applyTextToolCallCompatToTextBlock } from "../agents/text-tool-call-compat.js";
import { extractTextFromChatContent } from "./chat-content.js";

describe("extractTextFromChatContent text tool-call compat regressions", () => {
  it("preserves normal text after compatibility conversion removes pseudo-tool text", () => {
    const compatContent = applyTextToolCallCompatToTextBlock({
      text: 'Connected.\n\nto=exec commentary code\n{"command":"pwd"}',
      compat: {
        enabled: true,
        formats: ["codex_commentary_v1"],
        allowMixedText: true,
      },
      allowedToolNames: new Set(["exec"]),
    }).content;

    const result = extractTextFromChatContent(compatContent);

    expect(result).toBe("Connected.");
  });

  it("returns null when only commentary-phase pseudo-call text is present", () => {
    const result = extractTextFromChatContent(
      [
        {
          type: "text",
          text: 'to=exec commentary code\n{"command":"pwd"}',
          textSignature: '{"v":1,"phase":"commentary"}',
        },
      ],
      {
        includeTextBlock: (block) => {
          const raw = block.textSignature;
          if (typeof raw !== "string") {
            return true;
          }
          const parsed = JSON.parse(raw) as { phase?: string };
          return parsed.phase !== "commentary";
        },
      },
    );

    expect(result).toBeNull();
  });
});
