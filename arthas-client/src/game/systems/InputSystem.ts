export interface PlayerInput {
  dx: number // -1, 0, 1
  dy: number // -1, 0, 1
  attack: boolean
  skill1: boolean
  skill2: boolean
  mouseX: number
  mouseY: number
}

export class InputSystem {
  private keys: Set<string> = new Set()
  private mouseDown = false
  private mouseX = 0
  private mouseY = 0
  private skill1Pressed = false
  private skill2Pressed = false

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code)
    if (e.code === 'KeyQ') this.skill1Pressed = true
    if (e.code === 'KeyE') this.skill2Pressed = true
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }

  private onMouseDown = () => {
    this.mouseDown = true
  }

  private onMouseUp = () => {
    this.mouseDown = false
  }

  private onMouseMove = (e: MouseEvent) => {
    this.mouseX = e.clientX
    this.mouseY = e.clientY
  }

  start() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mouseup', this.onMouseUp)
    window.addEventListener('mousemove', this.onMouseMove)
  }

  stop() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mouseup', this.onMouseUp)
    window.removeEventListener('mousemove', this.onMouseMove)
  }

  getInput(): PlayerInput {
    let dx = 0
    let dy = 0

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) dy = -1
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) dy = 1
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) dx = -1
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) dx = 1

    // 归一化对角线移动
    if (dx !== 0 && dy !== 0) {
      const len = Math.sqrt(dx * dx + dy * dy)
      dx /= len
      dy /= len
    }

    const input: PlayerInput = {
      dx,
      dy,
      attack: this.mouseDown,
      skill1: this.skill1Pressed,
      skill2: this.skill2Pressed,
      mouseX: this.mouseX,
      mouseY: this.mouseY,
    }

    // 重置一次性输入
    this.skill1Pressed = false
    this.skill2Pressed = false

    return input
  }
}
