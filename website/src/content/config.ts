/**
 * Content Collection 配置 — 定义 Starlight 文档集合的 schema
 *
 * 📚 学习要点: Astro Content Collections
 * Astro 的 Content Collections 是一种类型安全的内容管理方式。
 * 每个 collection 定义一个 schema（使用 Zod），Astro 在 build 时
 * 验证所有内容文件是否符合 schema，并生成 TypeScript 类型。
 *
 * 📚 学习要点: Starlight 的 docsSchema
 * Starlight 导出 `docsSchema()` 函数，返回预定义的 Zod schema，
 * 包含 title、description、sidebar、tableOfContents 等字段。
 * 使用它确保文档 frontmatter 与 Starlight 的期望一致。
 *
 * 与其他模块的关系：
 * - Starlight 的 virtual-user-config 会 import 此文件获取 collections 定义
 * - sync-docs.mjs 生成的文档文件必须符合此 schema（至少包含 title）
 * - Starlight 的 autogenerate sidebar 依赖此 collection 发现文档页面
 */

import { defineCollection } from 'astro:content';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
  // 📚 学习要点: docs collection
  // 'docs' 是 Starlight 约定的 collection 名称，对应 src/content/docs/ 目录。
  // docsSchema() 提供 Starlight 所需的所有 frontmatter 字段定义，
  // 包括 title（必填）、description、sidebar、tableOfContents 等。
  docs: defineCollection({ schema: docsSchema() }),
};
