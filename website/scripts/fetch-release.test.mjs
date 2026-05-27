/**
 * fetch-release.test.mjs — fetch-release.mjs 的单元测试
 *
 * 📚 学习要点: Node.js 内置测试框架
 * - Node.js 18+ 提供 `node:test` 模块，无需安装第三方测试框架
 * - `node:assert` 提供断言功能
 * - `mock` 模块支持函数/方法 mock（类似 Jest 的 jest.fn()）
 * - 运行方式：node --test scripts/fetch-release.test.mjs
 *
 * 测试覆盖：
 * - 成功 API 响应的解析（transformReleaseData）
 * - API 不可达时的 fallback 行为（getFallbackData + main 集成）
 * - JSON 输出格式验证（schema 结构）
 *
 * 与其他模块的关系：
 * - 直接导入 fetch-release.mjs 的导出函数进行单元测试
 * - 验证 Requirements 7.2（下载链接解析）和 7.6（fallback 机制）
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  transformReleaseData,
  getFallbackData,
  fetchLatestRelease,
  main,
  OUTPUT_FILE,
  DATA_DIR,
  FALLBACK_VERSION,
} from './fetch-release.mjs';

// ─── 测试数据 ─────────────────────────────────────────────────────────────────

/**
 * 模拟 GitHub API 返回的完整 Release 对象（精简版）。
 * 实际 API 返回更多字段，这里只包含脚本使用的字段。
 */
const MOCK_GITHUB_RELEASE = {
  tag_name: 'v2.1.0',
  published_at: '2024-12-01T10:30:00Z',
  assets: [
    {
      name: 'arthas-server-linux-amd64',
      browser_download_url: 'https://github.com/michaelwang123/arthas/releases/download/v2.1.0/arthas-server-linux-amd64',
      size: 15_000_000,
    },
    {
      name: 'arthas-cli-darwin-arm64',
      browser_download_url: 'https://github.com/michaelwang123/arthas/releases/download/v2.1.0/arthas-cli-darwin-arm64',
      size: 12_500_000,
    },
    {
      name: 'arthas-server-windows-amd64.exe',
      browser_download_url: 'https://github.com/michaelwang123/arthas/releases/download/v2.1.0/arthas-server-windows-amd64.exe',
      size: 16_200_000,
    },
  ],
};

// ─── 测试: transformReleaseData ───────────────────────────────────────────────

describe('transformReleaseData', () => {
  it('should extract version from tag_name', () => {
    const result = transformReleaseData(MOCK_GITHUB_RELEASE);
    assert.equal(result.version, 'v2.1.0');
  });

  it('should extract publishedAt timestamp', () => {
    const result = transformReleaseData(MOCK_GITHUB_RELEASE);
    assert.equal(result.publishedAt, '2024-12-01T10:30:00Z');
  });

  it('should map assets with name, url, and size', () => {
    const result = transformReleaseData(MOCK_GITHUB_RELEASE);

    assert.equal(result.assets.length, 3);
    assert.deepEqual(result.assets[0], {
      name: 'arthas-server-linux-amd64',
      url: 'https://github.com/michaelwang123/arthas/releases/download/v2.1.0/arthas-server-linux-amd64',
      size: 15_000_000,
    });
  });

  it('should set fallback to false for successful API data', () => {
    const result = transformReleaseData(MOCK_GITHUB_RELEASE);
    assert.equal(result.fallback, false);
  });

  it('should handle release with empty assets array', () => {
    const releaseNoAssets = {
      tag_name: 'v0.9.0',
      published_at: '2024-01-15T08:00:00Z',
      assets: [],
    };
    const result = transformReleaseData(releaseNoAssets);

    assert.equal(result.version, 'v0.9.0');
    assert.deepEqual(result.assets, []);
    assert.equal(result.fallback, false);
  });

  it('should handle release with undefined assets (defensive)', () => {
    const releaseUndefinedAssets = {
      tag_name: 'v0.8.0',
      published_at: '2024-01-10T08:00:00Z',
      // assets field missing entirely
    };
    const result = transformReleaseData(releaseUndefinedAssets);

    assert.equal(result.version, 'v0.8.0');
    assert.deepEqual(result.assets, []);
    assert.equal(result.fallback, false);
  });
});

// ─── 测试: getFallbackData ────────────────────────────────────────────────────

