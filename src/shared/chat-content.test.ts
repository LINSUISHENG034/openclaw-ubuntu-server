import { describe, expect, it } from "vitest";
import { extractTextFromChatContent } from "./chat-content.js";

describe("extractTextFromChatContent visible phases", () => {
  it("ignores commentary text blocks when a visible-phase filter is provided", () => {
    const result = extractTextFromChatContent(
      [
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

    expect(result).toBe("Connected: yes");
  });
});
