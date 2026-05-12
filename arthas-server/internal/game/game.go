package game

import (
	"fmt"
	"log"
	"sync"
	"time"
)

// Broadcaster 接口，由 network.Hub 实现
type Broadcaster interface {
	BroadcastGameState(state *GameStateSnapshot)
	SendToPlayer(playerID string, msgType uint8, data interface{})
}

type GameStateSnapshot struct {
	Tick        uint32               `msgpack:"tick"`
	Players     []PlayerSnapshot     `msgpack:"players"`
	Projectiles []ProjectileSnapshot `msgpack:"projectiles"`
	Coreshard   CoreshardSnapshot    `msgpack:"coreshard"`
}

type PlayerSnapshot struct {
	ID           string  `msgpack:"id"`
	X            float64 `msgpack:"x"`
	Y            float64 `msgpack:"y"`
	HP           int     `msgpack:"hp"`
	MaxHP        int     `msgpack:"maxHp"`
	Dir          float64 `msgpack:"dir"`
	State        string  `msgpack:"state"`
	LastInputSeq uint32  `msgpack:"lastInputSeq"`
}

type ProjectileSnapshot struct {
	ID      string  `msgpack:"id"`
	X       float64 `msgpack:"x"`
	Y       float64 `msgpack:"y"`
	DX      float64 `msgpack:"dx"`
	DY      float64 `msgpack:"dy"`
	OwnerID string  `msgpack:"ownerId"`
	SkillID int     `msgpack:"skillId"`
}

type CoreshardSnapshot struct {
	X                 float64 `msgpack:"x"`
	Y                 float64 `msgpack:"y"`
	State             string  `msgpack:"state"`
	CapturingPlayerID string  `msgpack:"capturingPlayerId"`
	CaptureProgress   float64 `msgpack:"captureProgress"`
	RespawnTimer      float64 `msgpack:"respawnTimer"`
}

type Game struct {
	mu          sync.RWMutex
	players     map[string]*Player
	projectiles map[string]*Projectile
	coreshard   *Coreshard
	tick        uint32
	projIDSeq   int
	startTime   time.Time
	gameOver    bool
}

func NewGame() *Game {
	return &Game{
		players:     make(map[string]*Player),
		projectiles: make(map[string]*Projectile),
		coreshard:   NewCoreshard(),
		startTime:   time.Now(),
	}
}

// Run 启动游戏主循环（20Hz）
func (g *Game) Run(broadcaster Broadcaster) {
	ticker := time.NewTicker(TickDuration)
	defer ticker.Stop()

	log.Println("[Game] Game loop started at", TickRate, "Hz")

	for range ticker.C {
		g.update(broadcaster)
	}
}

func (g *Game) update(broadcaster Broadcaster) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.gameOver {
		return
	}

	dt := float64(TickDuration) / float64(time.Second)
	g.tick++

	// 1. 更新所有玩家
	for _, p := range g.players {
		p.Update(dt)
	}

	// 2. 处理攻击
	for _, p := range g.players {
		if p.Attacking && p.CanMelee() {
			hitIDs := ProcessMeleeAttack(p, g.players)
			for _, hitID := range hitIDs {
				target := g.players[hitID]
				if target != nil && !target.IsAlive() {
					// 击杀者得分
					p.Score += DeathPenaltyScore
				}
			}
		}
	}

	// 3. 更新投射物
	for id, proj := range g.projectiles {
		proj.Update(dt)

		// 命中检测
		for _, target := range g.players {
			if proj.HitsPlayer(target) {
				target.TakeDamage(proj.Damage)
				proj.Active = false

				// 击杀得分
				if !target.IsAlive() {
					if owner, ok := g.players[proj.OwnerID]; ok {
						owner.Score += DeathPenaltyScore
					}
				}
				break
			}
		}

		// 清理失活投射物
		if !proj.Active {
			delete(g.projectiles, id)
		}
	}

	// 4. 更新资源点
	scoredPlayerID := g.coreshard.Update(g.players)
	if scoredPlayerID != "" {
		if p, ok := g.players[scoredPlayerID]; ok {
			p.Score += CoreshardScore
			log.Printf("[Game] Player %s captured coreshard! Score: %d", scoredPlayerID, p.Score)
		}
	}

	// 5. 检查游戏结束
	if time.Since(g.startTime) >= GameDuration {
		g.endGame(broadcaster)
		return
	}

	// 6. 广播游戏状态
	snapshot := g.createSnapshot()
	broadcaster.BroadcastGameState(snapshot)
}