describe('getFallbackData', () => {
  it('should return the hardcoded fallback version', () => {
    const result = getFallbackData();
    assert.equal(result.version, FALLBACK_VERSION);
  });

  it('should return empty assets array', () => {
    const result = getFallbackData();
    assert.deepEqual(result.assets, []);
  });

  it('should set publishedAt to null', () => {
    const result = getFallbackData();
    assert.equal(result.publishedAt, null);
  });

  it('should set fallback flag to true', () => {
    const result = getFallbackData();
    assert.equal(result.fallback, true);
  });
});

// ─── 测试: fetchLatestRelease (with mocked fetch) ─────────────────────────────

describe('fetchLatestRelease', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return parsed JSON on successful API response', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => MOCK_GITHUB_RELEASE,
    }));

    const result = await fetchLatestRelease();

    assert.notEqual(result, null);
    assert.equal(result.tag_name, 'v2.1.0');
    assert.equal(result.assets.length, 3);
  });

  it('should return null when API returns non-OK status', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    }));

    const result = await fetchLatestRelease();
    assert.equal(result, null);
  });

  it('should return null when fetch throws a network error', async () => {
    globalThis.fetch = mock.fn(async () => {
      throw new Error('Network unreachable');
    });

    const result = await fetchLatestRelease();
    assert.equal(result, null);
  });

  it('should return null on request timeout (AbortError)', async () => {
    globalThis.fetch = mock.fn(async (url, options) => {
      // Simulate abort by checking signal
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    });

    const result = await fetchLatestRelease();
    assert.equal(result, null);
  });
});

// ─── 测试: JSON 输出格式验证 ──────────────────────────────────────────────────

describe('JSON output format', () => {
  it('successful response should match expected schema', () => {
    const result = transformReleaseData(MOCK_GITHUB_RELEASE);

    // 验证顶层字段存在且类型正确
    assert.equal(typeof result.version, 'string');
    assert.ok(result.version.startsWith('v'), 'version should start with "v"');
    assert.ok(Array.isArray(result.assets), 'assets should be an array');
    assert.equal(typeof result.publishedAt, 'string');
    assert.equal(typeof result.fallback, 'boolean');
    assert.equal(result.fallback, false);

    // 验证每个 asset 的结构
    for (const asset of result.assets) {
      assert.equal(typeof asset.name, 'string');
      assert.equal(typeof asset.url, 'string');
      assert.ok(asset.url.startsWith('https://'), 'asset url should be HTTPS');
      assert.equal(typeof asset.size, 'number');
      assert.ok(asset.size > 0, 'asset size should be positive');
    }
  });

  it('fallback response should match expected schema', () => {
    const result = getFallbackData();

    // 验证顶层字段存在且类型正确
    assert.equal(typeof result.version, 'string');
    assert.ok(result.version.startsWith('v'), 'version should start with "v"');
    assert.ok(Array.isArray(result.assets), 'assets should be an array');
    assert.equal(result.assets.length, 0);
    assert.equal(result.publishedAt, null);
    assert.equal(typeof result.fallback, 'boolean');
    assert.equal(result.fallback, true);
  });

  it('output JSON should be valid and parseable', () => {
    const data = transformReleaseData(MOCK_GITHUB_RELEASE);
    const jsonString = JSON.stringify(data, null, 2);

    // 验证 JSON 可以被正确解析回来
    const parsed = JSON.parse(jsonString);
    assert.deepEqual(parsed, data);
  });
});

// ─── 测试: main() 集成测试（写入文件） ────────────────────────────────────────

describe('main() integration', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // 确保 data 目录存在
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should write release.json with API data on success', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      json: async () => MOCK_GITHUB_RELEASE,
    }));

    await main();

    assert.ok(existsSync(OUTPUT_FILE), 'release.json should exist');
    const content = JSON.parse(readFileSync(OUTPUT_FILE, 'utf-8'));
    assert.equal(content.version, 'v2.1.0');
    assert.equal(content.fallback, false);
    assert.equal(content.assets.length, 3);
  });

  it('should write fallback release.json when API is unreachable', async () => {
    globalThis.fetch = mock.fn(async () => {
      throw new Error('ECONNREFUSED');
    });

    await main();

    assert.ok(existsSync(OUTPUT_FILE), 'release.json should exist even on failure');
    const content = JSON.parse(readFileSync(OUTPUT_FILE, 'utf-8'));
    assert.equal(content.version, FALLBACK_VERSION);
    assert.equal(content.fallback, true);
    assert.deepEqual(content.assets, []);
    assert.equal(content.publishedAt, null);
  });
});
