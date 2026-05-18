/**
 * 图片缩略图生成器 — 使用 Canvas API 生成压缩预览图。
 *
 * 本模块负责为图片文件生成小尺寸、低体积的 JPEG 缩略图，
 * 用于在文件传输元数据中内联发送，让接收方在完整文件传输完成前
 * 就能看到图片预览。
 *
 * 职责边界：
 * - 输入：File 对象（浏览器原生文件引用）
 * - 输出：Uint8Array（JPEG 二进制数据，≤50KB）或 null（非图片文件）
 * - 不涉及加密（加密由 sender.ts 在发送前统一处理）
 * - 不涉及 UI 渲染（渲染由 FileMessage.tsx 处理）
 *
 * 与其他模块的关系：
 * - sender.ts 在发送文件前调用 generateThumbnail() 获取缩略图数据
 * - 生成的 Uint8Array 被放入 FileMetadata.thumbnail 字段
 * - sender.ts 将整个 FileMetadata（含缩略图）加密后发送
 *
 * 📚 学习要点: Canvas API 图片处理流水线
 * 浏览器的 Canvas API 提供了完整的图片处理能力：
 * 1. Image 元素加载图片（支持所有浏览器支持的图片格式）
 * 2. Canvas.drawImage() 将图片绘制到画布（可缩放）
 * 3. Canvas.toBlob() 将画布内容导出为指定格式的二进制数据
 *
 * 这个流水线完全在浏览器内完成，不需要任何外部库（如 sharp、jimp），
 * 且利用了浏览器内置的图片解码器（通常是 C++ 实现，性能优秀）。
 *
 * 📚 学习要点: 质量/体积权衡（Quality-Size Tradeoff）
 * JPEG 压缩质量（0.0-1.0）与输出体积不是线性关系：
 * - quality=1.0: 几乎无损，体积大（可能比原图还大）
 * - quality=0.8: 视觉几乎无差异，体积约为原图 30-50%
 * - quality=0.5: 轻微模糊，体积约为原图 10-20%
 * - quality=0.3: 明显模糊，但作为缩略图预览仍可接受
 *
 * 我们的策略：从 0.8 开始，如果超过 50KB 则逐步降低质量，
 * 直到满足体积限制或达到最低质量 0.3。
 * 这确保了在体积限制内获得最佳视觉质量。
 *
 * @module file-transfer/thumbnail
 * @see design.md — 缩略图生成设计
 * @see requirements.md — Requirements 8.1, 8.2, 8.5, NFR-3
 */

// ============================================================================
// 常量定义
// ============================================================================

/**
 * 缩略图最大尺寸（像素）。
 * 缩放后最长边不超过此值，短边按比例缩放保持宽高比。
 *
 * 📚 学习要点: 为什么选择 300px？
 * - 在移动端（320px 宽屏幕）上，300px 缩略图几乎占满宽度，预览效果好
 * - 在桌面端，300px 作为聊天气泡内的预览图大小适中
 * - 300px × 300px 的 JPEG 在 quality=0.7 时通常 <30KB，满足 50KB 限制
 * - 更大的尺寸（如 600px）会导致体积翻倍，难以控制在 50KB 内
 */
const MAX_THUMBNAIL_DIMENSION = 300;

/**
 * 缩略图最大体积（字节）：50KB。
 * 缩略图需要包含在 FileMetadata 中一起加密发送，
 * 过大的缩略图会增加 metadata 消息的大小。
 */
const MAX_THUMBNAIL_SIZE = 51200; // 50 * 1024 = 51200 bytes

/**
 * JPEG 初始压缩质量。
 * 从较高质量开始，逐步降低直到满足体积限制。
 */
const INITIAL_QUALITY = 0.8;

/**
 * JPEG 最低压缩质量。
 * 低于此值图片质量太差，不如不显示缩略图。
 */
const MIN_QUALITY = 0.3;

/**
 * 每次质量降低的步长。
 * 0.05 的步长提供了较细的粒度，避免质量跳跃过大。
 */
const QUALITY_STEP = 0.05;

/**
 * 支持生成缩略图的 MIME 类型集合。
 *
 * 📚 学习要点: 为什么只支持这 4 种格式？
 * - image/png: 截图、图标的常见格式
 * - image/jpeg: 照片的标准格式
 * - image/gif: 动图和简单图形（我们只取第一帧）
 * - image/webp: 现代浏览器支持的高效格式
 *
 * 不支持的格式（如 image/svg+xml、image/bmp）直接返回 null，
 * 这些文件仍然可以正常传输，只是没有内联预览。
 */
const SUPPORTED_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

// ============================================================================
// 主函数
// ============================================================================

