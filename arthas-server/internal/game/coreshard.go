package game

import (
	"math"
	"math/rand"
	"time"
)

type CoreshardStateEnum string

const (
	ShardIdle      CoreshardStateEnum = "idle"
	ShardCapturing CoreshardStateEnum = "capturing"
	ShardCooldown  CoreshardStateEnum = "cooldown"
)

type Coreshard struct {
	X, Y              float64
	State             CoreshardStateEnum
	CapturingPlayerID string
	CaptureStartTime  time.Time
	CaptureProgress   float64 // 0-100
	RespawnTime       time.Time
}

func NewCoreshard() *Coreshard {
	return &Coreshard{
		X:     WorldWidth / 2,
		Y:     WorldHeight / 2,
		State: ShardIdle,
	}
}

func (cs *Coreshard) Update(players map[string]*Player) string {
	// 返回得分玩家 ID（如果有）
	switch cs.State {
	case ShardIdle:
		// 检测是否有玩家在范围内
		for _, p := range players {
			if p.IsAlive() && cs.inRange(p) {
				cs.State = ShardCapturing
				cs.CapturingPlayerID = p.ID
				cs.CaptureStartTime = time.Now()
				cs.CaptureProgress = 0
				break
			}
		}

	case ShardCapturing:
		player, exists := players[cs.CapturingPlayerID]
		// 玩家离开范围或死亡 → 中断
		if !exists || !player.IsAlive() || !cs.inRange(player) {
			cs.State = ShardIdle
			cs.CaptureProgress = 0
			cs.CapturingPlayerID = ""
			return ""
		}

		// 推进占领
		elapsed := time.Since(cs.CaptureStartTime)
		cs.CaptureProgress = float64(elapsed) / float64(CoreshardCaptureTime) * 100

		if cs.CaptureProgress >= 100 {
			// 占领成功
			cs.State = ShardCooldown
			cs.RespawnTime = time.Now().Add(CoreshardRespawnTime)
			cs.CaptureProgress = 100
			scoredPlayer := cs.CapturingPlayerID
			cs.CapturingPlayerID = ""
			return scoredPlayer
		}

	case ShardCooldown:
		if time.Now().After(cs.RespawnTime) {
			cs.State = ShardIdle
			cs.CaptureProgress = 0
			cs.randomizePosition()
		}
	}

	return ""
}

func (cs *Coreshard) inRange(p *Player) bool {
	dx := p.X - cs.X
	dy := p.Y - cs.Y
	dist := math.Sqrt(dx*dx + dy*dy)
	return dist <= CoreshardCaptureRange
}

func (cs *Coreshard) randomizePosition() {
	cs.X = rand.Float64()*WorldWidth*0.6 + WorldWidth*0.2
	cs.Y = rand.Float64()*WorldHeight*0.6 + WorldHeight*0.2
}

func (cs *Coreshard) GetRespawnTimer() float64 {
	if cs.State != ShardCooldown {
		return 0
	}
	remaining := time.Until(cs.RespawnTime).Seconds()
	if remaining < 0 {
		return 0
	}
	return remaining
}
