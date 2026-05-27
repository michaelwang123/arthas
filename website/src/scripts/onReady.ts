/**
 * onReady — 统一的客户端初始化工具
 *
 * 📚 学习要点: Astro 客户端脚本的初始化时机
 * Astro 页面有两种加载场景需要覆盖：
 * 1. 首次加载（传统导航）— DOMContentLoaded 或立即执行
 * 2. View Transitions 导航 — astro:page-load 事件
 * 
 * 本工具封装了这两种场景的事件绑定，避免每个组件重复相同的样板代码。
 * 使用 data-bound 属性防止重复绑定（View Transitions 可能多次触发）。
 *
 * @param fn - 初始化函数，在 DOM 就绪时执行
 * @param key - 唯一标识符，用于防止重复绑定（可选，默认使用函数名）
 */
export function onReady(fn: () => void): void {
  document.addEventListener('astro:page-load', fn);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn);
  } else {
    fn();
  }
}
