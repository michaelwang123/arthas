import { useGameStore } from '../stores/gameStore'

export function HUD() {
  const playerId = useGameStore((s) => s.playerId)
  const players = useGameStore((s) => s.players)
  const isDead = useGameStore((s) => s.isDead)

  const localPlayer = players.find((p) => p.id === playerId)

  if (!localPlayer) return null

  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 pointer-events-auto">
      {/* 死亡提示 */}
      {isDead && (
        <div className="text-center mb-4">
          <span className="text-red-500 text-xl font-bold animate-pulse">
            YOU DIED — Respawning...
          </span>
        </div>
      )}

      {/* 技能栏 */}
      <div className="flex gap-3 bg-black/70 rounded-lg p-3 border border-gray-700">
        {/* 基础攻击 */}
        <SkillSlot
          label="LMB"
          name="Attack"
          color="border-red-500"
        />

        {/* 技能1：冲刺 */}
        <SkillSlot
          label="Q"
          name="Dash"
          color="border-blue-500"
        />

        {/* 技能2：火球 */}
        <SkillSlot
          label="E"
          name="Fireball"
          color="border-orange-500"
        />
      </div>

      {/* 操作提示 */}
      <div className="text-center mt-2 text-gray-500 text-xs">
        WASD 移动 | 鼠标左键 攻击 | Q 冲刺 | E 火球
      </div>
    </div>
  )
}

function SkillSlot({ label, name, color }: { label: string; name: string; color: string }) {
  return (
    <div className={`w-14 h-14 border-2 ${color} rounded bg-gray-900 flex flex-col items-center justify-center`}>
      <span className="text-white text-xs font-bold">{label}</span>
      <span className="text-gray-400 text-[10px]">{name}</span>
    </div>
  )
}
