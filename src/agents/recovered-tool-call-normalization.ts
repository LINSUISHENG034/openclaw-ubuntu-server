import type { ModelCompatConfig } from "../config/types.models.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shouldNormalize(params: {
  provider?: string;
  modelApi?: string;
  compat?: ModelCompatConfig;
}): boolean {
  return params.compat?.textToolCalls?.enabled === true;
}

function canonicalizeToolArguments(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (name === "read") {
    const hasPath = Object.hasOwn(args, "path");
    const hasFilePath = Object.hasOwn(args, "filePath");
    const hasFilePathSnake = Object.hasOwn(args, "file_path");
    if (hasPath || Number(hasFilePath) + Number(hasFilePathSnake) !== 1) {
      return args;
    }
    const aliasKey = hasFilePath ? "filePath" : "file_path";
    const nextArgs: Record<string, unknown> = { ...args, path: args[aliasKey] };
    delete nextArgs[aliasKey];
    return nextArgs;
  }

  if (name === "exec") {
    if (Object.hasOwn(args, "command") || !Object.hasOwn(args, "cmd")) {
      return args;
    }
    const nextArgs: Record<string, unknown> = { ...args, command: args.cmd };
    delete nextArgs.cmd;
    return nextArgs;
  }

  return args;
}

export function normalizeRecoveredToolCallsInAssistantMessage(params: {
  message: unknown;
  provider?: string;
  modelApi?: string;
  compat?: ModelCompatConfig;
}): void {
  if (!shouldNormalize(params) || !isRecord(params.message)) {
    return;
  }

  const content = params.message.content;
  if (!Array.isArray(content)) {
    return;
  }

  const usedCompatIds = new Set<string>();
  let nextCompatIndex = 1;
  let changed = false;

  const nextContent = content.map((block) => {
    if (!isRecord(block) || block.type !== "toolCall") {
      return block;
    }

    let nextBlock = block;
    const name = typeof block.name === "string" ? block.name.trim() : "";
    const args = isRecord(block.arguments) ? block.arguments : null;
    if (args) {
      const canonicalArgs = canonicalizeToolArguments(name, args);
      if (canonicalArgs !== args) {
        nextBlock = { ...nextBlock, arguments: canonicalArgs };
        changed = true;
      }
    }

    const id = typeof block.id === "string" ? block.id : "";
    const compatMatch = /^compat_text_call_(\d+)$/.exec(id);
    if (!compatMatch) {
      return nextBlock;
    }

    nextCompatIndex = Math.max(nextCompatIndex, Number(compatMatch[1]) + 1);
    if (!usedCompatIds.has(id)) {
      usedCompatIds.add(id);
      return nextBlock;
    }

    let nextId = `compat_text_call_${nextCompatIndex}`;
    while (usedCompatIds.has(nextId)) {
      nextCompatIndex += 1;
      nextId = `compat_text_call_${nextCompatIndex}`;
    }
    usedCompatIds.add(nextId);
    nextCompatIndex += 1;
    changed = true;
    return { ...nextBlock, id: nextId };
  });

  if (!changed) {
    return;
  }

  params.message.content = nextContent;
}
