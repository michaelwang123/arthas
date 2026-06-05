# 网站动画改造计划

> 基于 `docs/beta/css-animation-guide.md` 的动效方案，将项目官网静态图表改造为动态可视化。
> 技术栈：Tailwind CSS + 自定义 @keyframes + SVG，无额外 JS 动画库。

---

## 改造清单

| 优先级 | 页面/组件 | 当前状态 | 目标动画效果 | 状态 |
|--------|-----------|----------|-------------|------|
| 🔴 高 | Hero 首页 | 静态文字 + 按钮 | 虚线流动（加密数据流）+ 脉冲发光（锁图标）+ 淡入上浮（文字依次出现）+ 粒子背景 | ✅ |
| 🔴 高 | "How it Works" 流程图 | 静态步骤 | 箭头脉冲动画 + IntersectionObserver 滚动揭示 + 交错入场 | ✅ |
| 🟡 中 | Architecture 图 | 静态 SVG | 虚线流动（WebSocket 连接线）+ 脉冲发光（Server 节点） | ✅ |
| 🟡 中 | Feature 卡片网格 | 静态网格 | 悬停卡片交互（上浮 + 边框高亮 + 阴影）+ 滚动揭示入场 | ✅ |
| 🟡 中 | Encryption Flow 图 | 静态 SVG | 移动粒子（密钥→加密→传输→解密）+ Shimmer 光线扫过 | 待定 |
| 🟢 低 | Self-hosting Tiers | 静态卡片 | 淡入上浮（三个方案卡片依次出现） | 待定 |
| 🟢 低 | Arthas Hub Flow 图 | 静态 SVG | 虚线流动 + 移动粒子（Creator → Hub → Visitor） | 待定 |

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
- [x] Hero 首页动画实现（淡入上浮 + Logo 脉冲发光 + SVG 虚线流动 + 粒子背景）
- [x] Feature 卡片悬停交互（上浮 + 阴影 + 边框高亮 + IntersectionObserver 滚动揭示）
- [x] How it Works 步骤动画（箭头脉冲 + 滚动揭示 + 交错入场）
- [x] Architecture 图动画（虚线流动 + Server 节点发光）— inline SVG 组件
- [ ] Encryption Flow 图动画（粒子流动 + Shimmer）— 需改为 inline SVG
- [ ] Self-hosting Tiers 淡入上浮 — 优先级低
