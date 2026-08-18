import { LanChatMessage } from './types'

export function mergeLanChatMessage(current: LanChatMessage[], message: LanChatMessage) {
  if (current.some((item) => item.id === message.id)) return current
  return [...current, message].sort((left, right) => left.sequence - right.sequence).slice(-100)
}

export function getLanChatRole(
  message: LanChatMessage,
  sideLabels: { red: string; black: string } = { red: '红方', black: '黑方' },
) {
  const role =
    message.role === 'red'
      ? sideLabels.red
      : message.role === 'black'
        ? sideLabels.black
        : message.role === 'owner'
          ? '房主'
          : '观众'
  return message.isOwner && message.role !== 'owner' ? `房主·${role}` : role
}

export function getLanChatContentLength(content: string) {
  return Array.from(content).length
}
export function getLanChatLineCount(content: string) {
  return content.replace(/\r\n?/g, '\n').split('\n').length
}

export function parseLanRoomSensitiveWords(content: string) {
  const words: string[] = [],
    seen = new Set<string>()
  for (const item of content.split(/[,，、\n]/)) {
    const word = item
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    const key = word.toLocaleLowerCase()
    if (word && !seen.has(key)) {
      seen.add(key)
      words.push(word)
    }
  }
  return words
}
