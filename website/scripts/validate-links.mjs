/**
 * validate-links.mjs — 自动化内部链接验证脚本
 *
 * 📚 学习要点: 为什么需要链接验证？
 * - 静态站点生成器（如 Astro）在构建时不会验证 HTML 中的内部链接
 * - 页面重命名、删除或路径变更后，旧链接会变成 404
 * - CI 中运行此脚本可以在部署前捕获断链，避免用户看到 404 页面
 * - 使用纯 Node.js 内置模块（fs、path），无需额外依赖
 *
 * 职责：
 * - 递归扫描 dist/ 目录中的所有 HTML 文件
 * - 提取每个文件中的 href 和 src 属性值
 * - 对内部链接（以 /arthas/ 开头）验证目标文件是否存在
 * - 跳过外部链接（http://、https://、mailto: 等）和锚点链接（#）
 * - 输出验证报告，断链时以 exit code 1 退出
 *
 * 与其他模块的关系：
 * - package.json 中 "validate-links" script 调用本文件
 * - 可在 CI workflow 的 build 步骤后运行
 * - 与 check-links.mjs 功能类似但更完善（含统计、分类报告）
 *
 * 用法：node scripts/validate-links.mjs
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 📚 学习要点: ESM 中获取 __dirname
// ES Modules 没有 CommonJS 的 __dirname 全局变量。
// 通过 import.meta.url（当前模块的 file:// URL）推导出文件系统路径。
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** dist/ 目录的绝对路径 */
const DIST_DIR = resolve(__dirname, '..', 'dist');

/** 站点的 base path（对应 astro.config.mjs 中的 base 配置） */
const BASE_PATH = '/arthas/';

/**
 * 📚 学习要点: 正则提取 vs DOM 解析
 * - 完整的 HTML 解析需要引入 cheerio 或 jsdom 等依赖
 * - 对于链接验证这种简单场景，正则足够可靠
 * - 我们只关心 href="..." 和 src="..." 的值，不需要理解 DOM 结构
 * - 使用非贪婪匹配 [^"']* 避免跨属性匹配
 *
 * 匹配模式：
 * - href="value" 或 href='value'
 * - src="value" 或 src='value'
 * - 捕获组 1: 属性值（不含引号）
 */
const LINK_REGEX = /(?:href|src)=["']([^"']*?)["']/g;

/**
 * 判断一个链接是否应该跳过验证。
 *
 * 📚 学习要点: 哪些链接不需要验证？
 * - 外部链接（http/https）：需要网络请求，不适合离线验证
 * - 协议链接（mailto:、tel:、javascript:）：不指向文件
 * - 锚点链接（#section）：指向页面内部，不涉及文件解析
 * - 空链接：某些模板生成的占位符
 * - data: URI：内联数据，不是文件引用
 *
 * @param {string} link - 从 HTML 中提取的链接值
 * @returns {boolean} 是否应跳过此链接
 */
function shouldSkip(link) {
  if (!link || link.trim() === '') return true;
  if (link.startsWith('#')) return true;
  if (link.startsWith('http://') || link.startsWith('https://')) return true;
  if (link.startsWith('mailto:') || link.startsWith('tel:')) return true;
  if (link.startsWith('javascript:')) return true;
  if (link.startsWith('data:')) return true;
  return false;
}

/**
 * 判断一个链接是否为内部链接（以 base path 开头）。
 *
 * @param {string} link - 从 HTML 中提取的链接值
 * @returns {boolean} 是否为内部链接
 */
function isInternalLink(link) {
  return link.startsWith(BASE_PATH);
}

/**
 * 递归收集目录中所有 HTML 文件的路径。
 *
 * 📚 学习要点: 为什么用递归而非 glob？
 * - Node.js 内置 fs 没有 glob 支持（需要 glob 包或 Node 22+ 的 fs.glob）
 * - 递归遍历简单可靠，且 dist/ 目录通常不会太深
 * - 使用 withFileTypes 选项避免额外的 stat 调用（性能优化）
 *
 * @param {string} dir - 要扫描的目录路径
 * @returns {string[]} HTML 文件的绝对路径数组
 */
