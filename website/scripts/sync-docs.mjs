/**
 * sync-docs.mjs — 文档同步脚本（跨平台，纯 Node.js）
 *
 * 📚 学习要点: 为什么用 Node.js 而非 bash 脚本？
 * - 开发者在 Windows 上工作，bash 脚本需要 Git Bash 或 WSL
 * - Node.js fs 模块在所有平台行为一致，无需 symlink（Windows symlink 需要管理员权限）
 * - 使用 ESM（.mjs）与 Astro 项目保持一致的模块风格
 *
 * 职责：
 * - 将 `official_doc/` 目录中的 Markdown 文件复制到 Starlight 内容目录
 * - 英文文档（*.en.md）→ src/content/docs/（去掉 .en 后缀）
 * - 中文文档（*.md，排除 *.en.md）→ src/content/docs/zh/
 * - 构建前运行，确保文档内容与源文件同步
 *
 * 与其他模块的关系：
 * - package.json 中 "sync-docs" script 调用本文件
 * - GitHub Actions workflow 在 build 前执行本脚本
 * - Starlight 的 autogenerate sidebar 从 src/content/docs/ 读取内容
 *
 * 用法：node scripts/sync-docs.mjs
 */

import { existsSync, readdirSync, copyFileSync, mkdirSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 📚 学习要点: ESM 中获取 __dirname
// ESM 模块没有 __dirname 全局变量，需要从 import.meta.url 推导。
// fileURLToPath 将 file:// URL 转为平台路径（Windows 上处理盘符）。
const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

// 路径配置（相对于 website/ 目录）
const WEBSITE_ROOT = resolve(__dirname, '..');
const DOCS_SRC = resolve(WEBSITE_ROOT, '..', 'official_doc');
const DOCS_DEST_EN = resolve(WEBSITE_ROOT, 'src', 'content', 'docs');
const DOCS_DEST_ZH = resolve(WEBSITE_ROOT, 'src', 'content', 'docs', 'zh');

/**
 * 清理目标目录，移除旧的同步内容。
 * 只删除 .md 文件，保留可能存在的其他配置文件（如 index.mdx）。
 *
 * 📚 学习要点: 为什么要先清理？
 * - 如果源文件被删除或重命名，旧的目标文件不应残留
 * - rmSync recursive 可以安全删除 zh/ 子目录（即使为空）
 * - 使用 force: true 避免目录不存在时抛错
 *
 * @param {string} dir - 要清理的目录路径
 * @param {boolean} removeDir - 是否删除整个目录（用于 zh/ 子目录）
 */
function cleanDestination(dir, removeDir = false) {
  if (!existsSync(dir)) return;

  if (removeDir) {
    rmSync(dir, { recursive: true, force: true });
    return;
  }

  // 只删除 .md 文件，保留目录结构和非 .md 文件
  const files = readdirSync(dir);
  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (stat.isFile() && file.endsWith('.md')) {
      rmSync(filePath);
    }
  }
}

/**
 * 确保目录存在，如果不存在则递归创建。
 *
 * @param {string} dir - 要创建的目录路径
 */
function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * 从 Markdown 内容中提取第一个 H1 标题作为页面标题。
 *
 * 📚 学习要点: Starlight frontmatter 要求
 * Starlight 的 docs content collection schema 要求每个文档必须有 `title` 字段。
 * 源文档（official_doc/）没有 frontmatter，所以我们在同步时自动注入。
 * 标题从文件的第一个 `# ` 行提取，如果没有 H1 则使用文件名作为 fallback。
 *
 * @param {string} content - Markdown 文件内容
 * @param {string} filename - 文件名（用作 fallback 标题）
 * @returns {string} 提取的标题
 */
