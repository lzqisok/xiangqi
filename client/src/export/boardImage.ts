import { GameMode, PieceColor } from '../types'

export type BoardExportMetadataInput = {
  fen: string
  currentTurn: PieceColor
  scenarioName: string | null
  gameMode: GameMode
}

export type BoardExportMetadata = {
  title: string
  lines: string[]
  filename: string
}

const MODE_NAMES: Record<GameMode, string> = {
  'human-vs-ai': '人机对弈',
  'human-vs-human': '双人对弈',
  'ai-vs-ai': 'AI 对战',
  endgame: '残局模式',
  study: '研究局面',
}

export function buildBoardExportMetadata({
  fen,
  currentTurn,
  scenarioName,
  gameMode,
}: BoardExportMetadataInput): BoardExportMetadata {
  const title = scenarioName?.trim() || '中国象棋'
  const turnText = currentTurn === 'red' ? '红方走棋' : '黑方走棋'
  const filename = scenarioName?.trim()
    ? `xiangqi-${sanitizeFilename(scenarioName)}.png`
    : 'xiangqi-board.png'

  return {
    title,
    lines: [
      `${MODE_NAMES[gameMode]} · ${turnText}`,
      `FEN: ${fen}`,
    ],
    filename,
  }
}

export async function createAnnotatedBoardPng(
  boardDataUrl: string,
  metadata: BoardExportMetadata,
): Promise<string> {
  const image = await loadImage(boardDataUrl).catch(() => null)
  if (!image) return boardDataUrl

  const padding = 28
  const lineHeight = 24
  const footerHeight = padding * 2 + 28 + metadata.lines.length * lineHeight
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height + footerHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) return boardDataUrl

  ctx.fillStyle = '#17352f'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, 0)

  const footerTop = image.height
  ctx.fillStyle = '#17352f'
  ctx.fillRect(0, footerTop, canvas.width, footerHeight)
  ctx.fillStyle = '#f7ead2'
  ctx.font = '700 24px "Noto Serif SC", serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(metadata.title, padding, footerTop + padding)

  ctx.font = '14px "Noto Serif SC", serif'
  ctx.fillStyle = '#d7c29a'
  metadata.lines.forEach((line, index) => {
    ctx.fillText(line, padding, footerTop + padding + 34 + index * lineHeight)
  })

  ctx.textAlign = 'right'
  ctx.fillStyle = '#b68b45'
  ctx.font = '13px "Noto Serif SC", serif'
  ctx.fillText('xiangqi', canvas.width - padding, footerTop + padding)

  return canvas.toDataURL('image/png')
}

function sanitizeFilename(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]/g, '-').slice(0, 40) || 'board'
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Unable to load board image'))
    image.src = dataUrl
  })
}
