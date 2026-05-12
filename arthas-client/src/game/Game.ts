import { Application, Container, Graphics } from 'pixi.js'
import { WORLD_WIDTH, WORLD_HEIGHT, PLAYER_RADIUS } from './constants'
import { InputSystem } from './systems/InputSystem'
import { WebSocketManager } from '../network/websocket'
import { useGameStore } from '../stores/gameStore'

export class Game {
  private app: Application
  private container: HTMLDivElement
  private world!: Container
  private inputSystem: InputSystem
  private wsManager: WebSocketManager
  private playerGraphics: Map<string, Graphics> = new Map()
  private coreshardGraphic: Graphics | null = null
  private initialized = false

  constructor(container: HTMLDivElement) {
    this.container = container
    this.app = new Application()
    this.inputSystem = new InputSystem()
    this.wsManager = new WebSocketManager()
  }

  async start() {
    console.log('[Game] Initializing PixiJS...')

    // 初始化 PixiJS v8
    await this.app.init({
      resizeTo: window,
      background: '#1a1a2e',
      antialias: true,
    })

    console.log('[Game] PixiJS initialized, appending canvas...')

    // 添加 canvas 到 DOM
    this.container.appendChild(this.app.canvas as HTMLCanvasElement)

    // 创建世界容器
    this.world = new Container()
    this.app.stage.addChild(this.world)

    // 绘制地图边界和网格
    this.drawMapBorder()

    // 启动输入系统
    this.inputSystem.start()

    // 连接 WebSocket
    this.wsManager.connect()

    // 游戏主循环
    this.app.ticker.add(this.update, this)

    this.initialized = true
    console.log('[Game] Game fully initialized!')
  }

  private drawMapBorder() {
    const border = new Graphics()

    // 地图背景 - 用最简单的方式
    border.rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
    border.fill(0x0d0d1a)

    // 边框
    border.rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
    border.stroke({ color: 0x333366, width: 2 })

    this.world.addChild(border)

    // 网格线单独一个 Graphics
    const grid = new Graphics()
    for (let x = 100; x < WORLD_WIDTH; x += 100) {
      grid.moveTo(x, 0)
      grid.lineTo(x, WORLD_HEIGHT)
    }
    for (let y = 100; y < WORLD_HEIGHT; y += 100) {
      grid.moveTo(0, y)
      grid.lineTo(WORLD_WIDTH, y)
    }
    grid.stroke({ color: 0x1a1a3e, width: 1 })
    this.world.addChild(grid)
  }

  private update() {
    const state = useGameStore.getState()
    const input = this.inputSystem.getInput()

    // 发送输入到服务器
    if (state.connected && state.playerId) {
      this.wsManager.sendInput(input)
    }

    // 更新玩家渲染
    this.updatePlayers(state)

    // 更新资源点渲染
    this.updateCoreshard(state)

    // 摄像机跟随本地玩家
    this.updateCamera(state)
  }

  private updatePlayers(state: ReturnType<typeof useGameStore.getState>) {
    const activePlayers = new Set<string>()

    for (const player of state.players) {
      activePlayers.add(player.id)

      let graphic = this.playerGraphics.get(player.id)
      if (!graphic) {
        graphic = new Graphics()
        this.playerGraphics.set(player.id, graphic)
        this.world.addChild(graphic)
      }

      // 清除并重绘
      graphic.clear()

      const isLocal = player.id === state.playerId
      const color = isLocal ? 0x00ff88 : 0xff4444

      // 玩家圆形身体
      graphic.circle(0, 0, PLAYER_RADIUS)
      if (player.state === 'dead') {
        graphic.fill({ color, alpha: 0.3 })
      } else {
        graphic.fill(color)
      }

      // 面朝方向指示线
      const dirX = Math.cos(player.dir) * PLAYER_RADIUS * 1.5
      const dirY = Math.sin(player.dir) * PLAYER_RADIUS * 1.5
      graphic.moveTo(0, 0)
      graphic.lineTo(dirX, dirY)
      graphic.stroke({ color: 0xffffff, width: 2 })

      // 血条背景
      const hpBarWidth = PLAYER_RADIUS * 2
      graphic.rect(-PLAYER_RADIUS, -PLAYER_RADIUS - 10, hpBarWidth, 5)
      graphic.fill(0x333333)

      // 血条前景
      const hpRatio = player.hp / player.maxHp
      const hpColor = hpRatio > 0.5 ? 0x00ff00 : hpRatio > 0.25 ? 0xffff00 : 0xff0000
      graphic.rect(-PLAYER_RADIUS, -PLAYER_RADIUS - 10, hpBarWidth * hpRatio, 5)
      graphic.fill(hpColor)

      // 设置位置
      graphic.x = player.x
      graphic.y = player.y
    }

    // 移除已离开的玩家图形
    for (const [id, graphic] of this.playerGraphics) {
      if (!activePlayers.has(id)) {
        this.world.removeChild(graphic)
        graphic.destroy()
        this.playerGraphics.delete(id)
      }
    }
  }

  private updateCoreshard(state: ReturnType<typeof useGameStore.getState>) {
    const shard = state.coreshard
    if (!shard) return

    if (!this.coreshardGraphic) {
      this.coreshardGraphic = new Graphics()
      this.world.addChild(this.coreshardGraphic)
    }

    this.coreshardGraphic.clear()

    if (shard.state !== 'cooldown') {
      // 源石碎片：发光菱形
      const pulse = Math.sin(Date.now() / 300) * 0.3 + 0.7

      this.coreshardGraphic.moveTo(0, -14)
      this.coreshardGraphic.lineTo(10, 0)
      this.coreshardGraphic.lineTo(0, 14)
      this.coreshardGraphic.lineTo(-10, 0)
      this.coreshardGraphic.closePath()
      this.coreshardGraphic.fill({ color: 0x9966ff, alpha: pulse })

      // 占领进度环
      if (shard.state === 'capturing' && shard.captureProgress > 0) {
        const endAngle = -Math.PI / 2 + (shard.captureProgress / 100) * Math.PI * 2
        this.coreshardGraphic.arc(0, 0, 26, -Math.PI / 2, endAngle)
        this.coreshardGraphic.stroke({ color: 0xffff00, width: 3 })
      }
    }

    this.coreshardGraphic.x = shard.x
    this.coreshardGraphic.y = shard.y
  }

  private updateCamera(state: ReturnType<typeof useGameStore.getState>) {
    const localPlayer = state.players.find((p) => p.id === state.playerId)
    if (!localPlayer) return

    const screenW = this.app.screen.width
    const screenH = this.app.screen.height

    // 摄像机跟随玩家居中
    this.world.x = screenW / 2 - localPlayer.x
    this.world.y = screenH / 2 - localPlayer.y
  }

  destroy() {
    this.inputSystem.stop()
    this.wsManager.disconnect()
    if (this.initialized) {
      this.app.ticker.remove(this.update, this)
      this.app.destroy(true, { children: true })
    }
  }
}
