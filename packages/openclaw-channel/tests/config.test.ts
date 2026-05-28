/**
 * @file config.test.ts — 配置模块单元测试
 *
 * 测试覆盖：
 * 1. 从环境变量加载配置
 * 2. 从 ChannelConfig 对象加载配置
 * 3. 配置优先级（环境变量 > ChannelConfig > 默认值）
 * 4. 必填字段验证（serverUrl, shareCode）
 * 5. 格式验证（URL 协议、分享码段数）
 * 6. 默认值（displayName, signingEnabled）
 *
 * @module openclaw-channel/tests/config
 * @see src/config.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config';

describe('config — loadConfig()', () => {
  // 保存原始环境变量，测试后恢复
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // 清除所有 ARTHAS_ 环境变量，确保测试隔离
    delete process.env.ARTHAS_SERVER_URL;
    delete process.env.ARTHAS_SHARE_CODE;
    delete process.env.ARTHAS_DISPLAY_NAME;
    delete process.env.ARTHAS_SIGNING_ENABLED;
    delete process.env.ARTHAS_ROOM_PASSWORD;
  });

  afterEach(() => {
    // 恢复原始环境变量
    process.env = { ...originalEnv };
  });

  // ==========================================================================
  // 从环境变量加载
  // ==========================================================================

  describe('环境变量加载', () => {
    it('应从环境变量加载完整配置', () => {
      process.env.ARTHAS_SERVER_URL = 'wss://example.com/ws';
      process.env.ARTHAS_SHARE_CODE = 'room123:key456';
      process.env.ARTHAS_DISPLAY_NAME = 'Test Bot';
      process.env.ARTHAS_SIGNING_ENABLED = 'true';
      process.env.ARTHAS_ROOM_PASSWORD = 'secret123';

      const config = loadConfig();

      expect(config.serverUrl).toBe('wss://example.com/ws');
      expect(config.shareCode).toBe('room123:key456');
      expect(config.displayName).toBe('Test Bot');
      expect(config.signingEnabled).toBe(true);
      expect(config.roomPassword).toBe('secret123');
    });

    it('应将 ARTHAS_SIGNING_ENABLED="1" 解析为 true', () => {
      process.env.ARTHAS_SERVER_URL = 'wss://example.com/ws';
      process.env.ARTHAS_SHARE_CODE = 'room123:key456';
      process.env.ARTHAS_SIGNING_ENABLED = '1';

      const config = loadConfig();
      expect(config.signingEnabled).toBe(true);
    });

    it('应将 ARTHAS_SIGNING_ENABLED="false" 解析为 false', () => {
      process.env.ARTHAS_SERVER_URL = 'wss://example.com/ws';
      process.env.ARTHAS_SHARE_CODE = 'room123:key456';
      process.env.ARTHAS_SIGNING_ENABLED = 'false';

      const config = loadConfig();
      expect(config.signingEnabled).toBe(false);
    });

    it('应忽略空字符串环境变量', () => {
      process.env.ARTHAS_SERVER_URL = '';
      process.env.ARTHAS_SHARE_CODE = '';

      // 没有有效配置来源，应抛出缺少 serverUrl 的错误
      expect(() => loadConfig()).toThrow('serverUrl');
    });

    it('应 trim 环境变量中的空白字符', () => {
      process.env.ARTHAS_SERVER_URL = '  wss://example.com/ws  ';
      process.env.ARTHAS_SHARE_CODE = '  room123:key456  ';
      process.env.ARTHAS_DISPLAY_NAME = '  My Bot  ';

      const config = loadConfig();

      expect(config.serverUrl).toBe('wss://example.com/ws');
      expect(config.shareCode).toBe('room123:key456');
      expect(config.displayName).toBe('My Bot');
    });
  });

  // ==========================================================================
  // 从 ChannelConfig 对象加载
  // ==========================================================================

  describe('ChannelConfig 对象加载', () => {
    it('应从 ChannelConfig 对象加载完整配置', () => {
      const config = loadConfig({
        serverUrl: 'wss://channel.example.com/ws',
        shareCode: 'abc:def',
        displayName: 'Channel Bot',
        signingEnabled: true,
        roomPassword: 'pass123',
      });

      expect(config.serverUrl).toBe('wss://channel.example.com/ws');
      expect(config.shareCode).toBe('abc:def');
      expect(config.displayName).toBe('Channel Bot');
      expect(config.signingEnabled).toBe(true);
      expect(config.roomPassword).toBe('pass123');
    });

    it('应将字符串 "true" 的 signingEnabled 解析为 boolean true', () => {
      const config = loadConfig({
        serverUrl: 'wss://example.com/ws',
        shareCode: 'room:key',
        signingEnabled: 'true',
      });

      expect(config.signingEnabled).toBe(true);
    });

    it('应忽略 ChannelConfig 中的空字符串字段', () => {
      // serverUrl 为空字符串，应被忽略，导致缺少必填字段
      expect(() => loadConfig({
        serverUrl: '',
        shareCode: 'room:key',
      })).toThrow('serverUrl');
    });

    it('应 trim ChannelConfig 中的字符串值', () => {
      const config = loadConfig({
        serverUrl: '  wss://example.com/ws  ',
        shareCode: '  room:key  ',
      });

      expect(config.serverUrl).toBe('wss://example.com/ws');
      expect(config.shareCode).toBe('room:key');
    });
  });

  // ==========================================================================
  // 配置优先级
  // ==========================================================================

  describe('配置优先级（环境变量 > ChannelConfig > 默认值）', () => {
    it('环境变量应覆盖 ChannelConfig', () => {
      process.env.ARTHAS_SERVER_URL = 'wss://env-server.com/ws';
      process.env.ARTHAS_SHARE_CODE = 'env-room:env-key';
      process.env.ARTHAS_DISPLAY_NAME = 'Env Bot';

      const config = loadConfig({
        serverUrl: 'wss://channel-server.com/ws',
        shareCode: 'channel-room:channel-key',
        displayName: 'Channel Bot',
      });

      expect(config.serverUrl).toBe('wss://env-server.com/ws');
      expect(config.shareCode).toBe('env-room:env-key');
      expect(config.displayName).toBe('Env Bot');
    });

    it('ChannelConfig 应覆盖默认值', () => {
      const config = loadConfig({
        serverUrl: 'wss://example.com/ws',
        shareCode: 'room:key',
        displayName: 'Custom Name',
        signingEnabled: true,
      });

      expect(config.displayName).toBe('Custom Name');
      expect(config.signingEnabled).toBe(true);
    });

    it('未设置时应使用默认值', () => {
      process.env.ARTHAS_SERVER_URL = 'wss://example.com/ws';
      process.env.ARTHAS_SHARE_CODE = 'room:key';

      const config = loadConfig();

      expect(config.displayName).toBe('AI Assistant');
      expect(config.signingEnabled).toBe(false);
    });
  });

  // ==========================================================================
  // 必填字段验证
  // ==========================================================================

  describe('必填字段验证', () => {
    it('缺少 serverUrl 时应抛出描述性错误', () => {
      process.env.ARTHAS_SHARE_CODE = 'room:key';

      expect(() => loadConfig()).toThrow('serverUrl');
      expect(() => loadConfig()).toThrow('ARTHAS_SERVER_URL');
    });

    it('缺少 shareCode 时应抛出描述性错误', () => {
      process.env.ARTHAS_SERVER_URL = 'wss://example.com/ws';

      expect(() => loadConfig()).toThrow('shareCode');
      expect(() => loadConfig()).toThrow('ARTHAS_SHARE_CODE');
    });
  });

  // ==========================================================================
  // URL 格式验证
  // ==========================================================================

  describe('serverUrl 格式验证', () => {
    it('应接受 wss:// 协议', () => {
      const config = loadConfig({
        serverUrl: 'wss://secure.example.com/ws',
        shareCode: 'room:key',
      });

      expect(config.serverUrl).toBe('wss://secure.example.com/ws');
    });

    it('应接受 ws:// 协议（开发环境）', () => {
      const config = loadConfig({
        serverUrl: 'ws://localhost:9000/ws',
        shareCode: 'room:key',
      });

      expect(config.serverUrl).toBe('ws://localhost:9000/ws');
    });

    it('应拒绝 http:// 协议', () => {
      expect(() => loadConfig({
        serverUrl: 'http://example.com/ws',
        shareCode: 'room:key',
      })).toThrow('serverUrl 格式无效');
    });

    it('应拒绝 https:// 协议', () => {
      expect(() => loadConfig({
        serverUrl: 'https://example.com/ws',
        shareCode: 'room:key',
      })).toThrow('serverUrl 格式无效');
    });

    it('应拒绝无协议的 URL', () => {
      expect(() => loadConfig({
        serverUrl: 'example.com/ws',
        shareCode: 'room:key',
      })).toThrow('serverUrl 格式无效');
    });
  });

  // ==========================================================================
  // 分享码格式验证
  // ==========================================================================

  describe('shareCode 格式验证', () => {
    it('应接受 2 段分享码（roomId:key）', () => {
      const config = loadConfig({
        serverUrl: 'wss://example.com/ws',
        shareCode: 'myRoom:aGVsbG8=',
      });

      expect(config.shareCode).toBe('myRoom:aGVsbG8=');
    });

    it('应接受 4 段分享码（roomId:key:ephemeral:expiresAt）', () => {
      const config = loadConfig({
        serverUrl: 'wss://example.com/ws',
        shareCode: 'room123:key456:1:1700000000',
      });

      expect(config.shareCode).toBe('room123:key456:1:1700000000');
    });

    it('应拒绝只有 1 段的分享码', () => {
      expect(() => loadConfig({
        serverUrl: 'wss://example.com/ws',
        shareCode: 'onlyroomid',
      })).toThrow('至少 2 个冒号分隔的段');
    });

    it('应拒绝 roomId 为空的分享码', () => {
      expect(() => loadConfig({
        serverUrl: 'wss://example.com/ws',
        shareCode: ':key456',
      })).toThrow('roomId 和 key 段不能为空');
    });

    it('应拒绝 key 为空的分享码', () => {
      expect(() => loadConfig({
        serverUrl: 'wss://example.com/ws',
        shareCode: 'room123:',
      })).toThrow('roomId 和 key 段不能为空');
    });
  });

  // ==========================================================================
  // 默认值
  // ==========================================================================

  describe('默认值', () => {
    it('displayName 默认为 "AI Assistant"', () => {
      const config = loadConfig({
        serverUrl: 'wss://example.com/ws',
        shareCode: 'room:key',
      });

      expect(config.displayName).toBe('AI Assistant');
    });

    it('signingEnabled 默认为 false', () => {
      const config = loadConfig({
        serverUrl: 'wss://example.com/ws',
        shareCode: 'room:key',
      });

      expect(config.signingEnabled).toBe(false);
    });

    it('roomPassword 默认不存在', () => {
      const config = loadConfig({
        serverUrl: 'wss://example.com/ws',
        shareCode: 'room:key',
      });

      expect(config.roomPassword).toBeUndefined();
    });
  });
});
