/**
 * sanitize.ts 模块的属性测试（Property-Based Testing）。
 *
 * 📚 学习要点: 属性测试 vs 单元测试
 * 单元测试验证特定输入的预期输出（example-based）。
 * 属性测试验证对于**所有可能输入**都成立的不变量（invariant）。
 * 例如：无论输入什么字符串，sanitizeFileName 的输出都不应包含路径分隔符。
 * fast-check 会自动生成数千个随机输入（包括 unicode、特殊字符、空字符串等），
 * 如果发现违反属性的输入，会自动缩小（shrink）到最小反例。
 *
 * **Validates: Requirements 5.10**
 *
 * @module file-transfer/sanitize.property.test
 * @see Requirements 5.10 — 文件名清理：移除路径分隔符、null 字节、限制长度 255
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { sanitizeFileName } from './sanitize';

describe('sanitizeFileName — Property 5: File name sanitization', () => {
  /**
   * 属性 1: 输出不包含正斜杠 `/`
   *
   * 📚 学习要点: 正斜杠是 Unix/Linux/macOS 的路径分隔符。
   * 如果文件名中包含 `/`，可能被解释为目录路径，导致路径遍历攻击。
   */
  it('output contains no forward slash `/` for any string input', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = sanitizeFileName(input);
        expect(result).not.toContain('/');
      })
    );
  });

  /**
   * 属性 2: 输出不包含反斜杠 `\`
   *
   * 📚 学习要点: 反斜杠是 Windows 的路径分隔符。
   * 恶意文件名如 `..\\..\\windows\\system32\\config` 可能在 Windows 上触发路径遍历。
   */
  it('output contains no backslash `\\` for any string input', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = sanitizeFileName(input);
        expect(result).not.toContain('\\');
      })
    );
  });

  /**
   * 属性 3: 输出不包含 null 字节 `\0`
   *
   * 📚 学习要点: Null 字节截断攻击
   * 在 C 语言风格的字符串处理中，`\0` 表示字符串结束。
   * 攻击者可能构造 `malware.exe\0.txt`，某些系统会将其截断为 `malware.exe`。
   */
  it('output contains no null byte `\\0` for any string input', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = sanitizeFileName(input);
        expect(result).not.toContain('\0');
      })
    );
  });

  /**
   * 属性 4: 输出长度不超过 255 字符
   *
   * 📚 学习要点: 文件系统长度限制
   * ext4/NTFS/APFS 等主流文件系统的文件名长度上限为 255。
   * 超长文件名会导致文件创建失败或被静默截断。
   */
  it('output length ≤ 255 for any string input', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = sanitizeFileName(input);
        expect(result.length).toBeLessThanOrEqual(255);
      })
    );
  });

  /**
   * 属性 5: 函数是幂等的 — sanitizeFileName(sanitizeFileName(x)) === sanitizeFileName(x)
   *
   * 📚 学习要点: 幂等性（Idempotency）
   * 幂等函数的特征：多次应用与一次应用产生相同结果。
   * 这对安全函数尤为重要——如果清理函数不幂等，
   * 攻击者可能构造输入使得第一次清理后仍包含危险字符。
   * 例如：如果函数只移除 `../` 而非所有 `/`，
   * 输入 `....//` 第一次清理后变成 `../`，仍然危险。
   */
  it('function is idempotent: sanitizeFileName(sanitizeFileName(x)) === sanitizeFileName(x)', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const once = sanitizeFileName(input);
        const twice = sanitizeFileName(once);
        expect(twice).toBe(once);
      })
    );
  });
});
