import { useGameStore } from '../stores/gameStore'
import { PLAYER_MAX_HP } from '../game/constants'

export function HUD() {
  const playerId = useGameStore((s) => s.playerId)
  const players = useGameStore((s) => s.players)
  const isDead = useGameStore((s) => s.isDead)

  const localPlayer = players.find((p) => p.id === playerId)
  const hp = localPlayer?.hp ?? PLAYER_MAX_HP
  const maxHp = localPlayer?.maxHp ?? PLAYER_MAX_HP
  const hpPercent = (hp / maxHp) * 100

  return (
    <>
      {/* 死亡遮罩 */}
      {isDead && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50 pointer-events-auto">
          <div className="text-center">
            <div className="text-red-500 text-4xl font-bold tracking-widest mb-2 animate-pulse"
              style={{ textShadow: '0 0 20px rgba(255,0,0,0.5)' }}>
              YOU DIED
            </div>
            <div className="text-gray-400 text-sm">Respawning...</div>
          </div>
        </div>
      )}

      {/* 左上角 - 玩家状态 */}
      <div className="absolute top-4 left-4 pointer-events-auto">
        <PlayerStatusBar hp={hp} maxHp={maxHp} hpPercent={hpPercent} />
      </div>

      {/* 底部中央 - 技能栏 */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-auto">
        <SkillBar />
      </div>

      {/* 左下角 - 小地图提示 */}
      <div className="absolute bottom-4 left-4 pointer-events-auto">
        <div className="text-gray-600 text-[10px] font-mono">
          {localPlayer ? `(${Math.round(localPlayer.x)}, ${Math.round(localPlayer.y)})` : ''}
        </div>
      </div>
    </>
  )
}

function PlayerStatusBar({ hp, maxHp, hpPercent }: { hp: number; maxHp: number; hpPercent: number }) {
  const hpColor = hpPercent > 50 ? '#00ff88' : hpPercent > 25 ? '#ffaa00' : '#ff3344'

  return (
    <div className="relative">
      {/* 外框 - 暗黑金属风 */}
      <div className="w-56 h-7 relative overflow-hidden rounded-sm"
        style={{
          background: 'linear-gradient(180deg, #1a1a2e 0%, #0d0d1a 100%)',
          border: '1px solid #333355',
          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.8), 0 0 8px rgba(100,60,180,0.2)',
        }}>
        {/* 血条填充 */}
        <div
          className="absolute inset-y-0 left-0 transition-all duration-200"
          style={{
            width: `${hpPercent}%`,
            background: `linear-gradient(180deg, ${hpColor}cc 0%, ${hpColor}66 100%)`,
            boxShadow: `0 0 10px ${hpColor}44`,
          }}
        />
        {/* 刻度线 */}
        <div className="absolute inset-0 flex">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="flex-1 border-r border-black/30" />
          ))}
        </div>
        {/* 数值 */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-white text-xs font-bold drop-shadow-lg font-mono">
            {hp} / {maxHp}
          </span>
        </div>
      </div>
      {/* 标签 */}
      <div className="absolute -top-1 -left-1 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider rounded-sm"
        style={{
          background: '#1a1a2e',
          border: '1px solid #333355',
          color: '#8866cc',
        }}>
        HP
      </div>
    </div>
  )
}

function SkillBar() {
  return (
    <div className="flex items-end gap-2">
      {/* 技能槽 */}
      <SkillSlot
        hotkey="LMB"
        name="Strike"
        icon="⚔️"
        color="#ff4444"
        cooldown={0.5}
      />
      <SkillSlot
        hotkey="Q"
        name="Dash"
        icon="💨"
        color="#4488ff"
        cooldown={5}
      />
      <SkillSlot
        hotkey="E"
        name="Fireball"
        icon="🔥"
        color="#ff8800"
        cooldown={3}
      />

      {/* 分隔线 */}
      <div className="w-px h-12 mx-1" style={{ background: 'linear-gradient(180deg, transparent, #333355, transparent)' }} />

      {/* 操作提示 */}
      <div className="flex flex-col justify-center text-[10px] text-gray-600 leading-tight">
        <span>WASD 移动</span>
        <span>鼠标 瞄准</span>
      </div>
    </div>
  )
}

function SkillSlot({
  hotkey,
  name,
  icon,
  color,
  cooldown,
}: {
  hotkey: string
  name: string
  icon: string
  color: string
  cooldown: number
}) {
  return (
    <div className="relative group">
      {/* 技能框 */}
      <div
        className="w-14 h-14 flex items-center justify-center rounded relative overflow-hidden cursor-pointer
          transition-all duration-150 hover:scale-105 active:scale-95"
        style={{
          background: 'linear-gradient(135deg, #1a1a2e 0%, #0d0d1a 100%)',
          border: `1.5px solid ${color}66`,
          boxShadow: `inset 0 0 15px ${color}11, 0 0 6px ${color}22`,
        }}
      >
        {/* 图标 */}
        <span className="text-2xl select-none">{icon}</span>

        {/* 底部高光 */}
        <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: color, opacity: 0.6 }} />
      </div>

      {/* 快捷键标签 */}
      <div
        className="absolute -top-2 left-1/2 -translate-x-1/2 px-1.5 py-0 text-[9px] font-bold rounded"
        style={{
          background: '#0d0d1a',
          border: `1px solid ${color}44`,
          color: color,
        }}
      >
        {hotkey}
      </div>

      {/* 技能名 */}
      <div className="text-center mt-1 text-[9px] text-gray-500 font-medium">
        {name}
      </div>

      {/* 冷却时间提示 */}
      <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[8px] text-gray-700">
        {cooldown}s
      </div>
    </div>
  )
}
