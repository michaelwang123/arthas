#!/usr/bin/env python3
"""
📚 学习要点: 属性验证脚本
本脚本验证 official_doc/ 目录下英文翻译文件的 5 个正确性属性：
1. 每个目标中文文档都有对应的 .en.md 文件
2. 标题结构保持一致（层级和数量匹配）
3. 代码块内容保持不变（排除注释行）
4. 语言导航链接存在于前 3 行
5. 代码块外无未翻译的中文字符

Validates: Requirements 6.3, 6.4, 6.5, 6.6
"""

import os
import re
import sys
from pathlib import Path

# Target Chinese documents that must have English translations
TARGET_DOCS = [
    "getting-started.md",
    "architecture.md",
    "configuration.md",
    "protocol.md",
    "self-hosting.md",
    "cli-guide.md",
    "development.md",
]

# Resolve the official_doc directory relative to this script's location
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
OFFICIAL_DOC_DIR = PROJECT_ROOT / "official_doc"


def extract_headings(content: str) -> list[str]:
    """
    Extract Markdown heading lines from content.

    Returns a list of heading markers (e.g., '##') representing the level
    of each heading found in the document, preserving order.
    """
    headings = []
    for line in content.splitlines():
        match = re.match(r"^(#{1,6})\s", line)
        if match:
            headings.append(match.group(1))
    return headings


def strip_inline_comment(line: str) -> str:
    """
    Remove trailing inline comments from a code line.

    Handles common comment styles: // and #
    Preserves the code portion before the comment.
    Does not strip if the line is entirely a comment (handled separately).
    """
    # Match trailing // comments (allowing any characters after //)
    result = re.sub(r"\s*//.*$", "", line)
    if result != line:
        return result.rstrip()

    # Match trailing # comments for shell/yaml
    # Only strip if there's code before the # and it looks like a comment
    result = re.sub(r"\s+#\s+.*$", "", line)
    if result != line:
        return result.rstrip()

    return line


def is_prose_code_block(lines: list[str]) -> bool:
    """
    Detect if a code block contains prose/diagrams rather than actual code.

    Prose blocks (ASCII diagrams, pseudocode, flow descriptions) are expected
    to be translated and should be excluded from code preservation checks.
    Heuristics:
    - Contains CJK characters or common translated patterns
    - Has no typical code syntax (=, ;, {, }, import, func, const, etc.)
    - Contains box-drawing characters or arrow symbols
    - Contains natural language flow descriptions (→ chains without assignment)
    """
    if not lines:
        return True

    # Strong code indicators — syntax that only appears in real code
    code_syntax = re.compile(
        r"[{};]|^\s*(import|from|func|const|let|var|export|return|if |for |"
        r"package |type |class |def |async |await )|"
        r"^\s*(npm |go |docker |git |cd |mkdir |curl |wget |pip |yarn |"
        r"pnpm |make |cargo )|"
        r"^\s*\w+\s*[:=]\s*\S|"  # assignment or key:value in code
        r"^\s*\$\s|"  # shell prompt
        r"^\s*\w+\(.*\)"  # function calls
    )

    # Prose indicators — natural language or diagram elements
    prose_indicators = re.compile(
        r"[\u4e00-\u9fff]|[│├└─┌┐┘┤┬┴┼╔╗╚╝║═]|"
        r"→.*→|←|↓|↑|"  # flow arrows (chained)
        r"^\d+\.\s+[A-Z\u4e00-\u9fff]|"  # numbered prose steps
        r"^[A-Z\u4e00-\u9fff][a-z\u4e00-\u9fff].*[.。:：]$"  # sentence-like
    )

    code_line_count = 0
    prose_line_count = 0
    total_lines = 0

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        total_lines += 1
        if code_syntax.search(stripped):
            code_line_count += 1
        if prose_indicators.search(stripped):
            prose_line_count += 1

    # If no code syntax found and has prose indicators, it's prose
    if code_line_count == 0 and prose_line_count > 0:
        return True

    # If majority of lines are prose-like with no code syntax
    if total_lines > 0 and code_line_count == 0:
        return True

    return False


def extract_code_blocks(content: str) -> list[list[str]]:
    """
    Extract fenced code block contents from Markdown.

    Returns a list of tuples (is_prose, lines) where:
    - is_prose: True if the block is a prose/diagram block (translation expected)
    - lines: list of code lines with inline comments stripped

    Comment-only lines (starting with //, #, --, /*, *) are excluded entirely
    since they may be translated between versions.
    """
    blocks: list[tuple[bool, list[str]]] = []
    in_block = False
    current_block_raw: list[str] = []

    for line in content.splitlines():
        if re.match(r"^```", line):
            if in_block:
                # Determine if this is a prose block
                prose = is_prose_code_block(current_block_raw)
                # Process lines: strip comments from code blocks
                processed = []
                for raw_line in current_block_raw:
                    stripped = raw_line.strip()
                    # Skip full comment lines
                    if (
                        stripped.startswith("//")
                        or stripped.startswith("--")
                        or stripped.startswith("/*")
                        or stripped.startswith("*/")
                        or (stripped.startswith("*") and not stripped.startswith("**"))
                    ):
                        continue
                    # For shell-style comments, only skip if line is ONLY a comment
                    if re.match(r"^\s*#\s", raw_line) and not re.match(
                        r"^\s*#!", raw_line
                    ):
                        continue
                    # Strip inline comments from code lines
                    processed.append(strip_inline_comment(raw_line))
                blocks.append((prose, processed))
                current_block_raw = []
                in_block = False
            else:
                in_block = True
            continue

        if in_block:
            current_block_raw.append(line)

    return blocks


