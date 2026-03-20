import { EndgameDefinition } from '../types'

export const BUILTIN_ENDGAMES: EndgameDefinition[] = [
  {
    id: 'builtin-rook-vs-king',
    name: '单车胜单将',
    fen: '4k4/9/9/9/9/9/9/9/4R4/4K4 w - - 0 1',
    description: '练习单车基本杀法与压缩将位。',
    source: 'builtin',
  },
  {
    id: 'builtin-cannon-horse-vs-king',
    name: '炮马仕相巧胜',
    fen: '4k4/4a4/4b4/9/9/9/4N4/4C4/4A4/4K4 w - - 0 1',
    description: '炮马配合形成将杀网，适合练习终局配合。',
    source: 'builtin',
  },
  {
    id: 'builtin-double-rook-mate',
    name: '双车必杀',
    fen: '4k4/9/9/9/9/9/9/9/3RR4/4K4 w - - 0 1',
    description: '双车终局基础练习，适合熟悉强制杀法。',
    source: 'builtin',
  },
  {
    id: 'builtin-pawn-endgame',
    name: '兵卒残局',
    fen: '4k4/9/9/4p4/9/4P4/9/9/9/4K4 w - - 0 1',
    description: '简单兵卒残局，练习先手与王的配合。',
    source: 'builtin',
  },
  {
    id: 'builtin-cannon-check',
    name: '炮打隔子',
    fen: '4k4/9/9/9/4p4/4C4/9/9/9/4K4 w - - 0 1',
    description: '通过炮架和将位控制学习残局中的炮形。',
    source: 'builtin',
  },
]