function collectHtmlFiles(dir) {
  let results = [];

  if (!existsSync(dir)) {
    return results;
  }

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
 * 将内部链接解析为 dist/ 中的文件系统路径，并验证是否存在。
 *
 * 📚 学习要点: 静态站点的 URL → 文件映射规则
 * Astro（和大多数 SSG）的 URL 到文件映射遵循以下规则：
 * 1. /arthas/foo/ → dist/foo/index.html（目录路由）
 * 2. /arthas/foo.css → dist/foo.css（静态资源直接映射）
 * 3. /arthas/foo → dist/foo/index.html 或 dist/foo（两种都可能）
 *
 * 还需要处理查询参数（?v=123）和锚点（#section）的剥离。
 *
 * @param {string} link - 以 /arthas/ 开头的内部链接
 * @returns {boolean} 链接目标是否存在于 dist/ 中
 */
function resolveInternalLink(link) {
  // 剥离查询参数和锚点（href="/arthas/foo/?v=1#bar" → "/arthas/foo/"）
  const cleanLink = link.split('?')[0].split('#')[0];

  // 将 /arthas/relative/path 转为 dist/ 下的相对路径
  const relativePath = cleanLink.replace(BASE_PATH, '');
  const localPath = join(DIST_DIR, relativePath);

  // 策略 1: 直接文件匹配（如 /arthas/_astro/style.css）
  if (existsSync(localPath) && statSync(localPath).isFile()) {
    return true;
  }

  // 策略 2: 目录匹配 — 检查 dir/index.html（如 /arthas/getting-started/）
  if (existsSync(localPath) && statSync(localPath).isDirectory()) {
    const indexPath = join(localPath, 'index.html');
    return existsSync(indexPath);
  }

  // 策略 3: 路径无扩展名 — 尝试 path/index.html（如 /arthas/getting-started）
  const withIndex = join(localPath, 'index.html');
  if (existsSync(withIndex)) {
    return true;
  }

  // 策略 4: 尝试添加 .html 扩展名（如 /arthas/404 → dist/404.html）
  const withHtml = localPath + '.html';
  if (existsSync(withHtml)) {
    return true;
  }

  return false;
}

/**
 * 从 HTML 内容中提取所有链接（href 和 src 属性值）。
 *
 * @param {string} htmlContent - HTML 文件的文本内容
 * @returns {string[]} 提取的链接数组（未去重）
 */
function extractLinks(htmlContent) {
  const links = [];
  let match;

  // 📚 学习要点: 重置 lastIndex
  // 使用带 /g 标志的正则时，exec() 会记住上次匹配位置（lastIndex）。
  // 如果在不同字符串上复用同一正则，需要重置 lastIndex 避免跳过匹配。
  LINK_REGEX.lastIndex = 0;

  while ((match = LINK_REGEX.exec(htmlContent)) !== null) {
    links.push(match[1]);
  }

  return links;
}

/**
 * 主函数：执行完整的链接验证流程。
 *
 * 流程：
 * 1. 检查 dist/ 目录是否存在
 * 2. 收集所有 HTML 文件
 * 3. 逐文件提取并验证内部链接
 * 4. 输出验证报告
 * 5. 根据结果设置退出码（0=通过，1=有断链）
 */
function main() {
  console.log('🔗 Arthas Website — Internal Link Validator');
  console.log('─'.repeat(50));

  // 前置检查：dist/ 目录必须存在
  if (!existsSync(DIST_DIR)) {
    console.error(`❌ dist/ directory not found: ${DIST_DIR}`);
    console.error('   Run "pnpm build" first to generate the static site.');
    process.exit(1);
  }

  // Step 1: 收集所有 HTML 文件
  const htmlFiles = collectHtmlFiles(DIST_DIR);

  if (htmlFiles.length === 0) {
    console.warn('⚠️  No HTML files found in dist/. Is the build output empty?');
    process.exit(1);
  }

  console.log(`📂 Scanning ${htmlFiles.length} HTML files in dist/\n`);

  // Step 2: 逐文件验证链接
  /** @type {{ file: string, link: string }[]} */
  const brokenLinks = [];
  let totalLinksChecked = 0;
  let skippedCount = 0;

  for (const filePath of htmlFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const links = extractLinks(content);

    // 用于去重：同一文件中相同链接只报告一次
    const seenInFile = new Set();

    for (const link of links) {
      // 跳过外部链接和特殊协议
      if (shouldSkip(link)) {
        skippedCount++;
        continue;
      }

      // 只验证内部链接（以 /arthas/ 开头）
      if (!isInternalLink(link)) {
        skippedCount++;
        continue;
      }

      // 同一文件中去重
      if (seenInFile.has(link)) {
        continue;
      }
      seenInFile.add(link);

      totalLinksChecked++;

      if (!resolveInternalLink(link)) {
        const relativeFile = filePath
          .replace(DIST_DIR, '')
          .replace(/^[/\\]/, '');
        brokenLinks.push({ file: relativeFile, link });
      }
    }
  }

  // Step 3: 输出验证报告
  console.log('─'.repeat(50));
  console.log(`📊 Validation Summary:`);
  console.log(`   HTML files scanned:    ${htmlFiles.length}`);
  console.log(`   Internal links checked: ${totalLinksChecked}`);
  console.log(`   External/skipped:       ${skippedCount}`);
  console.log(`   Broken links found:     ${brokenLinks.length}`);
  console.log('─'.repeat(50));

  if (brokenLinks.length === 0) {
    console.log('\n✅ All internal links are valid!');
    process.exit(0);
  } else {
    console.log(`\n❌ Found ${brokenLinks.length} broken internal link(s):\n`);
    for (const { file, link } of brokenLinks) {
      console.log(`   ${file}`);
      console.log(`     → ${link}`);
      console.log('');
    }
    process.exit(1);
  }
}

// 执行验证
main();