def check_chinese_outside_code_blocks(content: str) -> list[tuple[int, str]]:
    """
    Find Chinese characters (\\u4e00-\\u9fff) outside fenced code blocks.

    Returns a list of (line_number, line_content) tuples where Chinese
    characters were found in prose text.
    """
    chinese_pattern = re.compile(r"[\u4e00-\u9fff]")
    violations = []
    in_code_block = False

    for line_num, line in enumerate(content.splitlines(), start=1):
        if re.match(r"^```", line):
            in_code_block = not in_code_block
            continue

        if not in_code_block and chinese_pattern.search(line):
            # Allow the navigation link line which intentionally contains 中文
            if re.match(r"^\[中文\]\(.*\.md\)\s*\|\s*English", line):
                continue
            violations.append((line_num, line))

    return violations


def validate_property_1() -> list[str]:
    """
    Property 1: English doc exists for every Chinese doc.

    Verify that each target Chinese document has a corresponding .en.md file.
    """
    errors = []
    for doc in TARGET_DOCS:
        en_doc = doc.replace(".md", ".en.md")
        en_path = OFFICIAL_DOC_DIR / en_doc
        if not en_path.exists():
            errors.append(f"MISSING: {en_doc} does not exist for {doc}")
    return errors


def validate_property_2() -> list[str]:
    """
    Property 2: Heading structure preservation.

    Verify that the heading level sequence matches between Chinese and English
    documents (same count and same # levels positionally).
    """
    errors = []
    for doc in TARGET_DOCS:
        en_doc = doc.replace(".md", ".en.md")
        zh_path = OFFICIAL_DOC_DIR / doc
        en_path = OFFICIAL_DOC_DIR / en_doc

        if not zh_path.exists() or not en_path.exists():
            continue

        zh_content = zh_path.read_text(encoding="utf-8")
        en_content = en_path.read_text(encoding="utf-8")

        zh_headings = extract_headings(zh_content)
        en_headings = extract_headings(en_content)

        if len(zh_headings) != len(en_headings):
            errors.append(
                f"HEADING COUNT MISMATCH in {en_doc}: "
                f"Chinese has {len(zh_headings)} headings, "
                f"English has {len(en_headings)} headings"
            )
            continue

        for i, (zh_h, en_h) in enumerate(zip(zh_headings, en_headings)):
            if zh_h != en_h:
                errors.append(
                    f"HEADING LEVEL MISMATCH in {en_doc} at position {i + 1}: "
                    f"Chinese has '{zh_h}', English has '{en_h}'"
                )
    return errors


def validate_property_3() -> list[str]:
    """
    Property 3: Code block preservation.

    Verify that fenced code block content (excluding comment lines) is
    identical between Chinese and English documents. Prose/diagram blocks
    (which are expected to be translated) are skipped.

    📚 学习要点: 判断代码块是否需要翻译
    如果中文版代码块的非注释行中包含中文字符，说明该块是伪代码/流程描述，
    翻译后内容会不同，因此跳过比较。
    """
    errors = []
    chinese_char_pattern = re.compile(r"[\u4e00-\u9fff]")

    for doc in TARGET_DOCS:
        en_doc = doc.replace(".md", ".en.md")
        zh_path = OFFICIAL_DOC_DIR / doc
        en_path = OFFICIAL_DOC_DIR / en_doc

        if not zh_path.exists() or not en_path.exists():
            continue

        zh_content = zh_path.read_text(encoding="utf-8")
        en_content = en_path.read_text(encoding="utf-8")

        zh_blocks = extract_code_blocks(zh_content)
        en_blocks = extract_code_blocks(en_content)

        if len(zh_blocks) != len(en_blocks):
            errors.append(
                f"CODE BLOCK COUNT MISMATCH in {en_doc}: "
                f"Chinese has {len(zh_blocks)} blocks, "
                f"English has {len(en_blocks)} blocks"
            )
            continue

        for i, ((zh_prose, zh_lines), (en_prose, en_lines)) in enumerate(
            zip(zh_blocks, en_blocks)
        ):
            # Skip prose/diagram blocks — these are expected to be translated
            if zh_prose or en_prose:
                continue

            # If the Chinese code block contains CJK characters in its
            # non-comment lines, it's pseudocode/prose that gets translated
            zh_has_chinese = any(
                chinese_char_pattern.search(line) for line in zh_lines
            )
            if zh_has_chinese:
                continue

            if zh_lines != en_lines:
                # Show first difference for debugging
                for j, (zh_line, en_line) in enumerate(
                    zip(zh_lines, en_lines)
                ):
                    if zh_line != en_line:
                        errors.append(
                            f"CODE BLOCK DIFF in {en_doc}, block {i + 1}, "
                            f"line {j + 1}:\n"
                            f"  Chinese: {zh_line!r}\n"
                            f"  English: {en_line!r}"
                        )
                        break
                else:
                    # Length difference
                    if len(zh_lines) != len(en_lines):
                        errors.append(
                            f"CODE BLOCK LENGTH DIFF in {en_doc}, block {i + 1}: "
                            f"Chinese has {len(zh_lines)} non-comment lines, "
                            f"English has {len(en_lines)} non-comment lines"
                        )
    return errors