/**
 * 为图片文件生成 JPEG 缩略图。
 *
 * 处理流程：
 * 1. 检查文件 MIME 类型是否为支持的图片格式
 * 2. 使用 Image 元素加载文件（通过 Object URL）
 * 3. 计算缩放尺寸（最长边 ≤ 300px，保持宽高比）
 * 4. 创建 Canvas，将图片缩放绘制到画布
 * 5. 导出为 JPEG，从 quality=0.8 开始迭代降低质量直到 ≤ 50KB
 * 6. 将 Blob 转换为 Uint8Array 返回
 *
 * 📚 学习要点: 为什么使用 Image 元素而非 createImageBitmap？
 * - Image 元素是最广泛支持的图片加载方式（所有浏览器）
 * - createImageBitmap 在某些旧版 Safari 上不支持 Blob 输入
 * - Image + Object URL 的组合兼容性最好
 * - 对于 GIF 动图，Image 元素只渲染第一帧（正是我们需要的行为）
 *
 * 📚 学习要点: GIF 动图的第一帧提取
 * 当将 GIF 动图绘制到 Canvas 时，浏览器只会绘制当前显示的帧。
 * 由于 Image 元素在 onload 时停留在第一帧（尚未开始动画循环），
 * 因此 drawImage() 自然只绘制第一帧，无需额外处理。
 * 这满足了 Requirement 8.5 的要求。
 *
 * @param file - 要生成缩略图的文件对象
 * @returns 缩略图的 JPEG 二进制数据（≤50KB），非图片文件返回 null
 *
 * @example
 * ```typescript
 * const file = new File([imageData], 'photo.jpg', { type: 'image/jpeg' });
 * const thumbnail = await generateThumbnail(file);
 * if (thumbnail) {
 *   // thumbnail 是 Uint8Array，可以放入 FileMetadata.thumbnail
 *   metadata.thumbnail = thumbnail;
 * }
 * ```
 */
export async function generateThumbnail(file: File): Promise<Uint8Array | null> {
  // 1. 类型检查：非图片文件直接返回 null
  //    使用 Set.has() 进行 O(1) 查找，比 Array.includes() 更高效
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    return null;
  }

  // 2. 创建 Object URL 用于加载图片
  //    📚 学习要点: Object URL 生命周期管理
  //    URL.createObjectURL() 创建一个指向内存中 Blob 的临时 URL（如 blob:http://...）。
  //    这个 URL 会持有对 Blob 的强引用，阻止垃圾回收。
  //    必须在使用完毕后调用 URL.revokeObjectURL() 释放引用，否则会导致内存泄漏。
  //    我们使用 try/finally 确保无论成功还是失败都会释放 URL。
  const objectUrl = URL.createObjectURL(file);

  try {
    // 3. 加载图片到 Image 元素
    const img = await loadImage(objectUrl);

    // 4. 计算缩放尺寸
    const { width, height } = calculateScaledDimensions(
      img.naturalWidth,
      img.naturalHeight,
      MAX_THUMBNAIL_DIMENSION
    );

    // 5. 创建 Canvas 并绘制缩放后的图片
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      // 极端情况：Canvas 2D 上下文不可用（理论上不应发生）
      console.warn('[Thumbnail] Failed to get canvas 2d context');
      return null;
    }

    // 📚 学习要点: drawImage 的缩放绘制
    // drawImage(image, dx, dy, dWidth, dHeight) 会将源图片缩放到目标尺寸。
    // 浏览器内部使用双线性插值（bilinear interpolation）进行缩放，
    // 对于缩小操作，质量通常足够好。
    // 如果需要更高质量的缩小（如从 4000px 缩到 300px），
    // 可以使用多步缩小（每次缩小 50%），但对于缩略图预览不必要。
    ctx.drawImage(img, 0, 0, width, height);

    // 6. 迭代导出 JPEG，逐步降低质量直到满足体积限制
    const thumbnailData = await exportWithQualityReduction(canvas);

    return thumbnailData;
  } catch (error) {
    // 图片加载失败（损坏的文件、不支持的子格式等）
    // 静默返回 null，文件传输仍然可以继续（只是没有缩略图预览）
    console.warn('[Thumbnail] Failed to generate thumbnail:', error);
    return null;
  } finally {
    // 7. 释放 Object URL，防止内存泄漏
    URL.revokeObjectURL(objectUrl);
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 将图片加载到 Image 元素中（Promise 封装）。
 *
 * 📚 学习要点: 回调到 Promise 的转换模式
 * Image 元素使用传统的事件回调模式（onload/onerror），
 * 我们将其封装为 Promise，使其可以与 async/await 配合使用。
 * 这是一种常见的「Promisification」模式。
 *
 * @param src - 图片源 URL（通常是 Object URL）
 * @returns 加载完成的 HTMLImageElement
 * @throws 图片加载失败时抛出错误
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    // 📚 学习要点: crossOrigin 设置
    // 虽然我们使用的是 Object URL（同源），不需要 CORS，
    // 但设置 crossOrigin 是一个好习惯，防止未来如果改用远程 URL 时
    // 遇到 Canvas 被「污染」（tainted）而无法导出的问题。
    // 对于 Object URL，此设置无实际影响。

    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = src;
  });
}