func (g *Game) createSnapshot() *GameStateSnapshot {
	players := make([]PlayerSnapshot, 0, len(g.players))
	for _, p := range g.players {
		players = append(players, PlayerSnapshot{
			ID:           p.ID,
			X:            p.X,
			Y:            p.Y,
			HP:           p.HP,
			MaxHP:        p.MaxHP,
			Dir:          p.Dir,
			State:        string(p.State),
			LastInputSeq: p.LastInputSeq,
		})
	}

	projectiles := make([]ProjectileSnapshot, 0, len(g.projectiles))
	for _, proj := range g.projectiles {
		projectiles = append(projectiles, ProjectileSnapshot{
			ID:      proj.ID,
			X:       proj.X,
			Y:       proj.Y,
			DX:      proj.DX,
			DY:      proj.DY,
			OwnerID: proj.OwnerID,
			SkillID: proj.SkillID,
		})
	}

	return &GameStateSnapshot{
		Tick:        g.tick,
		Players:     players,
		Projectiles: projectiles,
		Coreshard: CoreshardSnapshot{
			X:                 g.coreshard.X,
			Y:                 g.coreshard.Y,
			State:             string(g.coreshard.State),
			CapturingPlayerID: g.coreshard.CapturingPlayerID,
			CaptureProgress:   g.coreshard.CaptureProgress,
			RespawnTimer:      g.coreshard.GetRespawnTimer(),
		},
	}
}

func (g *Game) endGame(broadcaster Broadcaster) {
	g.gameOver = true

	// 找到赢家
	var winnerID string
	maxScore := -1
	scores := make(map[string]int)

	for _, p := range g.players {
		scores[p.ID] = p.Score
		if p.Score > maxScore {
			maxScore = p.Score
			winnerID = p.ID
		}
	}

	log.Printf("[Game] Game over! Winner: %s with %d points", winnerID, maxScore)

	// 广播游戏结束
	for id := range g.players {
		broadcaster.SendToPlayer(id, 0x17, map[string]interface{}{
			"winnerId": winnerID,
			"scores":   scores,
		})
	}

	// 5 秒后自动重置游戏
	go func() {
		time.Sleep(5 * time.Second)
		g.mu.Lock()
		defer g.mu.Unlock()
		g.reset()
		log.Println("[Game] Game reset! New round starting.")
	}()
}

// === 外部调用接口 ===

func (g *Game) AddPlayer(id string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	player := NewPlayer(id)
	g.players[id] = player
	log.Printf("[Game] Player %s joined at (%.0f, %.0f)", id, player.X, player.Y)
}

func (g *Game) RemovePlayer(id string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	delete(g.players, id)
	log.Printf("[Game] Player %s left", id)
}

func (g *Game) HandleInput(playerID string, seq uint32, dx, dy float64, attack bool, mouseX, mouseY float64) {
	g.mu.Lock()
	defer g.mu.Unlock()

	p, ok := g.players[playerID]
	if !ok {
		return
	}

	p.InputDX = dx
	p.InputDY = dy
	p.Attacking = attack
	p.MouseX = mouseX
	p.MouseY = mouseY
	p.LastInputSeq = seq

	// 更新面朝方向（朝向鼠标）
	if mouseX != 0 || mouseY != 0 {
		// 注意：mouseX/mouseY 是屏幕坐标，需要转换
		// MVP 阶段简化：用移动方向作为面朝方向
	}
}

func (g *Game) HandleSkillUse(playerID string, skillID int, targetX, targetY float64) {
	g.mu.Lock()
	defer g.mu.Unlock()

	p, ok := g.players[playerID]
	if !ok || !p.IsAlive() {
		return
	}

	switch skillID {
	case 1: // 冲刺
		if p.CanDash() {
			p.UseDash()
			log.Printf("[Game] Player %s used Dash", playerID)
		}
	case 2: // 火球
		if p.CanFireball() {
			p.UseFireball()
			g.projIDSeq++
			projID := fmt.Sprintf("proj_%d", g.projIDSeq)
			fireball := NewFireball(projID, playerID, p.X, p.Y, targetX, targetY)
			g.projectiles[projID] = fireball
			log.Printf("[Game] Player %s fired Fireball", playerID)
		}
	}
}

func (g *Game) GetPlayerPosition(playerID string) (float64, float64) {
	g.mu.RLock()
	defer g.mu.RUnlock()

	if p, ok := g.players[playerID]; ok {
		return p.X, p.Y
	}
	return WorldWidth / 2, WorldHeight / 2
}

func (g *Game) GetScores() map[string]int {
	g.mu.RLock()
	defer g.mu.RUnlock()

	scores := make(map[string]int)
	for _, p := range g.players {
		scores[p.ID] = p.Score
	}
	return scores
}

func (g *Game) reset() {
	g.gameOver = false
	g.tick = 0
	g.startTime = time.Now()
	g.projectiles = make(map[string]*Projectile)
	g.coreshard = NewCoreshard()

	// 重置所有玩家
	for _, p := range g.players {
		p.Score = 0
		p.HP = PlayerMaxHP
		p.State = StateIdle
		p.X = float64(400 + (len(g.players) * 50))
		p.Y = float64(400)
		p.Respawn()
	}
}