def validate_property_4() -> list[str]:
    """
    Property 4: Language navigation link presence.

    Verify that the first 3 lines of each English file contain the pattern:
    [中文](<basename>.md) | English
    """
    errors = []
    for doc in TARGET_DOCS:
        en_doc = doc.replace(".md", ".en.md")
        en_path = OFFICIAL_DOC_DIR / en_doc

        if not en_path.exists():
            continue

        content = en_path.read_text(encoding="utf-8")
        first_lines = content.splitlines()[:3]

        # Expected pattern: [中文](<basename>.md) | English
        basename = doc.replace(".md", "")
        expected_pattern = re.compile(
            rf"\[中文\]\({re.escape(basename)}\.md\)\s*\|\s*English"
        )

        found = any(expected_pattern.search(line) for line in first_lines)
        if not found:
            errors.append(
                f"MISSING NAV LINK in {en_doc}: "
                f"Expected '[中文]({basename}.md) | English' in first 3 lines, "
                f"got: {first_lines}"
            )
    return errors


def validate_property_5() -> list[str]:
    """
    Property 5: No untranslated Chinese prose.

    Verify that no Chinese characters (\\u4e00-\\u9fff) appear outside of
    fenced code blocks in the English translation files.
    """
    errors = []
    for doc in TARGET_DOCS:
        en_doc = doc.replace(".md", ".en.md")
        en_path = OFFICIAL_DOC_DIR / en_doc

        if not en_path.exists():
            continue

        content = en_path.read_text(encoding="utf-8")
        violations = check_chinese_outside_code_blocks(content)

        for line_num, line in violations:
            errors.append(
                f"CHINESE TEXT in {en_doc}, line {line_num}: {line.strip()}"
            )
    return errors


def main() -> int:
    """
    Run all 5 property validations and report results.

    Returns 0 if all properties pass, 1 if any fail.
    """
    print("=" * 60)
    print("English Translation Validation Script")
    print(f"Checking {len(TARGET_DOCS)} documents in: {OFFICIAL_DOC_DIR}")
    print("=" * 60)
    print()

    all_passed = True

    # Property 1: English doc exists for every Chinese doc
    print("Property 1: English doc exists for every Chinese doc")
    print("-" * 50)
    errors = validate_property_1()
    if errors:
        all_passed = False
        for e in errors:
            print(f"  ❌ {e}")
    else:
        print("  ✅ All English translations exist")
    print()

    # Property 2: Heading structure preservation
    print("Property 2: Heading structure preservation")
    print("-" * 50)
    errors = validate_property_2()
    if errors:
        all_passed = False
        for e in errors:
            print(f"  ❌ {e}")
    else:
        print("  ✅ All heading structures match")
    print()

    # Property 3: Code block preservation
    print("Property 3: Code block preservation")
    print("-" * 50)
    errors = validate_property_3()
    if errors:
        all_passed = False
        for e in errors:
            print(f"  ❌ {e}")
    else:
        print("  ✅ All code blocks preserved")
    print()

    # Property 4: Language navigation link presence
    print("Property 4: Language navigation link presence")
    print("-" * 50)
    errors = validate_property_4()
    if errors:
        all_passed = False
        for e in errors:
            print(f"  ❌ {e}")
    else:
        print("  ✅ All navigation links present")
    print()

    # Property 5: No untranslated Chinese prose
    print("Property 5: No untranslated Chinese prose")
    print("-" * 50)
    errors = validate_property_5()
    if errors:
        all_passed = False
        for e in errors:
            print(f"  ❌ {e}")
    else:
        print("  ✅ No untranslated Chinese text found")
    print()

    # Summary
    print("=" * 60)
    if all_passed:
        print("✅ ALL PROPERTIES PASSED")
        return 0
    else:
        print("❌ SOME PROPERTIES FAILED — see details above")
        return 1


if __name__ == "__main__":
    sys.exit(main())
