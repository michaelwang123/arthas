/**
 * 文件名清理与文件类型图标工具模块。
 *
 * 本模块在文件传输的接收端使用，确保从网络接收到的文件名是安全的，
 * 不会被恶意构造用于路径遍历攻击或文件系统注入。
 *
 * 📚 学习要点: 路径遍历攻击（Path Traversal Attack）
 * 攻击者可能发送恶意文件名如 "../../../etc/passwd" 或 "..\\windows\\system32\\config"，
 * 如果应用直接使用该文件名保存文件，可能覆盖系统关键文件。
 * 虽然浏览器的 <a download> 机制本身有一定保护（不允许指定绝对路径），
 * 但防御应该是多层的（Defense in Depth）：
 * 1. 移除所有路径分隔符（/ 和 \）— 消除目录遍历可能
 * 2. 移除 null 字节（\0）— 防止 C 语言风格的字符串截断攻击
 * 3. 限制长度为 255 字符 — 符合大多数文件系统的文件名长度限制
 *
 * 即使在浏览器环境中路径遍历风险较低，这些清理措施仍然是最佳实践，
 * 因为文件名可能被用于其他上下文（如日志记录、数据库存储、显示）。
 *
 * @module file-transfer/sanitize
 * @see Requirements 5.10, 1.4, 12.6
 */

/**
 * 文件系统允许的最大文件名长度。
 *
 * 📚 学习要点: 为什么是 255？
 * - ext4 (Linux): 文件名最大 255 bytes
 * - NTFS (Windows): 文件名最大 255 UTF-16 code units
 * - APFS (macOS): 文件名最大 255 UTF-8 bytes
 * 255 是跨平台兼容的安全上限。
 */
const MAX_FILE_NAME_LENGTH = 255;

/**
 * 清理文件名，移除危险字符并限制长度。
 *
 * 此函数是幂等的：对同一输入多次调用产生相同结果。
 * 即 `sanitizeFileName(sanitizeFileName(name)) === sanitizeFileName(name)`
 *
 * 清理规则（按顺序执行）：
 * 1. 移除所有正斜杠 `/` — Unix/Linux/macOS 路径分隔符
 * 2. 移除所有反斜杠 `\` — Windows 路径分隔符
 * 3. 移除所有 null 字节 `\0` — C 字符串终止符，可用于截断攻击
 * 4. 截断至 255 字符 — 文件系统长度限制
 *
 * @param name - 原始文件名（可能来自不可信的网络数据）
 * @returns 清理后的安全文件名
 *
 * @example
 * sanitizeFileName('../secret.txt')        // 返回 '..secret.txt'
 * sanitizeFileName('path/to/file.pdf')     // 返回 'pathtofile.pdf'
 * sanitizeFileName('file\0name.txt')       // 返回 'filename.txt'
 * sanitizeFileName('a'.repeat(300))        // 返回 'a'.repeat(255)
 */
export function sanitizeFileName(name: string): string {
  // 📚 学习要点: 为什么使用正则表达式而非逐字符遍历？
  // 正则表达式引擎经过高度优化（JIT 编译），对于简单的字符替换
  // 比手动循环更快且更易读。使用字符类 [/\\\0] 一次匹配所有危险字符。
  // 注意：正则中 \\ 表示匹配一个反斜杠字符，\0 匹配 null 字节。
  const cleaned = name.replace(/[/\\\0]/g, '');

  // 截断至最大长度
  // 📚 学习要点: String.slice() vs String.substring()
  // 两者在正参数时行为相同。slice() 更常用且支持负索引。
  // 这里使用 slice(0, MAX) 确保不超过文件系统限制。
  return cleaned.slice(0, MAX_FILE_NAME_LENGTH);
}

/**
 * 根据 MIME 类型返回对应的文件类型图标 emoji。
 *
 * 用于在聊天消息气泡中直观显示文件类型，帮助用户快速识别文件内容。
 *
 * 图标映射规则：
 * - 🖼️ — 图片文件（image/*）
 * - 📄 — 文档/文本文件（application/pdf, text/*）
 * - 📦 — 压缩包文件（zip, rar, gzip, tar, 7z, bzip2, xz）
 * - 📁 — 其他所有文件类型（兜底默认值）
 *
 * @param mimeType - 文件的 MIME 类型字符串（如 'image/png', 'application/pdf'）
 * @returns 对应的 emoji 图标字符串
 *
 * @example
 * getFileTypeIcon('image/png')         // 返回 '🖼️'
 * getFileTypeIcon('image/jpeg')        // 返回 '🖼️'
 * getFileTypeIcon('application/pdf')   // 返回 '📄'
 * getFileTypeIcon('text/plain')        // 返回 '📄'
 * getFileTypeIcon('application/zip')   // 返回 '📦'
 * getFileTypeIcon('application/gzip')  // 返回 '📦'
 * getFileTypeIcon('application/octet-stream') // 返回 '📁'
 */
export function getFileTypeIcon(mimeType: string): string {
  // 📚 学习要点: MIME 类型匹配策略
  // MIME 类型格式为 "type/subtype"（如 "image/png"）。
  // 使用 startsWith() 匹配主类型（如 "image/"）可以覆盖所有子类型，
  // 而不需要逐一列举 image/png, image/jpeg, image/gif 等。
  // 对于特定子类型（如压缩包），需要精确匹配完整 MIME 类型。

  // 图片类型：所有 image/* 子类型
  if (mimeType.startsWith('image/')) {
    return '🖼️';
  }

  // 文档/文本类型：PDF 和所有 text/* 子类型
  if (mimeType === 'application/pdf' || mimeType.startsWith('text/')) {
    return '📄';
  }

  // 压缩包类型：常见的归档和压缩格式
  // 📚 学习要点: 为什么使用 Set 而非数组 includes()？
  // Set.has() 的时间复杂度为 O(1)（哈希查找），
  // 而 Array.includes() 为 O(n)（线性扫描）。
  // 虽然这里元素数量少（性能差异可忽略），但使用 Set 是更好的习惯，
  // 且语义上更清晰地表达"是否属于某个集合"。
  const archiveTypes: Set<string> = new Set([
    'application/zip',
    'application/x-rar-compressed',
    'application/x-rar',
    'application/gzip',
    'application/x-gzip',
    'application/x-tar',
    'application/x-7z-compressed',
    'application/x-bzip2',
    'application/x-xz',
  ]);

  if (archiveTypes.has(mimeType)) {
    return '📦';
  }

  // 兜底：所有未匹配的类型使用通用文件夹图标
  return '📁';
}
