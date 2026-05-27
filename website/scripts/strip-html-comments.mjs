/**
 * strip-html-comments.mjs — 从生产 HTML 中移除注释
 *
 * 📚 学习要点: 为什么在 postbuild 阶段移除注释？
 * - 源码中的 HTML 注释（📚 学习要点等）对开发者有教育价值，应保留在源文件中
 * - 但生产输出中这些注释增加传输体积（约 5-10KB/页面），且暴露内部文档
 * - Astro 的 compressHTML 选项与 Starlight 集成不兼容
 * - 因此使用 postbuild 脚本直接处理 dist/ 中的 HTML 文件
 *
 * 注意：不移除条件注释（<!--[if ...]>）和 IE 兼容注释，仅移除普通注释。
 *
 * 用法：node scripts/strip-html-comments.mjs
 * 时机：在 astro build 完成后执行
 */

import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const DIST_DIR = resolve(__dirname, '..', 'dist');

/**
 * 递归查找目录中所有 HTML 文件。
 *
 * @param {string} dir - 要搜索的目录
 * @returns {string[]} HTML 文件路径数组
 */
function findHtmlFiles(dir) {
  const results = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      results.push(...findHtmlFiles(fullPath));
    } else if (entry.endsWith('.html')) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * 移除 HTML 内容中的注释。
 *
 * 📚 学习要点: 正则匹配 HTML 注释的注意事项
 * - HTML 注释格式：<!-- ... -->
 * - 使用非贪婪匹配 ([\s\S]*?) 避免跨注释匹配
 * - 保留条件注释 <!--[if 和 <![endif]-->（IE 兼容性，虽然本项目不需要）
 * - 不处理 <script> 和 <style> 标签内的 JS/CSS 注释（它们不是 HTML 注释）
 *
 * @param {string} html - HTML 内容
 * @returns {string} 移除注释后的内容
 */
function stripComments(html) {
  // 匹配 HTML 注释，但排除条件注释 <!--[if
  return html.replace(/<!--(?!\[if\s)[\s\S]*?-->/g, '');
}

// 执行
const htmlFiles = findHtmlFiles(DIST_DIR);
let totalSaved = 0;

for (const file of htmlFiles) {
  const original = readFileSync(file, 'utf-8');
  const stripped = stripComments(original);
  const saved = original.length - stripped.length;

  if (saved > 0) {
    writeFileSync(file, stripped, 'utf-8');
    totalSaved += saved;
  }
}

console.log(`✅ Stripped HTML comments from ${htmlFiles.length} files`);
console.log(`   💾 Saved ${(totalSaved / 1024).toFixed(1)} KB total`);
