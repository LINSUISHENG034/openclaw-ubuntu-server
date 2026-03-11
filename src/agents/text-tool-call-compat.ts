import type { TextToolCallCompatConfig, TextToolCallFormat } from "../config/types.models.js";

export type TextToolCallCompatContentBlock =
  | { type: "text"; text: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

export type ParsedTextToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type TextToolCallCompatDiagnostic = {
  level: "debug";
  reason: string;
  format?: TextToolCallFormat;
};

export type TextToolCallCompatResult = {
  text: string;
  toolCalls: ParsedTextToolCall[];
  diagnostics: TextToolCallCompatDiagnostic[];
};

export type TextToolCallCompatAppliedResult = {
  content: TextToolCallCompatContentBlock[];
  diagnostics: TextToolCallCompatDiagnostic[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function consumeJsonObject(
  text: string,
  start: number,
): { start: number; end: number; value: Record<string, unknown> } | null {
  let index = start;
  while (index < text.length) {
    const ch = text[index];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      index += 1;
      continue;
    }
    break;
  }

  if (text[index] !== "{") {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let i = index; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (ch === "\\") {
        escaping = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const value = JSON.parse(text.slice(index, i + 1)) as unknown;
          return isRecord(value) ? { start: index, end: i + 1, value } : null;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function trimMatchedSuffix(text: string, start: number): number {
  let index = start;
  while (index < text.length && (text[index] === "\n" || text[index] === "\r")) {
    index += 1;
  }
  return index;
}

function extractPseudoToolCall(value: Record<string, unknown>): {
  name: string;
  arguments: Record<string, unknown>;
} | null {
  const tool = value.tool;
  if (typeof tool !== "string" || !tool.trim()) {
    return null;
  }
  const args = value.args ?? value.arguments ?? value.input ?? value.params;
  if (!isRecord(args)) {
    return null;
  }
  return {
    name: tool.trim(),
    arguments: args,
  };
}

function buildBracketPseudoToolArgs(name: string, payload: string): Record<string, unknown> | null {
  const trimmedName = name.trim();
  if (trimmedName === "read") {
    return { filePath: payload };
  }
  if (trimmedName === "exec") {
    return { cmd: payload };
  }
  return null;
}

function parseCodexCommentaryTextToolCalls(params: {
  text: string;
  compat: TextToolCallCompatConfig;
  allowedToolNames?: Set<string>;
}): TextToolCallCompatResult {
  const diagnostics: TextToolCallCompatDiagnostic[] = [];
  const toolCalls: ParsedTextToolCall[] = [];
  const removals: Array<{ start: number; end: number }> = [];
  const markers = Array.from(params.text.matchAll(/(^|\n)to=([A-Za-z0-9_:-]+)/g));
  const jsonMarkers = Array.from(params.text.matchAll(/(^|\n)[ \t]*\{/g));
  const bracketMarkers = Array.from(
    params.text.matchAll(/\[Tool call:\s*([A-Za-z0-9_:-]+)\s+`([^`\n]+)`\]/gi),
  );
  const maxCalls = params.compat.maxCallsPerMessage ?? Number.POSITIVE_INFINITY;
  let reachedMaxCalls = false;

  for (const [matchIndex, match] of markers.entries()) {
    if (toolCalls.length >= maxCalls) {
      reachedMaxCalls = true;
      break;
    }

    const prefix = match[1] ?? "";
    const name = match[2] ?? "";
    const commandIndex = match.index ?? 0;
    const commandStart = commandIndex + prefix.length;
    const nextCommandIndex =
      matchIndex + 1 < markers.length
        ? (markers[matchIndex + 1]?.index ?? params.text.length)
        : params.text.length;
    const toolNameEnd = commandStart + name.length + 3;
    const braceIndex = params.text.indexOf("{", toolNameEnd);
    const parsed =
      braceIndex >= 0 && braceIndex < nextCommandIndex
        ? consumeJsonObject(params.text, braceIndex)
        : null;

    if (!parsed) {
      diagnostics.push({ level: "debug", reason: "invalid_json", format: "codex_commentary_v1" });
      continue;
    }

    if (params.compat.requireKnownToolName && !params.allowedToolNames?.has(name)) {
      diagnostics.push({
        level: "debug",
        reason: "unknown_tool_name",
        format: "codex_commentary_v1",
      });
      continue;
    }

    toolCalls.push({
      id: `compat_text_call_${toolCalls.length + 1}`,
      name,
      arguments: parsed.value,
    });
    removals.push({ start: commandStart, end: trimMatchedSuffix(params.text, parsed.end) });
  }

  for (const match of jsonMarkers) {
    if (toolCalls.length >= maxCalls) {
      reachedMaxCalls = true;
      break;
    }

    const prefix = match[1] ?? "";
    const markerIndex = match.index ?? 0;
    const objectStart = markerIndex + prefix.length;
    if (removals.some((removal) => objectStart >= removal.start && objectStart < removal.end)) {
      continue;
    }

    const parsed = consumeJsonObject(params.text, objectStart);
    if (!parsed) {
      continue;
    }
    const pseudoToolCall = extractPseudoToolCall(parsed.value);
    if (!pseudoToolCall) {
      continue;
    }

    if (params.compat.requireKnownToolName && !params.allowedToolNames?.has(pseudoToolCall.name)) {
      diagnostics.push({
        level: "debug",
        reason: "unknown_tool_name",
        format: "codex_commentary_v1",
      });
      continue;
    }

    toolCalls.push({
      id: `compat_text_call_${toolCalls.length + 1}`,
      name: pseudoToolCall.name,
      arguments: pseudoToolCall.arguments,
    });
    removals.push({ start: parsed.start, end: trimMatchedSuffix(params.text, parsed.end) });
  }

  for (const match of bracketMarkers) {
    if (toolCalls.length >= maxCalls) {
      reachedMaxCalls = true;
      break;
    }

    const start = match.index ?? 0;
    if (removals.some((removal) => start >= removal.start && start < removal.end)) {
      continue;
    }

    const name = (match[1] ?? "").trim();
    const payload = match[2] ?? "";
    if (!name || !payload) {
      continue;
    }

    if (params.compat.requireKnownToolName && !params.allowedToolNames?.has(name)) {
      diagnostics.push({
        level: "debug",
        reason: "unknown_tool_name",
        format: "codex_commentary_v1",
      });
      continue;
    }

    const args = buildBracketPseudoToolArgs(name, payload);
    if (!args) {
      diagnostics.push({
        level: "debug",
        reason: "unsupported_bracket_tool_shape",
        format: "codex_commentary_v1",
      });
      continue;
    }

    toolCalls.push({
      id: `compat_text_call_${toolCalls.length + 1}`,
      name,
      arguments: args,
    });
    removals.push({
      start,
      end: trimMatchedSuffix(params.text, start + match[0].length),
    });
  }

  if (reachedMaxCalls) {
    diagnostics.push({
      level: "debug",
      reason: "max_calls_reached",
      format: "codex_commentary_v1",
    });
  }

  if (toolCalls.length === 0 && diagnostics.length === 0) {
    diagnostics.push({
      level: "debug",
      reason: "no_tool_call_match",
      format: "codex_commentary_v1",
    });
  }

  if (toolCalls.length === 0) {
    return {
      text: params.text,
      toolCalls,
      diagnostics,
    };
  }

  let cursor = 0;
  let remainingText = "";
  for (const removal of removals) {
    remainingText += params.text.slice(cursor, removal.start);
    cursor = removal.end;
  }
  remainingText += params.text.slice(cursor);

  if (!params.compat.allowMixedText && remainingText.trim()) {
    return {
      text: params.text,
      toolCalls: [],
      diagnostics: [
        ...diagnostics,
        { level: "debug", reason: "mixed_text_not_allowed", format: "codex_commentary_v1" },
      ],
    };
  }

  return {
    text: remainingText.trim(),
    toolCalls,
    diagnostics,
  };
}

export function parseTextToolCalls(params: {
  text: string;
  compat?: TextToolCallCompatConfig;
  allowedToolNames?: Set<string>;
}): TextToolCallCompatResult {
  if (!params.compat?.enabled) {
    return {
      text: params.text,
      toolCalls: [],
      diagnostics: [],
    };
  }

  let result: TextToolCallCompatResult = {
    text: params.text,
    toolCalls: [],
    diagnostics: [],
  };

  for (const format of params.compat.formats ?? []) {
    if (format === "codex_commentary_v1") {
      result = parseCodexCommentaryTextToolCalls({
        text: result.text,
        compat: params.compat,
        allowedToolNames: params.allowedToolNames,
      });
    }
  }

  return result;
}

export function applyTextToolCallCompatToTextBlock(params: {
  text: string;
  compat?: TextToolCallCompatConfig;
  allowedToolNames?: Set<string>;
}): TextToolCallCompatAppliedResult {
  const result = parseTextToolCalls(params);
  const content: TextToolCallCompatContentBlock[] = [];

  if (result.text) {
    content.push({ type: "text", text: result.text });
  }
  for (const toolCall of result.toolCalls) {
    content.push({
      type: "toolCall",
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
    });
  }

  return {
    content,
    diagnostics: result.diagnostics,
  };
}
