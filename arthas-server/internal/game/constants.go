package game

import "time"

const (
	// 世界
	WorldWidth  = 800.0
	WorldHeight = 800.0

	// Tick
	TickRate     = 20 // Hz
	TickDuration = time.Second / TickRate

	// 玩家
	PlayerSpeed  = 200.0 // units/s
	PlayerRadius = 16.0
	PlayerMaxHP  = 100
	RespawnTime  = 3 * time.Second

	// 基础攻击
	MeleeDamage   = 15
	MeleeRange    = 60.0
	MeleeCooldown = 500 * time.Millisecond
	MeleeArc      = 0.785 // π/4 弧度 (90° 扇形)

	// 技能1：冲刺
	DashDistance = 150.0
	DashCooldown = 5 * time.Second

	// 技能2：火球
	FireballDamage   = 30
	FireballSpeed    = 400.0 // units/s
	FireballRange    = 300.0
	FireballRadius   = 8.0
	FireballCooldown = 3 * time.Second

	// 资源点
	CoreshardCaptureTime  = 3 * time.Second
	CoreshardCaptureRange = 50.0
	CoreshardRespawnTime  = 15 * time.Second
	CoreshardScore        = 10

	// 游戏规则
	GameDuration      = 5 * time.Minute
	DeathPenaltyScore = 5

	// 网络
	PingInterval = 25 * time.Second
)
