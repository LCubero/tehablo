export function cleanText(raw: string, limit = 3000): string {
  return raw.replace(/(```|~~~)[\s\S]*?(?:\1|$)/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+|<[^>]*>/g, ' ')
    .replace(/^\s*[-=*_]{3,}\s*$/gm, '')
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/[`*_~]/g, '')
    .replace(/\n\s*\n/g, '\n').trim().replace(/\n+/g, '. ')
    .replace(/\s+/g, ' ').replace(/([.!?])\s*\./g, '$1')
    .trim().slice(0, limit).trim();
}

export function finalText(message: any): string {
  if (message?.role !== 'assistant' || (message.stopReason && message.stopReason !== 'stop')) return '';
  if (Array.isArray(message.content) && message.content.some((p: any) => p.type === 'toolCall')) return '';
  return cleanText(typeof message.content === 'string' ? message.content :
    (message.content ?? []).filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n'));
}
