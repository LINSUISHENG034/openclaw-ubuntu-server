export type ChatTextBlock = {
  type?: unknown;
  text?: unknown;
  textSignature?: unknown;
};

export function resolveChatTextBlockPhase(block: ChatTextBlock): string | undefined {
  const raw = block.textSignature;
  if (typeof raw !== "string" || !raw.includes('"phase"')) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as { phase?: unknown };
    return typeof parsed.phase === "string" && parsed.phase.trim()
      ? parsed.phase.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

export function extractTextFromChatContent(
  content: unknown,
  opts?: {
    includeTextBlock?: (block: ChatTextBlock) => boolean;
    sanitizeText?: (text: string) => string;
    joinWith?: string;
    normalizeText?: (text: string) => string;
  },
): string | null {
  const normalize = opts?.normalizeText ?? ((text: string) => text.replace(/\s+/g, " ").trim());
  const joinWith = opts?.joinWith ?? " ";

  if (typeof content === "string") {
    const value = opts?.sanitizeText ? opts.sanitizeText(content) : content;
    const normalized = normalize(value);
    return normalized ? normalized : null;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const chunks: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const textBlock = block as ChatTextBlock;
    if (textBlock.type !== "text") {
      continue;
    }
    if (opts?.includeTextBlock && !opts.includeTextBlock(textBlock)) {
      continue;
    }
    const text = textBlock.text;
    if (typeof text !== "string") {
      continue;
    }
    const value = opts?.sanitizeText ? opts.sanitizeText(text) : text;
    if (value.trim()) {
      chunks.push(value);
    }
  }

  const joined = normalize(chunks.join(joinWith));
  return joined ? joined : null;
}
