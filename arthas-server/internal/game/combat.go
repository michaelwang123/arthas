package game

import "math"

// CheckMeleeHit 检查近战攻击是否命中目标
func CheckMeleeHit(attacker, target *Player) bool {
	if !target.IsAlive() || attacker.ID == target.ID {
		return false
	}

	dx := target.X - attacker.X
	dy := target.Y - attacker.Y
	dist := math.Sqrt(dx*dx + dy*dy)

	// 距离检查
	if dist > MeleeRange {
		return false
	}

	// 扇形角度检查（面朝方向 ±45°）
	angle := math.Atan2(dy, dx)
	diff := angleDiff(attacker.Dir, angle)
	return math.Abs(diff) <= MeleeArc
}

// ProcessMeleeAttack 处理近战攻击
func ProcessMeleeAttack(attacker *Player, players map[string]*Player) []string {
	if !attacker.CanMelee() {
		return nil
	}

	attacker.UseMelee()
	var hitIDs []string

	for _, target := range players {
		if CheckMeleeHit(attacker, target) {
			target.TakeDamage(MeleeDamage)
			hitIDs = append(hitIDs, target.ID)
		}
	}

	return hitIDs
}

// angleDiff 计算两个角度之间的最短差值
func angleDiff(a, b float64) float64 {
	diff := b - a
	for diff > math.Pi {
		diff -= 2 * math.Pi
	}
	for diff < -math.Pi {
		diff += 2 * math.Pi
	}
	return diff
}
