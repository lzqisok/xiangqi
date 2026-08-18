import { useEffect, useRef, useState } from 'react'
import './gomoku.css'
import { Board } from './components/Board'
import { GameControls } from './components/GameControls'
import { GameStatus } from './components/GameStatus'
import { ReviewPanel } from './components/ReviewPanel'
import { getUndoStepCount } from './core/gameFlow'
import { useGameStore } from './store/gameStore'
import { disconnectRapfi } from './rapfi/client'
import { clearGomokuHistory, GomokuGameRecord, loadGomokuHistory, saveGomokuRecord } from './history'

function historySignature(moves: Array<{ row: number; col: number; player: number }>) { return moves.map(move => `${move.row},${move.col},${move.player}`).join(';') }

export default function GomokuApp() {
  const moveHistory = useGameStore(state => state.moveHistory)
  const isStarted = useGameStore(state => state.isStarted)
  const mode = useGameStore(state => state.mode)
  const humanPlayer = useGameStore(state => state.humanPlayer)
  const newGame = useGameStore(state => state.newGame)
  const undo = useGameStore(state => state.undo)
  const winner = useGameStore(state => state.winner)
  const draw = useGameStore(state => state.draw)
  const forbiddenEnabled = useGameStore(state => state.forbiddenEnabled)
  const loadRecordedGame = useGameStore(state => state.loadRecordedGame)
  const [showRestartConfirm, setShowRestartConfirm] = useState(false)
  const [showHistory, setShowHistory] = useState(() => new URLSearchParams(window.location.search).has('history'))
  const [history, setHistory] = useState<GomokuGameRecord[]>(loadGomokuHistory)
  const savedSignature = useRef('')

  useEffect(() => {
    return () => disconnectRapfi()
  }, [])

  const canUndo = getUndoStepCount(moveHistory.length, mode, humanPlayer) > 0
  useEffect(() => {
    if (!winner && !draw) { savedSignature.current = ''; return }
    const signature = historySignature(moveHistory)
    if (!signature || savedSignature.current === signature) return
    savedSignature.current = signature
    setHistory(saveGomokuRecord({ mode, forbiddenEnabled, winner, draw, moves: moveHistory }))
  }, [draw, forbiddenEnabled, mode, moveHistory, winner])

  return (
    <div className="gomoku-page">
      <header className="gomoku-header">
        <div className="gomoku-brand">
          <span aria-hidden="true">五</span>
          <div>
            <small>GOMOKU STUDIO</small>
            <strong>五子棋</strong>
          </div>
        </div>
        <div className="gomoku-header-actions"><button className="gomoku-home-link" onClick={() => { setHistory(loadGomokuHistory()); setShowHistory(true) }}>对局记录</button><a href="?type=gomoku" className="gomoku-home-link">返回模式选择</a></div>
      </header>

      <main className="gomoku-workspace">
        <section className="gomoku-board-column">
          <div className="gomoku-board-stage">
            <div className="gomoku-board-container">
              <Board />
              {!isStarted && (
                <div className="gomoku-start-overlay">
                  <div>
                    <span aria-hidden="true">弈</span>
                    <strong>棋局待启</strong>
                    <small>设置对局方式后开始落子</small>
                    <button className="gomoku-btn-primary" onClick={newGame}>开始游戏</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="gomoku-side-panels">
          <GameStatus
            isStarted={isStarted}
            canUndo={canUndo}
            onUndo={undo}
            onRestart={() => setShowRestartConfirm(true)}
          />
          <GameControls />
          <ReviewPanel />
        </aside>
      </main>

      {showRestartConfirm && (
        <div className="gomoku-modal-overlay" role="presentation" onMouseDown={() => setShowRestartConfirm(false)}>
          <section className="gomoku-modal" role="dialog" aria-modal="true" aria-labelledby="gomoku-restart-title" onMouseDown={event => event.stopPropagation()}>
            <span className="gomoku-modal-mark" aria-hidden="true">新</span>
            <h2 id="gomoku-restart-title">重开一局</h2>
            <p>当前对局进度会被清空，确定重新开始吗？</p>
            <div>
              <button className="gomoku-btn-secondary" onClick={() => setShowRestartConfirm(false)}>取消</button>
              <button className="gomoku-btn-primary" onClick={() => {
                setShowRestartConfirm(false)
                newGame()
              }}>确定重开</button>
            </div>
          </section>
        </div>
      )}
      {showHistory && <div className="gomoku-modal-overlay" role="presentation" onMouseDown={() => setShowHistory(false)}><section className="gomoku-modal gomoku-history-modal" role="dialog" aria-modal="true" aria-labelledby="gomoku-history-title" onMouseDown={event => event.stopPropagation()}><h2 id="gomoku-history-title">本地对局记录</h2>{history.length === 0 ? <p>还没有已结束的对局。</p> : <div className="gomoku-history-list">{history.map(record => <button key={record.id} onClick={() => { savedSignature.current = historySignature(record.moves); loadRecordedGame(record.moves, record.forbiddenEnabled); setShowHistory(false) }}><strong>{record.draw ? '和棋' : `${record.winner === 1 ? '黑方' : '白方'}获胜`}</strong><span>{record.mode === 'pvp' ? '本地双人' : record.mode === 'ai' ? '人机对战' : 'AI 对决'} · {record.forbiddenEnabled ? '有禁手' : '无禁手'} · {record.moves.length} 手</span><time>{new Date(record.createdAt).toLocaleString()}</time></button>)}</div>}<div><button className="gomoku-btn-secondary" onClick={() => { clearGomokuHistory(); setHistory([]) }} disabled={history.length === 0}>清空记录</button><button className="gomoku-btn-primary" onClick={() => setShowHistory(false)}>关闭</button></div></section></div>}
    </div>
  )
}
