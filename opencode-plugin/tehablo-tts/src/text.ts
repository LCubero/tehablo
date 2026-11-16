/** Strip Markdown formatting and normalize whitespace for TTS playback. */
export function cleanText(raw: string, limit = 3000): string {
  return raw.replace(/(```|~~~)[\s\S]*?(?:\1|$)/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^\s*[-=*_]{3,}\s*$/gm, '')
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/^[ \t]*\|[^\n]*$/gm, row => {
      const cells = row.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/)
        .map(cell => cell.replace(/\\\|/g, ' ').trim()).filter(Boolean);
      return cells.every(cell => /^:?-{3,}:?$/.test(cell)) ? '' : cells.join(', ');
    })
    .replace(/(?<![\p{L}\p{N}_])(__|_)(\S(?:[^\n]*?\S)??)\1(?![\p{L}\p{N}_])/gu, '$2')
    .replace(/[`*~]/g, '')
    .replace(/\n\s*\n/g, '\n').trim().replace(/\n+/g, '. ')
    .replace(/\s+/g, ' ').replace(/([.!?])\s*\./g, '$1')
    .trim().slice(0, limit).trim();
}

export interface AssistantMessage {
  id: string;
  type: string;
  content?: Array<{ type: string; text?: string }>;
  finish?: string;
  error?: unknown;
}

/** Extract clean final text from the last completed assistant message without tool calls. */
export function finalAssistantText(messages: readonly any[]): { messageId: string; text: string } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as AssistantMessage | undefined;
    if (!message || message.type !== 'assistant') continue;
    if (message.error) return undefined;
    if (message.finish && message.finish !== 'stop') return undefined;
    const parts = Array.isArray(message.content) ? message.content : [];
    if (parts.some(part => part?.type === 'tool' || part?.type === 'toolCall')) return undefined;
    const raw = parts.filter(part => part?.type === 'text' && typeof part.text === 'string')
      .map(part => part.text as string).join('\n');
    const text = cleanText(raw);
    return text ? { messageId: message.id, text } : undefined;
  }
  return undefined;
}
