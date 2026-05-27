/**
 * validate-build.mjs — 端到端构建验证脚本
 *
 * 📚 学习要点: 为什么需要构建验证？
 * - 静态站点构建管道包含多个步骤（fetch-release → sync-docs → astro build），
 *   任何一步失败都可能导致输出不完整但不报错
 * - 构建后验证确保所有预期页面都已生成，且包含必要的 SEO 元标签
 * - 验证 sitemap.xml 确保搜索引擎能发现所有页面
 * - 在 CI 中运行可以防止部署不完整的站点
 *
 * 职责：
 * - 检查 dist/ 中所有预期页面是否存在
 * - 验证每个 HTML 页面包含必要的 meta 标签（title、description、canonical、hreflang）
 * - 验证 sitemap.xml 存在且包含预期 URL
 * - 输出详细的 pass/fail 报告
 * - 全部通过时 exit 0，任何失败时 exit 1
 *
 * 与其他模块的关系：
 * - 在 `pnpm build` 之后运行（依赖 dist/ 输出）
 * - 与 validate-links.mjs 互补：本脚本验证页面存在性和 SEO 标签，
 *   validate-links.mjs 验证链接可达性
 * - package.json 中 "validate-build" script 调用本文件
 *
 * 用法：node scripts/validate-build.mjs
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 📚 学习要点: ESM 中获取 __dirname
// ES Modules 没有 CommonJS 的 __dirname 全局变量。
// 通过 import.meta.url（当前模块的 file:// URL）推导出文件系统路径。
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** dist/ 目录的绝对路径 */
const DIST_DIR = resolve(__dirname, '..', 'dist');

/**
 * 站点域名（对应 astro.config.mjs 中的 site 配置，不含 base path）。
 * sitemap 中的 URL 格式为: SITE_ORIGIN + BASE_PATH + page_path
 */
const SITE_ORIGIN = 'https://michaelwang123.github.io';

/** 站点 base path（对应 astro.config.mjs 中的 base 配置） */
const BASE_PATH = '/arthas';

// ─────────────────────────────────────────────────────────────────────────────
// 配置：预期页面和验证规则
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 📚 学习要点: 预期页面清单
 * 这些是构建必须生成的核心页面。如果任何一个缺失，说明构建管道有问题：
 * - 可能是 sync-docs 没有正确同步文档
 * - 可能是 Astro 路由配置有误
 * - 可能是 i18n 配置导致某个语言版本未生成
 *
 * 路径相对于 dist/ 目录，使用 POSIX 风格（/）以保持跨平台一致性。
 */
const EXPECTED_PAGES = [
  // 英文核心页面
  'index.html',
  '404.html',
  'download/index.html',
  'roadmap/index.html',

  // 中文核心页面
  'zh/index.html',
  'zh/download/index.html',
  'zh/roadmap/index.html',

  // 英文文档页面（至少验证 getting-started）
  'getting-started/index.html',

  // 中文文档页面
  'zh/getting-started/index.html',
];

/**
 * 📚 学习要点: SEO 必需的 meta 标签
 * 每个 HTML 页面必须包含以下标签才能被搜索引擎正确索引：
 * - <title>: 搜索结果中显示的页面标题
 * - <meta name="description">: 搜索结果中的摘要文字
 * - <link rel="canonical">: 告诉搜索引擎此页面的权威 URL（避免重复内容惩罚）
 * - <link rel="alternate" hreflang="...">: 告诉搜索引擎此页面的其他语言版本
 *   - hreflang="en": 英文版本
 *   - hreflang="zh" 或 "zh-CN": 中文版本（Starlight 使用 zh-CN）
 *   - hreflang="x-default": 默认版本（当用户语言不匹配任何版本时的回退）
 *
 * 📚 学习要点: Starlight vs 自定义页面的差异
 * - 自定义页面（index、download、roadmap）由我们完全控制 meta 标签
 * - Starlight 文档页面自动生成 canonical 和 hreflang，但不生成 description
 *   （除非在 frontmatter 中设置 description 字段）
 * - 我们将 description 和 x-default 标记为 "recommended"（警告但不失败）
 */
