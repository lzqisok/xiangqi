let audioCtx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  return audioCtx
}

function playTone(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.15) {
  try {
    const ctx = getCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    gain.gain.setValueAtTime(volume, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + duration)
  } catch {
    // audio not supported
  }
}

export function playMoveSound() {
  playTone(800, 0.08, 'square', 0.1)
  setTimeout(() => playTone(600, 0.06, 'square', 0.06), 30)
}

export function playCaptureSound() {
  playTone(400, 0.12, 'sawtooth', 0.12)
  setTimeout(() => playTone(300, 0.1, 'square', 0.08), 40)
}

export function playCheckSound() {
  playTone(1000, 0.1, 'square', 0.15)
  setTimeout(() => playTone(1200, 0.12, 'square', 0.12), 100)
  setTimeout(() => playTone(1000, 0.08, 'square', 0.08), 200)
}

export function playGameOverSound() {
  const notes = [523, 659, 784, 1047]
  notes.forEach((freq, i) => {
    setTimeout(() => playTone(freq, 0.3, 'sine', 0.1), i * 150)
  })
}