function extractTitle(content, filename) {
  // 匹配第一个 H1 标题（# 开头的行）
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }
  // Fallback: 从文件名生成标题（去掉扩展名，将连字符转为空格，首字母大写）
  return filename
    .replace(/\.md$/, '')
    .replace(/\.(en|zh)$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * 从 Markdown 内容中提取描述文本（用于 SEO meta description）。
 *
 * 📚 学习要点: SEO meta description 的作用
 * Starlight 会将 frontmatter 中的 description 字段渲染为 <meta name="description">。
 * 搜索引擎在搜索结果中显示此描述，影响点击率（CTR）。
 * 最佳长度为 50-160 字符，我们截取前 155 字符并加省略号。
 *
 * 提取策略：跳过标题、空行、代码块和 frontmatter 分隔符，
 * 取第一个长度 > 20 字符的正文段落作为描述。
 *
 * @param {string} content - Markdown 文件内容
 * @returns {string} 提取的描述文本（可能为空字符串）
 */
function extractDescription(content) {
  // Skip lines that are headings, empty, or code blocks
  const lines = content.split('\n');
  let inCodeBlock = false;
  for (const line of lines) {
    if (line.startsWith('```')) { inCodeBlock = !inCodeBlock; continue; }
    if (inCodeBlock) continue;
    if (line.startsWith('#')) continue;
    if (line.startsWith('---')) continue;
    const trimmed = line.trim();
    // Skip lines that are primarily Markdown links (e.g., language switcher lines)
    if (trimmed.startsWith('[') && trimmed.includes('](')) continue;
    if (trimmed.length > 20) {
      // Return first 155 chars + ellipsis if longer
      return trimmed.length > 155 ? trimmed.slice(0, 155) + '...' : trimmed;
    }
  }
  return '';
}

/**
 * 为 Markdown 内容注入 Starlight 兼容的 YAML frontmatter。
 *
 * 📚 学习要点: 为什么需要注入 frontmatter？
 * - Starlight 的 docs schema 要求 `title` 字段（z.string()，非 optional）
 * - 没有 frontmatter 的文档会导致 content collection 验证失败
 * - 注入 frontmatter 让源文档保持干净（无需修改 official_doc/ 中的文件）
 * - 同时设置 `sidebar.label` 确保侧边栏显示正确的标题
 * - description 字段让 Starlight 生成 <meta name="description">（SEO 优化）
 *
 * 📚 学习要点: 为什么要移除原始 H1？
 * - Starlight 会自动将 frontmatter title 渲染为页面 <h1>
 * - 如果 Markdown 正文中保留原始 # 标题，页面会出现两个 h1（重复标题）
 * - 同时移除紧跟 H1 后面与 description 重复的段落，避免内容冗余
 *
 * @param {string} content - 原始 Markdown 内容
 * @param {string} filename - 文件名
 * @returns {string} 带有 frontmatter 的 Markdown 内容（已移除原始 H1）
 */
function injectFrontmatter(content, filename) {
  // 如果文件已有 frontmatter（以 --- 开头），不重复注入
  if (content.trimStart().startsWith('---')) {
    return content;
  }

  const title = extractTitle(content, filename);
  const description = extractDescription(content);

  // 移除原始 H1 标题行及其后紧跟的重复描述段落
  // Starlight 会从 frontmatter title 自动生成 <h1>，保留原始 H1 会导致标题重复
  let processedContent = content;
  const h1Regex = /^#\s+.+\n*/m;
  const h1Match = processedContent.match(h1Regex);
  if (h1Match) {
    // 移除 H1 行
    processedContent = processedContent.replace(h1Regex, '');
    // 如果 H1 后面紧跟的段落与 description 相同（或非常相似），也移除它
    if (description) {
      const lines = processedContent.split('\n');
      // 跳过开头的空行，找到第一个非空行
      let firstContentIdx = 0;
      while (firstContentIdx < lines.length && lines[firstContentIdx].trim() === '') {
        firstContentIdx++;
      }
      if (firstContentIdx < lines.length) {
        const firstLine = lines[firstContentIdx].trim();
        // 如果第一个非空行与 description 开头匹配（description 可能被截断了）
        if (firstLine && description.startsWith(firstLine.slice(0, 50))) {
          // 移除该行和后面的空行
          lines.splice(firstContentIdx, 1);
          // 移除多余的空行（最多保留一个）
          while (firstContentIdx < lines.length && lines[firstContentIdx].trim() === '') {
            lines.splice(firstContentIdx, 1);
          }
          processedContent = lines.join('\n');
        }
      }
    }
  }

  // 转义 YAML 中的特殊字符（引号、冒号等）
  const safeTitle = title.includes(':') || title.includes('"') || title.includes("'")
    ? `"${title.replace(/"/g, '\\"')}"`
    : `"${title}"`;

  const descLine = description ? `description: "${description.replace(/"/g, '\\"')}"\n` : '';
  const frontmatter = `---\ntitle: ${safeTitle}\n${descLine}---\n\n`;
  return frontmatter + processedContent;
}

/**
 * 移除 Markdown 内容中的语言切换行。
 *
 * 📚 学习要点: 为什么要移除语言切换行？
 * - 源文档（official_doc/）中包含手动的语言切换链接（如 `[中文](xxx) | English`）
 * - Starlight 已内置语言切换器（页面头部的 "Select language" 下拉菜单）
 * - 保留手动链接会导致页面顶部出现冗余的语言切换文本，显得不专业
 * - 移除后让 Starlight 统一管理语言切换体验
 *
 * 匹配模式：以 `[` 开头、包含 Markdown 链接语法、且含有 `|` 分隔符的行
 * 例如：`[中文](getting-started.md) | English`
 *       `[中文](/arthas/zh/architecture/) | English`
 *
 * @param {string} content - Markdown 文件内容
 * @returns {string} 移除语言切换行后的内容
 */
function stripLanguageSwitcher(content) {
  // 匹配语言切换行：以 [ 开头，包含 ](...)，且有 | 分隔符
  // 同时移除该行后面的空行（避免留下多余空白）
  // 使用 \r?\n 兼容 Windows (CRLF) 和 Unix (LF) 换行符
  return content.replace(/^\[.+\]\(.+\)\s*\|.+\r?\n(\r?\n)?/m, '');
}

/**
 * 复制文件并注入 Starlight frontmatter。
 *
 * @param {string} srcPath - 源文件路径
 * @param {string} destPath - 目标文件路径
 * @param {string} filename - 文件名（用于标题提取）
 * @param {string} locale - 目标语言（'en' 或 'zh'），用于链接转换
 */
function copyWithFrontmatter(srcPath, destPath, filename, locale = 'en') {
  const content = readFileSync(srcPath, 'utf-8');
  const withoutSwitcher = stripLanguageSwitcher(content);
  const withLinks = transformInternalLinks(withoutSwitcher, locale);
  const withLangs = normalizeCodeBlockLanguages(withLinks);
  const processed = injectFrontmatter(withLangs, filename);
  writeFileSync(destPath, processed, 'utf-8');
}

/**
 * 规范化代码块语言标识符，将非标准语言映射为 Shiki 支持的语言。
 *
 * 📚 学习要点: Shiki 语言支持
 * Starlight 使用 Shiki（通过 expressive-code）进行语法高亮。
 * Shiki 支持大量语言，但 `env` 不在其中。
 * 将 `env` 映射为 `ini` 可以获得 key=value 格式的基本高亮。
 *
 * @param {string} content - Markdown 内容
 * @returns {string} 规范化后的内容
 */
function normalizeCodeBlockLanguages(content) {
  // 将 ```env 替换为 ```ini（key=value 格式兼容）
  return content.replace(/^```env\s*$/gm, '```ini');
}

/**
 * 转换 Markdown 内部链接为 Starlight 兼容的路由路径。
 *
 * 📚 学习要点: 为什么需要转换链接？
 * - 源文档使用相对 Markdown 链接（如 `[text](architecture.en.md)`）
 * - Starlight 将每个 .md 文件渲染为 /slug/ 路径（如 /architecture/）
 * - 英文文档的 .en.md 后缀在同步时被去掉，链接也需要相应调整
 * - 中文文档链接到其他中文文档时，需要保持在 zh/ 路径下
 *
 * 转换规则：
 * - `foo.en.md` → `/arthas/foo/`（英文文档链接）
 * - `foo.md`（在英文文档中）→ `/arthas/zh/foo/`（指向中文版）
 * - `foo.md`（在中文文档中）→ `/arthas/zh/foo/`（指向同语言文档）
 *
 * @param {string} content - Markdown 内容
 * @param {string} locale - 当前文档的语言
 * @returns {string} 转换后的内容
 */
function transformInternalLinks(content, locale) {
  // 匹配 Markdown 链接中的 .md 引用: [text](filename.md) 或 [text](filename.en.md)
  // 不匹配外部链接（http:// 或 https://）和锚点链接（#）
  return content.replace(
    /\[([^\]]*)\]\((?!https?:\/\/|#)([^)]+\.(?:en\.)?md)\)/g,
    (match, text, href) => {
      // 去掉 .en.md 或 .md 后缀，得到 slug
      const slug = href
        .replace(/\.en\.md$/, '')
        .replace(/\.md$/, '');

      if (href.endsWith('.en.md')) {
        // 链接指向英文文档 → 使用英文路径（无语言前缀）
        return `[${text}](/arthas/${slug}/)`;
      } else {
        // 链接指向中文文档
        if (locale === 'en') {
          // 英文文档中链接到中文版 → 加 zh/ 前缀
          return `[${text}](/arthas/zh/${slug}/)`;
        } else {
          // 中文文档中链接到其他中文文档 → 加 zh/ 前缀
          return `[${text}](/arthas/zh/${slug}/)`;
        }
      }
    }
  );
}

/**
 * 执行文档同步：从 official_doc/ 复制到 Starlight content 目录。
 *
 * 📚 学习要点: Starlight 内容集合约束
 * - Astro content collections 要求内容位于 src/ 目录内
 * - Starlight 的 autogenerate sidebar 从目录结构推断导航
 * - defaultLocale='en' 意味着英文文档放在 docs/ 根目录（无语言前缀）
 * - 其他语言放在对应子目录（如 docs/zh/）
 *
 * 文件命名约定：
 * - official_doc/foo.en.md → src/content/docs/foo.md（英文）
 * - official_doc/foo.md → src/content/docs/zh/foo.md（中文）
 */
function syncDocs() {
  // 验证源目录存在
  if (!existsSync(DOCS_SRC)) {
    console.error(`❌ Source directory not found: ${DOCS_SRC}`);
    console.error('   Make sure official_doc/ exists at the repository root.');
    process.exit(1);
  }

  // Step 1: 清理旧内容
  cleanDestination(DOCS_DEST_ZH, true); // 完全删除 zh/ 目录
  cleanDestination(DOCS_DEST_EN, false); // 只删除英文 .md 文件

  // Step 2: 创建目标目录
  ensureDir(DOCS_DEST_EN);
  ensureDir(DOCS_DEST_ZH);

  // Step 3: 读取源目录中的所有文件
  const allFiles = readdirSync(DOCS_SRC).filter((file) => {
    const filePath = join(DOCS_SRC, file);
    return statSync(filePath).isFile() && file.endsWith('.md');
  });

  let enCount = 0;
  let zhCount = 0;

  // Step 4: 分类并复制文件（注入 Starlight frontmatter）
  for (const file of allFiles) {
    const srcPath = join(DOCS_SRC, file);

    if (file.endsWith('.en.md')) {
      // 英文文档：去掉 .en 后缀
      // 例如 "getting-started.en.md" → "getting-started.md"
      const targetName = file.replace(/\.en\.md$/, '.md');
      const destPath = join(DOCS_DEST_EN, targetName);
      copyWithFrontmatter(srcPath, destPath, targetName, 'en');
      enCount++;
    } else {
      // 📚 学习要点: 排除 index.md 避免路由冲突
      // Starlight 会将 docs/zh/index.md 渲染为 /arthas/zh/ 路由，
      // 但 src/pages/zh/index.astro 已经占用了该路由（自定义中文首页）。
      // 两者冲突会导致构建失败，因此跳过 index.md 的同步。
      if (file === 'index.md') {
        console.log(`   ⏭️  Skipped: ${file} (conflicts with custom zh/index.astro page)`);
        continue;
      }
      // 中文文档：保持原文件名
      // 例如 "getting-started.md" → "zh/getting-started.md"
      const destPath = join(DOCS_DEST_ZH, file);
      copyWithFrontmatter(srcPath, destPath, file, 'zh');
      zhCount++;
    }
  }

  // Step 5: 输出同步摘要
  console.log(`✅ Docs synced successfully!`);
  console.log(`   📄 English: ${enCount} files → src/content/docs/`);
  console.log(`   📄 Chinese: ${zhCount} files → src/content/docs/zh/`);
  console.log(`   📁 Source:  ${DOCS_SRC}`);
}

// 执行同步
syncDocs();
