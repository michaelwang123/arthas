/**
 * generate-og-image.mjs — 将 SVG og:image 转换为 PNG 格式
 *
 * 📚 学习要点: 为什么需要 PNG 版本的 og:image？
 * - SVG 格式被 Twitter/X、Slack、Discord、LinkedIn 支持
 * - 但 Facebook 不支持 SVG 格式的 Open Graph 图片
 * - 生成 1200×630 PNG 确保所有社交平台都能正确显示预览图
 * - 使用 @resvg/resvg-js（Rust 编写的 SVG 渲染器），无需 Canvas 或系统字体依赖
 *
 * 用法：node scripts/generate-og-image.mjs
 * 输出：public/og-image.png
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const WEBSITE_ROOT = resolve(__dirname, '..');

const svgPath = resolve(WEBSITE_ROOT, 'public', 'og-image.svg');
const pngPath = resolve(WEBSITE_ROOT, 'public', 'og-image.png');

// 读取 SVG 文件
const svgContent = readFileSync(svgPath, 'utf-8');

// 📚 学习要点: resvg 渲染选项
// fitTo 指定输出尺寸，确保 PNG 为标准 OG 图片尺寸 1200×630
// font.defaultFontFamily 指定回退字体（SVG 中使用 system-ui）
const resvg = new Resvg(svgContent, {
  fitTo: {
    mode: 'width',
    value: 1200,
  },
  font: {
    defaultFontFamily: 'Arial',
  },
});

const pngData = resvg.render();
const pngBuffer = pngData.asPng();

writeFileSync(pngPath, pngBuffer);
console.log(`✅ Generated og-image.png (${(pngBuffer.length / 1024).toFixed(1)} KB)`);
