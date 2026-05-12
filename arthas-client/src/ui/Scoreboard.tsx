import { useGameStore } from '../stores/gameStore'

export function Scoreboard() {
  const scores = useGameStore((s) => s.scores)
  const playerId = useGameStore((s) => s.playerId)
  const gameOver = useGameStore((s) => s.gameOver)
  const winnerId = useGameStore((s) => s.winnerId)

  // 按分数排序
  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a)

  return (
    <div className="absolute top-4 right-4 pointer-events-auto">
      {/* 游戏结束 */}
      {gameOver && (
        <div className="mb-4 p-4 bg-black/90 rounded-lg border border-yellow-500 text-center">
          <div className="text-yellow-400 text-lg font-bold">GAME OVER</div>
          <div className="text-white mt-1">
            {winnerId === playerId ? '🏆 YOU WIN!' : `Winner: ${winnerId?.slice(0, 6)}`}
          </div>
        </div>
      )}

      {/* 计分板 */}
      <div className="bg-black/70 rounded-lg p-3 border border-gray-700 min-w-[160px]">
        <div className="text-gray-400 text-xs font-bold mb-2 uppercase">Scoreboard</div>
        {sorted.length === 0 ? (
          <div className="text-gray-600 text-xs">Waiting for players...</div>
        ) : (
          sorted.map(([id, score], index) => (
            <div
              key={id}
              className={`flex justify-between text-sm py-0.5 ${
                id === playerId ? 'text-green-400 font-bold' : 'text-gray-300'
              }`}
            >
              <span>
                {index + 1}. {id === playerId ? 'You' : id.slice(0, 6)}
              </span>
              <span>{score}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