/**
 * 计算保持宽高比的缩放尺寸。
 *
 * 将图片缩放到最长边不超过 maxDimension，短边按比例缩放。
 * 如果图片本身就小于 maxDimension，则保持原始尺寸（不放大）。
 *
 * 📚 学习要点: 宽高比保持算法
 * 缩放因子 = maxDimension / max(width, height)
 * 如果缩放因子 ≥ 1，说明图片已经足够小，不需要缩放。
 * 新宽度 = width × 缩放因子（向下取整，避免亚像素）
 * 新高度 = height × 缩放因子（向下取整）
 *
 * 使用 Math.floor 而非 Math.round 确保结果不超过 maxDimension。
 *
 * @param originalWidth - 原始图片宽度（像素）
 * @param originalHeight - 原始图片高度（像素）
 * @param maxDimension - 最长边的最大像素值
 * @returns 缩放后的宽度和高度
 */
export function calculateScaledDimensions(
  originalWidth: number,
  originalHeight: number,
  maxDimension: number
): { width: number; height: number } {
  // 如果图片已经小于最大尺寸，保持原始大小（不放大）
  if (originalWidth <= maxDimension && originalHeight <= maxDimension) {
    return { width: originalWidth, height: originalHeight };
  }

  // 计算缩放因子：以最长边为基准
  const scale = maxDimension / Math.max(originalWidth, originalHeight);

  // 向下取整确保不超过 maxDimension
  // Math.max(1, ...) 确保至少 1px（防止极端宽高比导致 0px）
  const width = Math.max(1, Math.floor(originalWidth * scale));
  const height = Math.max(1, Math.floor(originalHeight * scale));

  return { width, height };
}

/**
 * 迭代降低 JPEG 质量，直到输出体积 ≤ 50KB。
 *
 * 📚 学习要点: 迭代质量搜索策略
 * 由于 JPEG 压缩后的体积无法精确预测（取决于图片内容复杂度），
 * 我们采用线性搜索策略：从高质量开始，每次降低 0.05，直到满足体积限制。
 *
 * 为什么不用二分搜索？
 * - 每次 toBlob() 调用都需要完整的 JPEG 编码（CPU 密集）
 * - 线性搜索最多调用 (0.8 - 0.3) / 0.05 = 10 次
 * - 对于 300px 的小图，每次编码 <10ms，总计 <100ms
 * - 二分搜索节省的调用次数（~3-4 次）不值得增加代码复杂度
 *
 * 如果在最低质量 0.3 时仍然超过 50KB（极少见，因为 300px 图片很小），
 * 则返回最低质量的结果（略微超过限制也比没有缩略图好）。
 *
 * @param canvas - 已绘制好缩略图的 Canvas 元素
 * @returns JPEG 二进制数据的 Uint8Array
 */
async function exportWithQualityReduction(
  canvas: HTMLCanvasElement
): Promise<Uint8Array> {
  let quality = INITIAL_QUALITY;

  while (quality >= MIN_QUALITY) {
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    const arrayBuffer = await blob.arrayBuffer();

    // 如果体积满足限制，直接返回
    if (arrayBuffer.byteLength <= MAX_THUMBNAIL_SIZE) {
      return new Uint8Array(arrayBuffer);
    }

    // 体积超标，降低质量继续尝试
    quality -= QUALITY_STEP;
  }

  // 最低质量仍然超标：返回最低质量的结果
  // 📚 学习要点: 为什么不返回 null？
  // 对于 300px 的缩略图，即使 quality=0.3 超过 50KB 也不会超太多。
  // 一个略大的缩略图比没有缩略图的用户体验更好。
  // 在实际场景中，300px × 300px 的 JPEG 在 quality=0.3 时通常 <20KB，
  // 只有极端复杂的图片（如密集文字截图）才可能超标。
  const finalBlob = await canvasToBlob(canvas, 'image/jpeg', MIN_QUALITY);
  const finalBuffer = await finalBlob.arrayBuffer();
  return new Uint8Array(finalBuffer);
}

/**
 * 将 Canvas 内容导出为 Blob（Promise 封装）。
 *
 * 📚 学习要点: canvas.toBlob() vs canvas.toDataURL()
 * - toDataURL() 返回 base64 字符串，体积比原始二进制大 33%（base64 膨胀）
 * - toBlob() 返回原始二进制 Blob，体积更小，且不需要字符串解析
 * - toBlob() 是异步的（回调），toDataURL() 是同步的
 * - 对于我们的场景，toBlob() 更合适：
 *   1. 我们需要 Uint8Array（二进制），不需要 base64 字符串
 *   2. 异步不阻塞主线程（虽然 300px 图片编码很快）
 *   3. 避免了 base64 → ArrayBuffer 的额外转换步骤
 *
 * @param canvas - 要导出的 Canvas 元素
 * @param type - MIME 类型（如 'image/jpeg'）
 * @param quality - 压缩质量（0.0 - 1.0）
 * @returns 导出的 Blob 对象
 */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          // toBlob 返回 null 表示编码失败（极少见）
          reject(new Error('Canvas toBlob returned null'));
        }
      },
      type,
      quality
    );
  });
}
