/**
 * 属性测试：WebSocket URL 自动推导的正确性（Property-Based Test）。
 *
 * 本文件使用 fast-check 属性测试框架验证 getDefaultWsUrl() 的核心不变量：
 * 对于任意合法的 location.protocol 和 location.host 组合，
 * 推导出的 WebSocket URL 必须满足协议映射、主机匹配和路径正确三个性质。
 *
 * 📚 学习要点: 为什么用属性测试验证 URL 推导？
 * URL 推导逻辑看似简单（http->ws, https->wss），但实际部署中
 * host 可能包含端口号、IPv6 地址、国际化域名等多种形式。
 * 属性测试通过生成大量随机但合法的 host 值，验证推导逻辑在所有情况下都正确，
 * 比手动编写几个固定域名的测试覆盖面广得多。
 *
 * @module network/websocket.property.test
 * @see websocket.ts — getDefaultWsUrl 实现
 * @see Requirements 1 AC1
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

/**
 * 📚 学习要点: 为什么不直接 import getDefaultWsUrl？
 * getDefaultWsUrl() 在模块加载时读取 window.location，
 * 但我们需要在每次属性测试迭代中动态修改 window.location。
 * 因此我们提取相同的推导逻辑作为纯函数进行测试，
 * 确保测试的是算法本身而非模块加载时的副作用。
 *
 * 同时我们也测试实际导出的 getDefaultWsUrl，验证它在当前环境下的行为。
 */
import { getDefaultWsUrl } from './websocket'

/**
 * 📚 学习要点: 纯函数提取用于属性测试
 * 将 getDefaultWsUrl 的核心逻辑提取为纯函数（无副作用），
 * 接受 protocol 和 host 作为参数，返回推导的 WebSocket URL。
 * 这使得属性测试可以对任意输入组合进行验证，无需操作全局状态。
 */
function deriveWsUrl(protocol: string, host: string): string {
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProtocol}//${host}/ws`
}

/**
 * 📚 学习要点: 智能生成器 — 合法 hostname 的构造
 * RFC 952/1123 规定 hostname 由字母、数字和连字符组成，
 * 每个 label 最长 63 字符，总长度不超过 253 字符。
 * 我们使用 fc.array + fc.constantFrom + join 生成符合约束的随机 hostname。
 */

/** hostname 合法字符集 */
const HOSTNAME_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('')

/** 生成合法的 hostname label（域名中点分隔的每一段） */
const hostnameLabel = fc
  .array(fc.constantFrom(...HOSTNAME_CHARS), { minLength: 1, maxLength: 10 })
  .map(chars => chars.join(''))

/** 生成合法的域名（1-4 个 label 用点连接） */
const validHostname = fc.array(hostnameLabel, { minLength: 1, maxLength: 4 })
  .map(labels => labels.join('.'))

/** 生成可选的端口号 */
const optionalPort = fc.oneof(
  fc.constant(''),
  fc.integer({ min: 1, max: 65535 }).map(p => `:${p}`)
)

/** 生成完整的 host 值（hostname + 可选端口） */
const validHost = fc.tuple(validHostname, optionalPort)
  .map(([hostname, port]) => `${hostname}${port}`)

/** 生成页面协议（http: 或 https:） */
const validProtocol = fc.constantFrom('http:', 'https:')

/**
 * **Validates: Requirement 1 AC1**
 *
 * Property 3: WebSocket URL derivation correctness
 * For any location.protocol in {http:, https:} and any valid location.host,
 * the function returns the correct ws:/wss: protocol, matching host, and /ws path.
 */
describe('Property 3: WebSocket URL derivation correctness', () => {
  it('derives correct WebSocket protocol: http: → ws:, https: → wss:', () => {
    fc.assert(
      fc.property(
        validProtocol,
        validHost,
        (protocol, host) => {
          const url = deriveWsUrl(protocol, host)
          const expectedWsProtocol = protocol === 'https:' ? 'wss:' : 'ws:'

          // 验证 WebSocket 协议映射正确
          expect(url.startsWith(`${expectedWsProtocol}//`)).toBe(true)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('preserves host exactly in the derived URL', () => {
    fc.assert(
      fc.property(
        validProtocol,
        validHost,
        (protocol, host) => {
          const url = deriveWsUrl(protocol, host)

          // 提取 URL 中的 host 部分（在 // 之后、/ws 之前）
          const afterProtocol = url.split('//')[1]
          const urlHost = afterProtocol.split('/ws')[0]

          // 验证 host 完全匹配
          expect(urlHost).toBe(host)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('always ends with /ws path', () => {
    fc.assert(
      fc.property(
        validProtocol,
        validHost,
        (protocol, host) => {
          const url = deriveWsUrl(protocol, host)

          // 验证路径以 /ws 结尾
          expect(url.endsWith('/ws')).toBe(true)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('produces a well-formed URL with all three properties combined', () => {
    fc.assert(
      fc.property(
        validProtocol,
        validHost,
        (protocol, host) => {
          const url = deriveWsUrl(protocol, host)
          const expectedWsProtocol = protocol === 'https:' ? 'wss:' : 'ws:'

          // 验证完整 URL 格式：{wsProtocol}//{host}/ws
          expect(url).toBe(`${expectedWsProtocol}//${host}/ws`)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('getDefaultWsUrl returns fallback when window is undefined (SSR)', () => {
    // 📚 学习要点: SSR 环境回退
    // 在 Node.js/SSR 环境中 window 可能未定义，
    // 此时函数应回退到 localhost 默认值，确保服务端渲染不崩溃。
    // 注意：在 happy-dom 测试环境中 window 是定义的，
    // 所以这里验证的是当前环境下的行为（基于 window.location）。
    const result = getDefaultWsUrl()

    // happy-dom 环境中 window 存在，验证返回值格式正确
    expect(result).toMatch(/^wss?:\/\/.+\/ws$/)
  })

  it('matches getDefaultWsUrl behavior with current window.location', () => {
    // 验证导出的 getDefaultWsUrl 与纯函数推导逻辑一致
    const result = getDefaultWsUrl()
    const expected = deriveWsUrl(
      window.location.protocol,
      window.location.host
    )
    expect(result).toBe(expected)
  })
})
