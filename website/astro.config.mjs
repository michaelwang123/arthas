/**
 * Astro + Starlight 配置文件
 *
 * 📚 学习要点: Astro 配置架构
 * - `site` + `base` 组合决定了最终部署 URL 和所有资源引用的前缀
 * - Starlight 集成提供开箱即用的文档功能（侧边栏、搜索、i18n、代码高亮）
 * - @astrojs/sitemap 在 build 时自动生成 sitemap.xml，帮助搜索引擎索引
 *
 * 部署目标: https://michaelwang123.github.io/arthas
 */
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';

// 📚 学习要点: 子目录部署
// GitHub Pages 项目站点部署在 username.github.io/repo-name 路径下，
// 必须设置 `base` 让 Astro 为所有资源和链接添加 /arthas/ 前缀。
// `site` 是完整的域名（不含 base path），Astro 内部会拼接 site + base。
export default defineConfig({
  site: 'https://michaelwang123.github.io',
  base: '/arthas',

  integrations: [
    // 📚 学习要点: Starlight 集成
    // Starlight 是 Astro 官方文档主题，提供：
    // - 自动侧边栏生成（autogenerate 模式从目录结构推断）
    // - 内置 Pagefind 全文搜索（零运行时依赖）
    // - i18n 路由（defaultLocale 无 URL 前缀，其他 locale 有前缀）
    // - 代码块语法高亮 + 复制按钮
    starlight({
      title: 'Arthas',
      // 📚 学习要点: 禁用 Starlight 内置 404 路由
      // Starlight 默认注入自己的 404 页面（使用文档布局）。
      // 由于我们有自定义的 src/pages/404.astro（使用 Landing 布局，双语展示），
      // 需要禁用 Starlight 的内置 404 路由以避免路由冲突警告。
      disable404Route: true,
      // 📚 学习要点: Starlight root locale 配置
      // 使用 'root' 作为默认语言的 key，让英文内容直接在根路径提供（无 /en/ 前缀）。
      // 如果使用 'en' 作为 key + defaultLocale: 'en'，Starlight 会生成 /en/ 前缀的链接，
      // 但实际内容在根路径，导致 site title 链接（/arthas/en）变成死链。
      // 'root' 告诉 Starlight：默认语言不需要 URL 前缀。
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        zh: { label: '中文', lang: 'zh-CN' },
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { slug: 'getting-started' },
            { slug: 'configuration' },
            { slug: 'self-hosting' },
          ],
        },
        {
          label: 'Architecture',
          items: [
            { slug: 'architecture' },
            { slug: 'protocol' },
            { slug: 'security' },
            { slug: 'development' },
          ],
        },
        {
          label: 'Tools',
          items: [
            { slug: 'cli-guide' },
          ],
        },
        {
          label: 'Integrations',
          translations: { 'zh-CN': '集成' },
          items: [
            { slug: 'openclaw-channel' },
          ],
        },
        {
          label: 'Community',
          translations: { 'zh-CN': '社区' },
          items: [
            { slug: 'faq' },
            { slug: 'contributing' },
          ],
        },
      ],
      // 📚 学习要点: Starlight head 注入
      // head 数组允许向所有 Starlight 文档页面注入自定义 <meta> 标签。
      // 这里注入 Open Graph 图片和 Twitter Card 标签，确保文档页面
      // 在社交平台分享时也能显示品牌预览图。
      // Landing.astro 布局的自定义页面（首页、下载页等）已单独处理这些标签，
      // 此处仅覆盖 Starlight 管理的文档页面。
      head: [
        {
          tag: 'meta',
          attrs: {
            property: 'og:image',
            content: 'https://michaelwang123.github.io/arthas/og-image.png',
          },
        },
        {
          tag: 'meta',
          attrs: {
            name: 'twitter:card',
            content: 'summary_large_image',
          },
        },
        {
          tag: 'meta',
          attrs: {
            name: 'twitter:image',
            content: 'https://michaelwang123.github.io/arthas/og-image.png',
          },
        },
      ],
      // 📚 学习要点: 自定义样式注入
      // customCss 数组中的文件会被注入到每个页面的 <head> 中，
      // 优先级高于 Starlight 默认样式，可以覆盖内置 CSS 变量。
      customCss: ['./src/styles/global.css'],
      // 📚 学习要点: 组件覆盖
      // Starlight 的 components 配置允许用自定义组件替换内置 UI 组件。
      // 将 ThemeSelect 替换为空组件，隐藏主题切换按钮，强制暗色模式。
      components: {
        ThemeSelect: './src/components/ThemeSelectOverride.astro',
      },
    }),

    // 📚 学习要点: Sitemap 集成
    // @astrojs/sitemap 在 build 时扫描所有生成的页面，
    // 输出 sitemap.xml 供搜索引擎爬虫发现站点结构。
    // 由于设置了 base: '/arthas'，sitemap 会自动输出到 /arthas/sitemap.xml。
    sitemap(),
  ],
});
