package network

// 消息类型 ID
const (
	// 客户端 → 服务器
	MsgPlayerInput uint8 = 0x01
	MsgSkillUse    uint8 = 0x02
	MsgPong        uint8 = 0x03

	// 服务器 → 客户端
	MsgGameState       uint8 = 0x10
	MsgPlayerJoined    uint8 = 0x11
	MsgPlayerLeft      uint8 = 0x12
	MsgSkillEffect     uint8 = 0x13
	MsgPlayerDied      uint8 = 0x14
	MsgPlayerRespawned uint8 = 0x15
	MsgScoreUpdate     uint8 = 0x16
	MsgGameOver        uint8 = 0x17
	MsgServerPing      uint8 = 0x18
	MsgWelcome         uint8 = 0x19
)

// Message 通用消息信封
type Message struct {
	Type uint8       `msgpack:"type"`
	Data interface{} `msgpack:"data"`
}

// PlayerInputData 玩家输入
type PlayerInputData struct {
	Seq    uint32  `msgpack:"seq"`
	DX     float64 `msgpack:"dx"`
	DY     float64 `msgpack:"dy"`
	Attack bool    `msgpack:"attack"`
	MouseX float64 `msgpack:"mouseX"`
	MouseY float64 `msgpack:"mouseY"`
}

// SkillUseData 技能使用
type SkillUseData struct {
	SkillID int     `msgpack:"skillId"`
	TargetX float64 `msgpack:"targetX"`
	TargetY float64 `msgpack:"targetY"`
}

// WelcomeData 欢迎消息
type WelcomeData struct {
	PlayerID   string     `msgpack:"playerId"`
	GameConfig GameConfig `msgpack:"gameConfig"`
}

type GameConfig struct {
	WorldWidth  float64 `msgpack:"worldWidth"`
	WorldHeight float64 `msgpack:"worldHeight"`
	TickRate    int     `msgpack:"tickRate"`
}
