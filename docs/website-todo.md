# 网站动画改造计划

> 基于 `docs/beta/css-animation-guide.md` 的动效方案，将项目官网静态图表改造为动态可视化。
> 技术栈：Tailwind CSS + 自定义 @keyframes + SVG，无额外 JS 动画库。

---

## 改造清单

| 优先级 | 页面/组件 | 当前状态 | 目标动画效果 | 状态 |
|--------|-----------|----------|-------------|------|
| 🔴 高 | Hero 首页 | 静态文字 + 按钮 | 虚线流动（加密数据流）+ 脉冲发光（锁图标）+ 淡入上浮（文字依次出现）+ 粒子背景 | [ ] |
| 🔴 高 | "How it Works" 流程图 | 静态 SVG | 移动粒子（数据在节点间流动）+ 虚线流动（连接线） | [ ] |
| 🟡 中 | Architecture 图 | 静态 SVG | 虚线流动（WebSocket 连接线）+ 脉冲发光（Server 节点） | [ ] |
| 🟡 中 | Feature 卡片网格 | 静态网格 | 悬停卡片交互（上浮 + 边框高亮 + 渐变遮罩）+ 淡入上浮（首屏出现时） | [ ] |
| 🟡 中 | Encryption Flow 图 | 静态 SVG | 移动粒子（密钥→加密→传输→解密）+ Shimmer 光线扫过 | [ ] |
| 🟢 低 | Self-hosting Tiers | 静态卡片 | 淡入上浮（三个方案卡片依次出现） | [ ] |
| 🟢 低 | Arthas Hub Flow 图 | 静态 SVG | 虚线流动 + 移动粒子（Creator → Hub → Visitor） | [ ] |

---

## 实现规范

### 性能守则
- 只动画 `transform` 和 `opacity`（GPU 合成层，不触发重排）
- `box-shadow` 动画仅小面积元素
- 添加 `prefers-reduced-motion` 媒体查询支持
- 移动端可降级为无动画或减少动画

### 文件修改范围
- `website/src/components/Hero.astro` — 首页 Hero 区域
- `website/src/styles/global.css` — 自定义 @keyframes
- `website/src/pages/index.astro` — 首页其他区域
- `website/src/pages/zh/index.astro` — 中文首页

### 技术参考
- 动画方案详见：`docs/beta/css-animation-guide.md`
- 色彩系统：暗色主题，主色 indigo/emerald

---

## 进度追踪

- [x] 评估哪些页面适合动画（本文档）
- [ ] Hero 首页动画实现
- [ ] Feature 卡片悬停交互
- [ ] How it Works 流程图动画
- [ ] Architecture 图动画
- [ ] Encryption Flow 图动画
- [ ] 其他低优先级项目
