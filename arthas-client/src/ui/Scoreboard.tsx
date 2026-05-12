import { useGameStore } from '../stores/gameStore'

export function Scoreboard() {
  const scores = useGameStore((s) => s.scores)
  const playerId = useGameStore((s) => s.playerId)
  const gameOver = useGameStore((s) => s.gameOver)
  const winnerId = useGameStore((s) => s.winnerId)
  const players = useGameStore((s) => s.players)

  // 按分数排序
  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a)

  return (
    <>
      {/* 游戏结束全屏 */}
      {gameOver && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50 pointer-events-auto">
          <div className="text-center p-8 rounded-lg"
            style={{
              background: 'linear-gradient(135deg, #1a1a2e 0%, #0d0d1a 100%)',
              border: '2px solid #ffd700',
              boxShadow: '0 0 40px rgba(255,215,0,0.2)',
            }}>
            <div className="text-5xl mb-2">👑</div>
            <div className="text-yellow-400 text-2xl font-bold tracking-wider mb-1"
              style={{ textShadow: '0 0 10px rgba(255,215,0,0.5)' }}>
              {winnerId === playerId ? 'VICTORY' : 'DEFEAT'}
            </div>
            <div className="text-gray-400 text-sm mb-4">
              {winnerId === playerId ? 'You claimed the Coreshard!' : `${winnerId?.slice(0, 6)} wins`}
            </div>
            <div className="text-gray-600 text-xs">New round starting...</div>
          </div>
        </div>
      )}

      {/* 右上角计分板 */}
      <div className="absolute top-4 right-4 pointer-events-auto">
        <div className="min-w-[180px] rounded overflow-hidden"
          style={{
            background: 'linear-gradient(180deg, #1a1a2eee 0%, #0d0d1aee 100%)',
            border: '1px solid #333355',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          }}>
          {/* 标题栏 */}
          <div className="px-3 py-1.5 flex items-center gap-2"
            style={{
              background: 'linear-gradient(90deg, #2a1a4e 0%, #1a1a2e 100%)',
              borderBottom: '1px solid #333355',
            }}>
            <span className="text-[10px]">◆</span>
            <span className="text-[11px] font-bold uppercase tracking-widest text-purple-300">
              Scoreboard
            </span>
            <span className="ml-auto text-[9px] text-gray-600">{players.length} online</span>
          </div>

          {/* 玩家列表 */}
          <div className="px-2 py-1.5 max-h-48 overflow-y-auto">
            {sorted.length === 0 ? (
              <div className="text-gray-600 text-[10px] text-center py-2">
                Waiting for players...
              </div>
            ) : (
              sorted.map(([id, score], index) => {
                const isLocal = id === playerId
                const player = players.find(p => p.id === id)
                const isAlive = player?.state !== 'dead'

                return (
                  <div
                    key={id}
                    className={`flex items-center gap-2 py-1 px-1.5 rounded text-[11px] mb-0.5
                      ${isLocal ? 'bg-purple-900/30' : 'hover:bg-white/5'}`}
                  >
                    {/* 排名 */}
                    <span className={`w-4 text-center font-bold ${
                      index === 0 ? 'text-yellow-400' :
                      index === 1 ? 'text-gray-300' :
                      index === 2 ? 'text-orange-400' : 'text-gray-600'
                    }`}>
                      {index + 1}
                    </span>

                    {/* 存活指示 */}
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      isAlive ? 'bg-green-400' : 'bg-red-500'
                    }`} />

                    {/* 名称 */}
                    <span className={`flex-1 truncate ${
                      isLocal ? 'text-green-300 font-bold' : 'text-gray-300'
                    }`}>
                      {isLocal ? 'You' : id.slice(0, 6)}
                    </span>

                    {/* 分数 */}
                    <span className={`font-mono font-bold ${
                      isLocal ? 'text-purple-300' : 'text-gray-400'
                    }`}>
                      {score}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* 顶部中央 - 游戏时间/状态 */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2">
        <div className="px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest"
          style={{
            background: 'linear-gradient(180deg, #1a1a2ecc 0%, #0d0d1acc 100%)',
            border: '1px solid #333355',
            color: '#8866cc',
          }}>
          ◆ Age of Ash ◆
        </div>
      </div>
    </>
  )
}
