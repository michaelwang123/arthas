/**
 * fetch-release.mjs �?GitHub Release 数据获取脚本
 *
 * 📚 学习要点: 为什么在构建时获�?Release 数据�?
 * - 下载页面需要展示最新版本号和各平台下载链接
 * - 使用 GitHub API 在构建时获取，而非运行时请求（静态站点无后端�?
 * - 构建时获取意味着每次部署都会更新版本信息
 * - 如果 API 不可达（网络问题、Rate Limit），使用 fallback 数据避免构建失败
 *
 * 职责�?
 * - �?GitHub API 获取 michaelwang123/arthas 仓库的最�?Release 信息
 * - 提取版本号、发布时间、各平台二进制资产的下载链接
 * - 将结果写�?src/data/release.json �?Astro 页面组件读取
 * - API 不可达时写入 fallback 数据并输出警告日�?
 *
 * 与其他模块的关系�?
 * - package.json build script �?astro build 前执行本脚本
 * - src/data/release.json 被下载页面组件读取以渲染下载按钮
 * - GitHub Actions deploy-website workflow 在构建时自动执行
 *
 * 用法：node scripts/fetch-release.mjs
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 📚 学习要点: ESM 中获�?__dirname
// ESM 模块没有 __dirname 全局变量，需要从 import.meta.url 推导�?
const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

// ─── 配置 ───────────────────────────────────────────────────────────────────────

const WEBSITE_ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(WEBSITE_ROOT, 'src', 'data');
const OUTPUT_FILE = resolve(DATA_DIR, 'release.json');

/**
 * GitHub API 端点 �?获取最�?Release
 *
 * 📚 学习要点: GitHub REST API Rate Limit
 * - 未认证请求：60 �?小时（按 IP�?
 * - 认证请求（带 token）：5000 �?小时
 * - CI 环境通常�?GITHUB_TOKEN，但本脚本不强制要求
 * - 如果超出限制，API 返回 403，脚本会 fallback 到硬编码数据
 */
const GITHUB_API_URL = 'https://api.github.com/repos/michaelwang123/arthas/releases/latest';

/**
 * Fallback 版本�?�?�?API 不可达时使用
 * 应在每次正式发版后手动更新此�?
 */
const FALLBACK_VERSION = 'v1.0.0';

/** 请求超时时间（毫秒） */
const REQUEST_TIMEOUT_MS = 10_000;

// ─── 核心逻辑 ─────────────────────────────────────────────────────────────────

/**
 * �?GitHub API 获取最�?Release 数据�?
 *
 * 📚 学习要点: fetch API �?Node.js 中的使用
 * - Node.js 18+ 内置全局 fetch（无需安装 node-fetch�?
 * - 使用 AbortController 实现请求超时，避免构建无限等�?
 * - GitHub API 要求 User-Agent header（否则返�?403�?
 *
 * @returns {Promise<object|null>} Release 数据对象，失败时返回 null
 */
async function fetchLatestRelease() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'arthas-website-build-script',
    };

    // 📚 学习要点: 利用环境变量中的 GitHub Token 提高 Rate Limit
    // CI 环境（GitHub Actions）自动注�?GITHUB_TOKEN
    // 本地开发时通常不需要（60 �?小时足够�?
    if (process.env.GITHUB_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const response = await fetch(GITHUB_API_URL, {
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`GitHub API responded with ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn(`⚠️  GitHub API request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    } else {
      console.warn(`⚠️  Failed to fetch release data: ${error.message}`);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * �?GitHub API 返回�?Release 数据转换为精简的站点数据格式�?
 *
 * 📚 学习要点: 数据转换层的意义
 * - GitHub API 返回大量字段（作者信息、Markdown body 等），页面只需要一小部�?
 * - 精简数据减少 JSON 文件体积，加快页面加�?
 * - 统一的数据结构让前端组件不依�?GitHub API 的具体格�?
 *
 * @param {object} release - GitHub API 返回�?Release 对象
 * @returns {object} 精简后的 Release 数据
 */
function transformReleaseData(release) {
  const assets = (release.assets || []).map((asset) => ({
    name: asset.name,
    url: asset.browser_download_url,
    size: asset.size,
  }));

  return {
    version: release.tag_name,
    assets,
    publishedAt: release.published_at,
    fallback: false,
  };
}

/**
 * 生成 fallback 数据 �?�?GitHub API 不可达时使用�?
 *
 * 📚 学习要点: 优雅降级（Graceful Degradation�?
 * - 构建不应因外�?API 不可达而失�?
 * - fallback 数据标记 `fallback: true`，前端可据此显示提示
 * - �?assets 数组意味着下载页面可以显示"请访�?GitHub Releases"的引�?
 *
 * @returns {object} Fallback Release 数据
 */
function getFallbackData() {
  return {
    version: FALLBACK_VERSION,
    assets: [],
    publishedAt: null,
    fallback: true,
  };
}

/**
 * 确保 src/data/ 目录存在�?
 * Astro 项目默认不包�?data 目录，首次运行时需要创建�?
 */
function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
    console.log(`   📁 Created directory: src/data/`);
  }
}

/**
 * 主函�?�?获取 Release 数据并写�?JSON 文件�?
 *
 * 流程�?
 * 1. 确保输出目录存在
 * 2. 尝试�?GitHub API 获取最�?Release
 * 3. 成功 �?转换并写入精简数据
 * 4. 失败 �?写入 fallback 数据 + 输出警告
 */
async function main() {
  console.log('🔄 Fetching latest release from GitHub...');

  ensureDataDir();

  const release = await fetchLatestRelease();

  let data;
  if (release) {
    data = transformReleaseData(release);
    console.log(`�?Release data fetched successfully!`);
    console.log(`   📦 Version: ${data.version}`);
    console.log(`   📎 Assets:  ${data.assets.length} files`);
    console.log(`   📅 Published: ${data.publishedAt}`);
  } else {
    data = getFallbackData();
    console.warn(`⚠️  Using fallback data (version: ${data.version})`);
    console.warn(`   The download page will show limited information.`);
    console.warn(`   This is expected during local development or when GitHub API is unreachable.`);
  }

  // 📚 学习要点: JSON.stringify 的第三个参数
  // 传入 2 表示缩进 2 个空格，生成人类可读�?JSON
  // 方便开发者检查生成的数据是否正确
  writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`   💾 Written to: src/data/release.json`);
}

// ─── 模块导出（供测试使用�?────────────────────────────────────────────────────
// 📚 学习要点: ESM 条件执行模式
// 通过比较 import.meta.url �?process.argv[1] 判断脚本是被直接执行还是�?import�?
// 直接执行时运�?main()，被 import 时仅导出函数供测试调用�?
// 这让同一个文件既是可执行脚本，又是可测试模块�?

export { fetchLatestRelease, transformReleaseData, getFallbackData, main };
export { GITHUB_API_URL, FALLBACK_VERSION, OUTPUT_FILE, DATA_DIR };

// 判断是否为直接执行（�?import�?
const isMainModule = process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  main().catch((error) => {
    console.error('�?Unexpected error in fetch-release script:', error);
    process.exit(1);
  });
}
