import { describe, expect, it } from "vitest";
import { applyTextToolCallCompatToTextBlock, parseTextToolCalls } from "./text-tool-call-compat.js";

describe("parseTextToolCalls", () => {
  const compat = {
    enabled: true,
    formats: ["codex_commentary_v1"] as const,
  };

  it("extracts exec calls with JSON object arguments", () => {
    const result = parseTextToolCalls({
      text: 'to=exec commentary code\n{"command":"pwd","yieldMs":1000}',
      compat,
    });

    expect(result.text).toBe("");
    expect(result.toolCalls).toEqual([
      {
        id: "compat_text_call_1",
        name: "exec",
        arguments: { command: "pwd", yieldMs: 1000 },
      },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("extracts read calls with JSON object arguments", () => {
    const result = parseTextToolCalls({
      text: 'to=read commentary code\n{"path":"src/index.ts"}',
      compat,
    });

    expect(result.text).toBe("");
    expect(result.toolCalls).toEqual([
      {
        id: "compat_text_call_1",
        name: "read",
        arguments: { path: "src/index.ts" },
      },
    ]);
  });

  it("extracts inline codex calls with JSON object arguments on the same line", () => {
    const result = parseTextToolCalls({
      text: 'to=exec {"command":"pwd","yieldMs":1000}',
      compat,
    });

    expect(result.text).toBe("");
    expect(result.toolCalls).toEqual([
      {
        id: "compat_text_call_1",
        name: "exec",
        arguments: { command: "pwd", yieldMs: 1000 },
      },
    ]);
  });

  it("extracts json pseudo-call blocks with tool and args fields", () => {
    const result = parseTextToolCalls({
      text: [
        "先确认主机侧控制方法，再动手连蓝牙和出声。",
        "",
        '{"tool":"read","args":{"filePath":"/tmp/test.txt"}}',
      ].join("\n"),
      compat: {
        ...compat,
        allowMixedText: true,
      },
      allowedToolNames: new Set(["read"]),
    });

    expect(result.text).toBe("先确认主机侧控制方法，再动手连蓝牙和出声。");
    expect(result.toolCalls).toEqual([
      {
        id: "compat_text_call_1",
        name: "read",
        arguments: { filePath: "/tmp/test.txt" },
      },
    ]);
  });

  it("extracts bracket pseudo-call blocks for read tool invocations", () => {
    const result = parseTextToolCalls({
      text: [
        "先检查主机控制方式。",
        "",
        "[Tool call: read `/home/lin/.openclaw/skills/deployment-host-diagnostics/SKILL.md`]",
      ].join("\n"),
      compat: {
        ...compat,
        allowMixedText: true,
      },
      allowedToolNames: new Set(["read"]),
    });

    expect(result.text).toBe("先检查主机控制方式。");
    expect(result.toolCalls).toEqual([
      {
        id: "compat_text_call_1",
        name: "read",
        arguments: {
          path: "/home/lin/.openclaw/skills/deployment-host-diagnostics/SKILL.md",
        },
      },
    ]);
  });

  it("maps bracket read pseudo-calls to path", () => {
    const result = parseTextToolCalls({
      text: "[Tool call: read `/tmp/test.txt`]",
      compat,
      allowedToolNames: new Set(["read"]),
    });

    expect(result.toolCalls).toEqual([
      {
        id: "compat_text_call_1",
        name: "read",
        arguments: { path: "/tmp/test.txt" },
      },
    ]);
  });

  it("maps bracket exec pseudo-calls to command", () => {
    const result = parseTextToolCalls({
      text: "[Tool call: exec `pwd`]",
      compat,
      allowedToolNames: new Set(["exec"]),
    });

    expect(result.toolCalls).toEqual([
      {
        id: "compat_text_call_1",
        name: "exec",
        arguments: { command: "pwd" },
      },
    ]);
  });

  it("preserves surrounding text when mixed text is allowed", () => {
    const result = parseTextToolCalls({
      text: 'Running now.\n\nto=exec commentary code\n{"command":"pwd"}\n\nDone.',
      compat: {
        ...compat,
        allowMixedText: true,
      },
    });

    expect(result.text).toBe("Running now.\n\nDone.");
    expect(result.toolCalls).toEqual([
      {
        id: "compat_text_call_1",
        name: "exec",
        arguments: { command: "pwd" },
      },
    ]);
  });

  it("rejects malformed JSON", () => {
    const result = parseTextToolCalls({
      text: 'to=exec commentary code\n{"command":"pwd"',
      compat,
    });

    expect(result.text).toBe('to=exec commentary code\n{"command":"pwd"');
    expect(result.toolCalls).toEqual([]);
    expect(result.diagnostics).toEqual([
      { level: "debug", reason: "invalid_json", format: "codex_commentary_v1" },
    ]);
  });

  it("rejects unknown tool names when required", () => {
    const result = parseTextToolCalls({
      text: 'to=unknown commentary code\n{"command":"pwd"}',
      compat: {
        ...compat,
        requireKnownToolName: true,
      },
      allowedToolNames: new Set(["exec", "read"]),
    });

    expect(result.text).toBe('to=unknown commentary code\n{"command":"pwd"}');
    expect(result.toolCalls).toEqual([]);
    expect(result.diagnostics).toEqual([
      { level: "debug", reason: "unknown_tool_name", format: "codex_commentary_v1" },
    ]);
  });

  it("stops after maxCallsPerMessage", () => {
    const result = parseTextToolCalls({
      text: [
        'to=exec commentary code\n{"command":"pwd"}',
        'to=read commentary code\n{"path":"src/index.ts"}',
      ].join("\n\n"),
      compat: {
        ...compat,
        maxCallsPerMessage: 1,
        allowMixedText: true,
      },
    });

    expect(result.toolCalls).toEqual([
      {
        id: "compat_text_call_1",
        name: "exec",
        arguments: { command: "pwd" },
      },
    ]);
    expect(result.text).toBe('to=read commentary code\n{"path":"src/index.ts"}');
    expect(result.diagnostics).toEqual([
      { level: "debug", reason: "max_calls_reached", format: "codex_commentary_v1" },
    ]);
  });

  it("does nothing when disabled", () => {
    const text = 'to=exec commentary code\n{"command":"pwd"}';
    const result = parseTextToolCalls({
      text,
      compat: {
        ...compat,
        enabled: false,
      },
    });

    expect(result.text).toBe(text);
    expect(result.toolCalls).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts arbitrary source text without adapter-specific assumptions", () => {
    const result = parseTextToolCalls({
      text: 'prefix\n\nto=exec commentary code\n{"command":"pwd"}\n',
      compat: {
        ...compat,
        allowMixedText: true,
      },
    });

    expect(result.text).toBe("prefix");
    expect(result.toolCalls).toEqual([
      {
        id: "compat_text_call_1",
        name: "exec",
        arguments: { command: "pwd" },
      },
    ]);
  });

  it("can be called repeatedly without mutating the input or result shape", () => {
    const text = 'to=exec commentary code\n{"command":"pwd"}';
    const first = parseTextToolCalls({ text, compat });
    const second = parseTextToolCalls({ text, compat });

    expect(text).toBe('to=exec commentary code\n{"command":"pwd"}');
    expect(second).toEqual(first);
  });

  it("returns diagnostics even when no tool call is produced", () => {
    const result = parseTextToolCalls({
      text: "Plain visible answer",
      compat,
    });

    expect(result.toolCalls).toEqual([]);
    expect(result.text).toBe("Plain visible answer");
    expect(result.diagnostics).toEqual([
      { level: "debug", reason: "no_tool_call_match", format: "codex_commentary_v1" },
    ]);
  });
});

describe("applyTextToolCallCompatToTextBlock", () => {
  it("maps parser output into internal text and toolCall blocks", () => {
    const result = applyTextToolCallCompatToTextBlock({
      text: 'Running.\n\nto=exec commentary code\n{"command":"pwd"}',
      compat: {
        enabled: true,
        formats: ["codex_commentary_v1"],
        allowMixedText: true,
      },
      allowedToolNames: new Set(["exec"]),
    });

    expect(result).toEqual({
      content: [
        { type: "text", text: "Running." },
        {
          type: "toolCall",
          id: "compat_text_call_1",
          name: "exec",
          arguments: { command: "pwd" },
        },
      ],
      diagnostics: [],
    });
  });
});