const REQUIRED_META_CHECKS = [
  {
    name: '<title> tag (non-empty)',
    regex: /<title>([^<]+)<\/title>/i,
    validate: (match) => match && match[1].trim().length > 0,
    severity: 'error',
  },
  {
    name: '<meta name="description"> (non-empty)',
    // 📚 学习要点: Starlight 文档页面不自动生成 description meta 标签
    // 需要在每个 .md 文件的 frontmatter 中手动添加 description 字段。
    // 标记为 warning 级别，不阻塞构建验证。
    regex: /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i,
    validate: (match) => match && match[1].trim().length > 0,
    severity: 'warning',
  },
  {
    name: '<link rel="canonical">',
    regex: /<link\s[^>]*rel=["']canonical["'][^>]*>/i,
    validate: (match) => !!match,
    severity: 'error',
  },
  {
    name: '<link rel="alternate" hreflang="en">',
    regex: /<link\s[^>]*hreflang=["']en["'][^>]*>/i,
    validate: (match) => !!match,
    severity: 'error',
  },
  {
    name: '<link rel="alternate" hreflang="zh(-CN)?">',
    // 📚 学习要点: hreflang 值的差异
    // 自定义页面使用 hreflang="zh"（我们控制的 Head 组件）
    // Starlight 文档页面使用 hreflang="zh-CN"（Starlight 根据 locales 配置生成）
    // 两者都是有效的 BCP 47 语言标签，搜索引擎都能识别。
    regex: /<link\s[^>]*hreflang=["']zh(?:-CN)?["'][^>]*>/i,
    validate: (match) => !!match,
    severity: 'error',
  },
  {
    name: '<link rel="alternate" hreflang="x-default">',
    // 📚 学习要点: x-default hreflang
    // x-default 告诉搜索引擎当用户语言不匹配任何版本时应该展示哪个页面。
    // Starlight 不自动生成此标签，只有自定义页面包含。
    // 标记为 warning 级别。
    regex: /<link\s[^>]*hreflang=["']x-default["'][^>]*>/i,
    validate: (match) => !!match,
    severity: 'warning',
  },
];


/**
 * sitemap.xml 中预期包含的完整 URL。
 * 这些是搜索引擎必须能发现的核心页面。
 *
 * 📚 学习要点: Sitemap 验证策略
 * 我们不验证 sitemap 中的每一个 URL（因为文档页面可能动态变化），
 * 而是验证核心页面一定存在。这样既保证了覆盖率，又不会因为
 * 新增/删除文档页面而导致验证失败。
 *
 * URL 格式遵循 @astrojs/sitemap 的输出：site + base + path（带尾部斜杠）
 */
const EXPECTED_SITEMAP_URLS = [
  'https://michaelwang123.github.io/arthas/',
  'https://michaelwang123.github.io/arthas/zh/',
  'https://michaelwang123.github.io/arthas/download/',
  'https://michaelwang123.github.io/arthas/zh/download/',
  'https://michaelwang123.github.io/arthas/roadmap/',
  'https://michaelwang123.github.io/arthas/zh/roadmap/',
  'https://michaelwang123.github.io/arthas/getting-started/',
  'https://michaelwang123.github.io/arthas/zh/getting-started/',
];

// ─────────────────────────────────────────────────────────────────────────────
// 验证函数
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 验证所有预期页面是否存在于 dist/ 目录中。
 *
 * @returns {{ passed: string[], failed: string[] }} 通过和失败的页面列表
 */
function validateExpectedPages() {
  const passed = [];
  const failed = [];

  for (const page of EXPECTED_PAGES) {
    // 📚 学习要点: 跨平台路径处理
    // EXPECTED_PAGES 使用 POSIX 风格的 /，join() 会自动转换为当前 OS 的分隔符。
    const fullPath = join(DIST_DIR, ...page.split('/'));

    if (existsSync(fullPath)) {
      passed.push(page);
    } else {
      failed.push(page);
    }
  }

  return { passed, failed };
}

/**
 * 验证单个 HTML 文件是否包含所有必需的 meta 标签。
 *
 * 📚 学习要点: 正则 vs DOM 解析的权衡
 * - 对于 meta 标签验证，正则足够可靠（meta 标签结构简单且标准化）
 * - 避免引入 jsdom/cheerio 等重依赖（项目原则：不引入新依赖）
 * - 缺点：无法处理跨行的标签（实际中 meta 标签几乎不会跨行）
 *
 * @param {string} filePath - HTML 文件的绝对路径
 * @param {string} content - HTML 文件内容
 * @returns {{ page: string, errors: string[], warnings: string[] }}
 */
function validateMetaTags(filePath, content) {
  const relativePath = filePath.replace(DIST_DIR, '').replace(/^[/\\]/, '').replace(/\\/g, '/');
  const errors = [];
  const warnings = [];

  for (const check of REQUIRED_META_CHECKS) {
    const match = content.match(check.regex);
    if (!check.validate(match)) {
      if (check.severity === 'error') {
        errors.push(check.name);
      } else {
        warnings.push(check.name);
      }
    }
  }

  return { page: relativePath, errors, warnings };
}

/**
 * 递归收集 dist/ 中所有 HTML 文件。
 *
 * @param {string} dir - 要扫描的目录
 * @returns {string[]} HTML 文件的绝对路径数组
 */
function collectHtmlFiles(dir) {
  let results = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(collectHtmlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * 验证所有 HTML 页面的 meta 标签。
 *
 * @returns {{ totalPages: number, pagesWithErrors: { page: string, errors: string[] }[], pagesWithWarnings: { page: string, warnings: string[] }[] }}
 */
function validateAllMetaTags() {
  const htmlFiles = collectHtmlFiles(DIST_DIR);
  const pagesWithErrors = [];
  const pagesWithWarnings = [];

  for (const filePath of htmlFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const result = validateMetaTags(filePath, content);

    if (result.errors.length > 0) {
      pagesWithErrors.push({ page: result.page, errors: result.errors });
    }
    if (result.warnings.length > 0) {
      pagesWithWarnings.push({ page: result.page, warnings: result.warnings });
    }
  }

  return { totalPages: htmlFiles.length, pagesWithErrors, pagesWithWarnings };
}

/**
 * 验证 sitemap.xml 存在且包含预期的 URL。
 *
 * 📚 学习要点: Sitemap 文件位置
 * @astrojs/sitemap 生成的 sitemap 可能是：
 * - dist/sitemap-index.xml（索引文件，指向多个 sitemap 分片）
 * - dist/sitemap-0.xml（实际的 URL 列表）
 * - dist/sitemap.xml（某些配置下的单文件输出）
 *
 * Astro sitemap 插件默认生成 sitemap-index.xml + sitemap-0.xml 的组合。
 * 我们需要检查实际包含 URL 的文件（sitemap-0.xml）。
 *
 * @returns {{ exists: boolean, missingUrls: string[], foundUrls: number }}
 */
function validateSitemap() {
  // 📚 学习要点: Astro sitemap 输出格式
  // @astrojs/sitemap 默认输出 sitemap-index.xml（索引）+ sitemap-0.xml（内容）。
  // sitemap-index.xml 只包含对 sitemap-0.xml 的引用，
  // 实际的 <url><loc>...</loc></url> 条目在 sitemap-0.xml 中。
  const sitemapPaths = [
    join(DIST_DIR, 'sitemap.xml'),
    join(DIST_DIR, 'sitemap-0.xml'),
    join(DIST_DIR, 'sitemap-index.xml'),
  ];

  // 找到包含实际 URL 的 sitemap 文件
  let sitemapContent = '';
  let sitemapFound = false;

  for (const sitemapPath of sitemapPaths) {
    if (existsSync(sitemapPath)) {
      const content = readFileSync(sitemapPath, 'utf-8');
      // 检查是否包含 <url> 标签（实际 URL 列表，而非索引文件）
      if (content.includes('<url>') || content.includes('<loc>')) {
        sitemapContent = content;
        sitemapFound = true;
        break;
      }
      // 如果是索引文件，也标记为找到（但继续找实际内容文件）
      if (content.includes('<sitemap>')) {
        sitemapFound = true;
      }
    }
  }

  if (!sitemapFound) {
    return { exists: false, missingUrls: EXPECTED_SITEMAP_URLS, foundUrls: 0 };
  }

  // 如果只找到索引文件但没有内容文件，尝试读取 sitemap-0.xml
  if (!sitemapContent) {
    const fallback = join(DIST_DIR, 'sitemap-0.xml');
    if (existsSync(fallback)) {
      sitemapContent = readFileSync(fallback, 'utf-8');
    }
  }

  // 提取所有 <loc> 中的 URL
  const locRegex = /<loc>([^<]+)<\/loc>/g;
  const foundUrls = [];
  let match;
  while ((match = locRegex.exec(sitemapContent)) !== null) {
    foundUrls.push(match[1]);
  }

  // 验证预期 URL 是否存在
  const missingUrls = [];
  for (const expectedUrl of EXPECTED_SITEMAP_URLS) {
    // 📚 学习要点: URL 匹配的灵活性
    // sitemap 中的 URL 可能带或不带尾部斜杠，
    // 所以我们同时检查两种形式。
    const withSlash = expectedUrl.endsWith('/') ? expectedUrl : expectedUrl + '/';
    const withoutSlash = expectedUrl.endsWith('/') ? expectedUrl.slice(0, -1) : expectedUrl;

    const found = foundUrls.some(
      (url) => url === withSlash || url === withoutSlash
    );

    if (!found) {
      missingUrls.push(expectedUrl);
    }
  }

  return { exists: true, missingUrls, foundUrls: foundUrls.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// 主函数
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 主函数：执行完整的构建验证流程。
 *
 * 流程：
 * 1. 检查 dist/ 目录是否存在
 * 2. 验证预期页面是否全部生成
 * 3. 验证所有 HTML 页面的 meta 标签
 * 4. 验证 sitemap.xml 内容
 * 5. 输出综合报告
 * 6. 根据结果设置退出码
 */
function main() {
  console.log('🏗️  Arthas Website — End-to-End Build Validation');
  console.log('═'.repeat(60));

  // 前置检查
  if (!existsSync(DIST_DIR)) {
    console.error('❌ dist/ directory not found.');
    console.error('   Run "pnpm build" first to generate the static site.');
    process.exit(1);
  }

  let hasFailures = false;

  // ─── Phase 1: 页面存在性验证 ───────────────────────────────────────────────
  console.log('\n📄 Phase 1: Expected Pages');
  console.log('─'.repeat(60));

  const pageResults = validateExpectedPages();

  for (const page of pageResults.passed) {
    console.log(`  ✅ ${page}`);
  }
  for (const page of pageResults.failed) {
    console.log(`  ❌ ${page} — MISSING`);
    hasFailures = true;
  }

  console.log(`\n  Result: ${pageResults.passed.length}/${EXPECTED_PAGES.length} pages found`);

  // ─── Phase 2: Meta 标签验证 ────────────────────────────────────────────────
  console.log('\n🏷️  Phase 2: Meta Tags Validation');
  console.log('─'.repeat(60));

  const metaResults = validateAllMetaTags();

  if (metaResults.pagesWithErrors.length === 0) {
    console.log(`  ✅ All ${metaResults.totalPages} pages pass required meta tag checks`);
  } else {
    hasFailures = true;
    console.log(`  ❌ ${metaResults.pagesWithErrors.length}/${metaResults.totalPages} pages missing required meta tags:\n`);

    for (const { page, errors } of metaResults.pagesWithErrors) {
      console.log(`  ❌ ${page}`);
      for (const tag of errors) {
        console.log(`     └─ missing: ${tag}`);
      }
    }
  }

  // 📚 学习要点: 警告 vs 错误的区分
  // 警告级别的缺失标签（description、x-default）不阻塞构建，
  // 但会在报告中提示，方便后续逐步完善 SEO。
  if (metaResults.pagesWithWarnings.length > 0) {
    console.log(`\n  ⚠️  ${metaResults.pagesWithWarnings.length} pages have recommended (non-blocking) meta tag gaps:`);
    for (const { page, warnings } of metaResults.pagesWithWarnings) {
      console.log(`     ${page}: ${warnings.join(', ')}`);
    }
  }

  // ─── Phase 3: Sitemap 验证 ─────────────────────────────────────────────────
  console.log('\n🗺️  Phase 3: Sitemap Validation');
  console.log('─'.repeat(60));

  const sitemapResults = validateSitemap();

  if (!sitemapResults.exists) {
    console.log('  ❌ sitemap.xml not found in dist/');
    hasFailures = true;
  } else {
    console.log(`  ✅ Sitemap found (${sitemapResults.foundUrls} URLs)`);

    if (sitemapResults.missingUrls.length === 0) {
      console.log(`  ✅ All ${EXPECTED_SITEMAP_URLS.length} expected URLs present`);
    } else {
      hasFailures = true;
      console.log(`  ❌ Missing ${sitemapResults.missingUrls.length} expected URL(s):`);
      for (const url of sitemapResults.missingUrls) {
        console.log(`     └─ ${url}`);
      }
    }
  }

  // ─── 综合报告 ──────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));

  if (hasFailures) {
    console.log('❌ BUILD VALIDATION FAILED — see issues above');
    process.exit(1);
  } else {
    console.log('✅ BUILD VALIDATION PASSED — all checks green');
    process.exit(0);
  }
}

// 执行验证
main();
