/**
 * 路线图数据类型定义 — roadmap.json 的 TypeScript 接口
 *
 * 本文件为路线图数据提供强类型约束，替代组件中的 `any` 类型。
 * 所有使用 roadmap.json 数据的组件应导入这些接口，
 * 确保数据访问的类型安全和 IDE 自动补全支持。
 *
 * 📚 学习要点: 数据驱动页面的类型安全
 * 静态站点中 JSON 数据在 build-time 被导入，TypeScript 接口确保：
 * - 编译时捕获字段名拼写错误（如 feature.nmae → 编译报错）
 * - IDE 提供自动补全，减少查阅 JSON 结构的认知负担
 * - 重构时（如重命名字段）编译器自动标记所有受影响的代码
 *
 * @see src/data/roadmap.json — 数据源
 * @see src/components/RoadmapContent.astro — 消费这些类型的组件
 */

/**
 * 路线图中的单个功能项。
 * 每个功能有中英文名称和完成状态。
 */
export interface RoadmapFeature {
  /** 功能中文名称 */
  name: string;
  /** 功能英文名称 */
  nameEn: string;
  /** 是否已完成 */
  done: boolean;
}

/**
 * 路线图中的一个开发阶段。
 * 每个阶段包含编号、名称、状态、进度百分比和功能列表。
 *
 * 📚 学习要点: Discriminated Union 状态类型
 * status 字段使用字面量联合类型 'completed' | 'in-progress' | 'planned'，
 * 而非宽泛的 string。这使得 TypeScript 能在 switch/if 中进行穷尽检查，
 * 确保所有状态分支都被处理（exhaustive check）。
 */
export interface RoadmapPhase {
  /** 阶段编号（1-based） */
  id: number;
  /** 阶段中文名称 */
  name: string;
  /** 阶段英文名称 */
  nameEn: string;
  /** 阶段状态 */
  status: 'completed' | 'in-progress' | 'planned';
  /** 完成百分比（0-100） */
  percentage: number;
  /** 该阶段包含的功能列表 */
  features: RoadmapFeature[];
}

/**
 * 路线图数据的顶层结构，对应 roadmap.json 的根对象。
 */
export interface RoadmapData {
  /** 所有开发阶段 */
  phases: RoadmapPhase[];
}
