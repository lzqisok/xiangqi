// Add deployment-wide terms here. This list is never sent to room clients.
export const SYSTEM_CHAT_SENSITIVE_WORDS = ['赌博平台', '色情服务', '毒品交易', '诈骗链接'] as const

export const MAX_ROOM_SENSITIVE_WORDS = 20
export const MAX_SENSITIVE_WORD_LENGTH = 20

export function normalizeSensitiveWord(value: unknown) {
  const word = String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (Array.from(word).length > MAX_SENSITIVE_WORD_LENGTH)
    throw new Error(`单个敏感词不能超过 ${MAX_SENSITIVE_WORD_LENGTH} 个字符`)
  return word
}

export function normalizeRoomSensitiveWords(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_ROOM_SENSITIVE_WORDS)
    throw new Error(`房间敏感词最多设置 ${MAX_ROOM_SENSITIVE_WORDS} 个`)
  const result: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const word = normalizeSensitiveWord(item)
    if (!word) continue
    const key = word.toLocaleLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push(word)
    }
  }
  return result
}

function comparable(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s._-]+/g, '')
}

export function containsSensitiveWord(content: string, roomWords: string[]) {
  const normalizedContent = comparable(content)
  return [...SYSTEM_CHAT_SENSITIVE_WORDS, ...roomWords].some((word) =>
    normalizedContent.includes(comparable(word)),
  )
}
