import { useEffect, useRef, useState } from 'react'
import { Game } from './game/Game'
import { HUD } from './ui/HUD'
import { Scoreboard } from './ui/Scoreboard'
import { useGameStore } from './stores/gameStore'

function App() {
  const canvasRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Game | null>(null)
  const connected = useGameStore((s) => s.connected)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!canvasRef.current || gameRef.current) return

    const game = new Game(canvasRef.current)
    gameRef.current = game

    game.start()
      .then(() => {
        setLoading(false)
        console.log('[App] Game started successfully')
      })
      .catch((err) => {
        console.error('[App] Game failed to start:', err)
        setError(String(err))
        setLoading(false)
      })

    return () => {
      game.destroy()
      gameRef.current = null
    }
  }, [])

  return (
    <div className="relative w-screen h-screen bg-gray-900">
      {/* PixiJS 渲染层 */}
      <div ref={canvasRef} id="game-canvas" className="absolute inset-0 z-0" />

      {/* React UI 覆盖层 */}
      <div className="absolute inset-0 pointer-events-none z-10">
        {error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-red-400 text-lg p-4 bg-black/80 rounded">
              Error: {error}
            </div>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-white text-2xl font-bold animate-pulse">
              Loading game...
            </div>
          </div>
        ) : !connected ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-yellow-400 text-xl font-bold animate-pulse">
              Connecting to server...
            </div>
          </div>
        ) : (
          <>
            <HUD />
            <Scoreboard />
          </>
        )}
      </div>
    </div>
  )
}

export default App
