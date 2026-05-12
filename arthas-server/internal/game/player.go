package game

import (
	"math"
	"math/rand"
	"time"
)

type PlayerState string

const (
	StateIdle      PlayerState = "idle"
	StateMoving    PlayerState = "moving"
	StateAttacking PlayerState = "attacking"
	StateDead      PlayerState = "dead"
)

type Player struct {
	ID           string
	X, Y         float64
	Dir          float64 // 面朝方向（弧度）
	HP           int
	MaxHP        int
	State        PlayerState
	LastInputSeq uint32

	// 输入
	InputDX   float64
	InputDY   float64
	Attacking bool
	MouseX    float64
	MouseY    float64

	// 冷却
	MeleeCooldownUntil    time.Time
	DashCooldownUntil     time.Time
	FireballCooldownUntil time.Time

	// 死亡/重生
	DeathTime time.Time
	Score     int
}

func NewPlayer(id string) *Player {
	return &Player{
		ID:    id,
		X:     rand.Float64()*WorldWidth*0.6 + WorldWidth*0.2,
		Y:     rand.Float64()*WorldHeight*0.6 + WorldHeight*0.2,
		Dir:   0,
		HP:    PlayerMaxHP,
		MaxHP: PlayerMaxHP,
		State: StateIdle,
	}
}

func (p *Player) Update(dt float64) {
	if p.State == StateDead {
		// 检查是否可以重生
		if time.Since(p.DeathTime) >= RespawnTime {
			p.Respawn()
		}
		return
	}

	// 移动
	if p.InputDX != 0 || p.InputDY != 0 {
		// 归一化
		dx, dy := p.InputDX, p.InputDY
		length := math.Sqrt(dx*dx + dy*dy)
		if length > 0 {
			dx /= length
			dy /= length
		}

		p.X += dx * PlayerSpeed * dt
		p.Y += dy * PlayerSpeed * dt

		// 更新面朝方向
		p.Dir = math.Atan2(dy, dx)

		// 边界钳制
		p.X = math.Max(PlayerRadius, math.Min(WorldWidth-PlayerRadius, p.X))
		p.Y = math.Max(PlayerRadius, math.Min(WorldHeight-PlayerRadius, p.Y))

		p.State = StateMoving
	} else {
		p.State = StateIdle
	}
}

func (p *Player) TakeDamage(damage int) {
	if p.State == StateDead {
		return
	}

	p.HP -= damage
	if p.HP <= 0 {
		p.HP = 0
		p.Die()
	}
}

func (p *Player) Die() {
	p.State = StateDead
	p.DeathTime = time.Now()
	p.Score -= DeathPenaltyScore
	if p.Score < 0 {
		p.Score = 0
	}
}

func (p *Player) Respawn() {
	p.HP = PlayerMaxHP
	p.State = StateIdle
	p.X = rand.Float64()*WorldWidth*0.6 + WorldWidth*0.2
	p.Y = rand.Float64()*WorldHeight*0.6 + WorldHeight*0.2
}

func (p *Player) IsAlive() bool {
	return p.State != StateDead
}

func (p *Player) CanMelee() bool {
	return p.IsAlive() && time.Now().After(p.MeleeCooldownUntil)
}

func (p *Player) CanDash() bool {
	return p.IsAlive() && time.Now().After(p.DashCooldownUntil)
}

func (p *Player) CanFireball() bool {
	return p.IsAlive() && time.Now().After(p.FireballCooldownUntil)
}

func (p *Player) UseMelee() {
	p.MeleeCooldownUntil = time.Now().Add(MeleeCooldown)
	p.State = StateAttacking
}

func (p *Player) UseDash() {
	p.DashCooldownUntil = time.Now().Add(DashCooldown)
	// 向面朝方向冲刺
	p.X += math.Cos(p.Dir) * DashDistance
	p.Y += math.Sin(p.Dir) * DashDistance
	// 边界钳制
	p.X = math.Max(PlayerRadius, math.Min(WorldWidth-PlayerRadius, p.X))
	p.Y = math.Max(PlayerRadius, math.Min(WorldHeight-PlayerRadius, p.Y))
}

func (p *Player) UseFireball() {
	p.FireballCooldownUntil = time.Now().Add(FireballCooldown)
}
