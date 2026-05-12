package game

import "math"

type Projectile struct {
	ID       string
	X, Y     float64
	DX, DY   float64 // 方向向量（已归一化）
	Speed    float64
	OwnerID  string
	SkillID  int
	Damage   int
	Radius   float64
	MaxRange float64
	Traveled float64
	Active   bool
}

func NewFireball(id, ownerID string, startX, startY, targetX, targetY float64) *Projectile {
	dx := targetX - startX
	dy := targetY - startY
	length := math.Sqrt(dx*dx + dy*dy)

	if length == 0 {
		dx = 1
		dy = 0
	} else {
		dx /= length
		dy /= length
	}

	return &Projectile{
		ID:       id,
		X:        startX,
		Y:        startY,
		DX:       dx,
		DY:       dy,
		Speed:    FireballSpeed,
		OwnerID:  ownerID,
		SkillID:  2,
		Damage:   FireballDamage,
		Radius:   FireballRadius,
		MaxRange: FireballRange,
		Traveled: 0,
		Active:   true,
	}
}

func (p *Projectile) Update(dt float64) {
	if !p.Active {
		return
	}

	move := p.Speed * dt
	p.X += p.DX * move
	p.Y += p.DY * move
	p.Traveled += move

	// 超出射程或出界则销毁
	if p.Traveled >= p.MaxRange ||
		p.X < 0 || p.X > WorldWidth ||
		p.Y < 0 || p.Y > WorldHeight {
		p.Active = false
	}
}

func (p *Projectile) HitsPlayer(player *Player) bool {
	if !p.Active || player.ID == p.OwnerID || !player.IsAlive() {
		return false
	}

	dx := player.X - p.X
	dy := player.Y - p.Y
	dist := math.Sqrt(dx*dx + dy*dy)

	return dist < p.Radius+PlayerRadius
}
