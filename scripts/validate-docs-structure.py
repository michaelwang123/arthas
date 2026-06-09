#!/usr/bin/env python3
"""
📚 Arthas Docs Structure Validation

Validates 5 correctness properties for bilateral documentation equivalence:
1. README Features list bilateral equivalence (emoji sequence + entry count)
2. README section structure equivalence (H2/H3 headings + img src references)
3. Official doc bilateral equivalence (H2 count, SVG refs, language toggle links)
4. Demo page bilateral equivalence (@keyframes definitions + HTML tag structure)
5. SVG self-containment (no external resource references)

Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5
"""

import re
import sys
from pathlib import Path
from typing import List, NamedTuple

# Resolve project root relative to this script's location
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent

# File paths
README_EN = PROJECT_ROOT / "README.md"
README_ZH = PROJECT_ROOT / "README.zh.md"
OFFICIAL_DOC_DIR = PROJECT_ROOT / "official_doc"
DIAGRAMS_DIR = PROJECT_ROOT / "docs" / "diagrams"
DEMO_EN_DIR = PROJECT_ROOT / "website" / "src" / "pages" / "demo"
DEMO_ZH_DIR = PROJECT_ROOT / "website" / "src" / "pages" / "zh" / "demo"

# Official doc pairs to validate (ZH filename, EN filename)
OFFICIAL_DOC_PAIRS = [
    ("activity-ranking.md", "activity-ranking.en.md"),
    ("random-match.md", "random-match.en.md"),
]

# Demo page pairs to validate (feature name, EN filename, ZH filename)
DEMO_PAGE_PAIRS = [
    ("activity-ranking", "activity-ranking.astro", "activity-ranking.astro"),
    ("random-match", "random-match.astro", "random-match.astro"),
]


# =============================================================================
# Unified result type for all validators
# =============================================================================


class ValidationResult(NamedTuple):
    """Unified return type for all property validators."""

    passed: bool
    successes: List[str]  # Messages for successful checks
    errors: List[str]  # Messages for failed checks


# =============================================================================
# Helper functions
# =============================================================================


def extract_features_list(content: str) -> List[str]:
    """
    Extract the Features list entries from a README file.

    Only extracts entries within the ## Features / ## 功能特性 section.
    Returns list of full entry lines.
    """
    lines = content.splitlines()
    in_features = False
    entries = []

    for line in lines:
        if re.match(r"^##\s+(Features|功能特性)\s*$", line):
            in_features = True
            continue
        if in_features and re.match(r"^##\s+", line):
            break
        if in_features and re.match(r"^- .+\*\*.+\*\*", line):
            entries.append(line)

    return entries


def extract_emoji_from_entry(entry: str) -> str:
    """
    Extract the leading emoji/symbol from a feature list entry.

    Uses a simple heuristic: grab the first non-whitespace token after '- '
    that precedes the bold title (**...**).
    """
    match = re.match(r"^- (\S+)\s+\*\*", entry)
    return match.group(1) if match else ""


def extract_headings(content: str) -> List[tuple]:
    """Extract H2 and H3 headings as (level_str, title) tuples."""
    headings = []
    for line in content.splitlines():
        match = re.match(r"^(#{2,3})\s+(.+)$", line)
        if match:
            headings.append((match.group(1), match.group(2).strip()))
    return headings


def extract_img_src_refs(content: str) -> List[str]:
    """Extract <img src="..."> attribute values from content."""
    return re.findall(r'<img\s+[^>]*src=["\']([^"\']+)["\']', content)


def extract_h2_headings(content: str) -> List[str]:
    """Extract H2 heading titles from Markdown content."""
    return re.findall(r"^##\s+(.+)$", content, re.MULTILINE)


def extract_svg_references(content: str) -> List[str]:
    """Extract SVG file references from Markdown content."""
    refs = re.findall(r'(?:src=["\']|]\()([^"\')\s]*\.svg)["\')?\s]?', content)
    return sorted(set(refs))


def has_language_toggle(content: str, expected_target: str) -> bool:
    """Check if the first 5 lines contain a language toggle link to expected_target."""
    first_lines = "\n".join(content.splitlines()[:5])
    pattern = re.compile(
        r"\[(English|中文)\]\(" + re.escape(expected_target) + r"\)"
    )
    return bool(pattern.search(first_lines))


def extract_keyframes(content: str) -> List[str]:
    """Extract sorted list of @keyframes animation names from CSS/Astro content."""
    return sorted(re.findall(r"@keyframes\s+([\w-]+)", content))


def extract_html_tags(content: str) -> List[str]:
    """
    Extract HTML tag structure from Astro content (excluding frontmatter,
    style, and script blocks). Returns list of opening tag names.
    """
    # Remove frontmatter
    content = re.sub(r"^---.*?---", "", content, count=1, flags=re.DOTALL)
    # Remove <style> and <script> blocks
    content = re.sub(r"<style[^>]*>.*?</style>", "", content, flags=re.DOTALL)
    content = re.sub(r"<script[^>]*>.*?</script>", "", content, flags=re.DOTALL)
    # Extract opening tag names
    return re.findall(r"<([a-zA-Z][a-zA-Z0-9]*)", content)


# =============================================================================
# Property Validators (all return ValidationResult)
# =============================================================================


def validate_property_1() -> ValidationResult:
    """Property 1: README Features list bilateral equivalence."""
    errors: List[str] = []

    if not README_EN.exists():
        return ValidationResult(False, [], [f"MISSING: {README_EN.name}"])
    if not README_ZH.exists():
        return ValidationResult(False, [], [f"MISSING: {README_ZH.name}"])

    en_content = README_EN.read_text(encoding="utf-8")
    zh_content = README_ZH.read_text(encoding="utf-8")

    en_entries = extract_features_list(en_content)
    zh_entries = extract_features_list(zh_content)

    en_count = len(en_entries)
    zh_count = len(zh_entries)

    if en_count != zh_count:
        errors.append(
            f"Entry count mismatch: README.md has {en_count}, "
            f"README.zh.md has {zh_count}"
        )

    # Compare emoji sequences
    en_emojis = [extract_emoji_from_entry(e) for e in en_entries]
    zh_emojis = [extract_emoji_from_entry(e) for e in zh_entries]

    for i in range(min(len(en_emojis), len(zh_emojis))):
        if en_emojis[i] != zh_emojis[i]:
            errors.append(
                f"Emoji mismatch at position {i + 1}: "
                f"EN='{en_emojis[i]}', ZH='{zh_emojis[i]}'"
            )

    if errors:
        return ValidationResult(False, [], errors)

    return ValidationResult(
        True,
        [f"Both READMEs have {en_count} feature entries with matching emoji sequence"],
        [],
    )


def validate_property_2() -> ValidationResult:
    """Property 2: README section structure equivalence."""
    if not README_EN.exists() or not README_ZH.exists():
        return ValidationResult(False, [], ["README files missing"])

    en_content = README_EN.read_text(encoding="utf-8")
    zh_content = README_ZH.read_text(encoding="utf-8")

    en_headings = extract_headings(en_content)
    zh_headings = extract_headings(zh_content)

    en_h2 = [h for h in en_headings if h[0] == "##"]
    en_h3 = [h for h in en_headings if h[0] == "###"]
    zh_h2 = [h for h in zh_headings if h[0] == "##"]
    zh_h3 = [h for h in zh_headings if h[0] == "###"]

    errors: List[str] = []

    if len(en_h2) != len(zh_h2):
        errors.append(f"H2 count mismatch: EN={len(en_h2)}, ZH={len(zh_h2)}")
    if len(en_h3) != len(zh_h3):
        errors.append(f"H3 count mismatch: EN={len(en_h3)}, ZH={len(zh_h3)}")

    en_imgs = extract_img_src_refs(en_content)
    zh_imgs = extract_img_src_refs(zh_content)

    if en_imgs != zh_imgs:
        errors.append(f"img src refs differ: EN={en_imgs}, ZH={zh_imgs}")

    if errors:
        return ValidationResult(False, [], errors)

    return ValidationResult(
        True,
        [f"H2/H3 counts match ({len(en_h2)}/{len(en_h3)}), img src refs identical"],
        [],
    )


def validate_property_3() -> ValidationResult:
    """Property 3: Official doc bilateral equivalence."""
    errors: List[str] = []
    successes: List[str] = []

    for zh_name, en_name in OFFICIAL_DOC_PAIRS:
        zh_path = OFFICIAL_DOC_DIR / zh_name
        en_path = OFFICIAL_DOC_DIR / en_name
        feature = zh_name.replace(".md", "")

        if not zh_path.exists():
            errors.append(f"{feature}: MISSING {zh_name}")
            continue
        if not en_path.exists():
            errors.append(f"{feature}: MISSING {en_name}")
            continue

        zh_content = zh_path.read_text(encoding="utf-8")
        en_content = en_path.read_text(encoding="utf-8")

        pair_errors: List[str] = []

        zh_h2 = extract_h2_headings(zh_content)
        en_h2 = extract_h2_headings(en_content)

        if len(zh_h2) != len(en_h2):
            pair_errors.append(f"H2 count: ZH={len(zh_h2)}, EN={len(en_h2)}")

        zh_svgs = extract_svg_references(zh_content)
        en_svgs = extract_svg_references(en_content)

        if zh_svgs != en_svgs:
            pair_errors.append(f"SVG refs differ: ZH={zh_svgs}, EN={en_svgs}")

        if not has_language_toggle(zh_content, en_name):
            pair_errors.append(f"ZH missing lang link to {en_name}")
        if not has_language_toggle(en_content, zh_name):
            pair_errors.append(f"EN missing lang link to {zh_name}")

        if pair_errors:
            for e in pair_errors:
                errors.append(f"{feature}: {e}")
        else:
            successes.append(
                f"{feature}: {len(zh_h2)} H2 sections (ZH=EN), "
                f"SVG refs match, lang links present"
            )

    return ValidationResult(len(errors) == 0, successes, errors)


def validate_property_4() -> ValidationResult:
    """Property 4: Demo page bilateral equivalence."""
    errors: List[str] = []
    successes: List[str] = []

    for feature, en_file, zh_file in DEMO_PAGE_PAIRS:
        en_path = DEMO_EN_DIR / en_file
        zh_path = DEMO_ZH_DIR / zh_file

        if not en_path.exists():
            errors.append(f"{feature}: MISSING EN demo {en_path.relative_to(PROJECT_ROOT)}")
            continue
        if not zh_path.exists():
            errors.append(f"{feature}: MISSING ZH demo {zh_path.relative_to(PROJECT_ROOT)}")
            continue

        en_content = en_path.read_text(encoding="utf-8")
        zh_content = zh_path.read_text(encoding="utf-8")

        pair_errors: List[str] = []

        en_keyframes = extract_keyframes(en_content)
        zh_keyframes = extract_keyframes(zh_content)

        if en_keyframes != zh_keyframes:
            pair_errors.append(f"@keyframes mismatch: EN={en_keyframes}, ZH={zh_keyframes}")

        en_tags = extract_html_tags(en_content)
        zh_tags = extract_html_tags(zh_content)

        if en_tags != zh_tags:
            min_len = min(len(en_tags), len(zh_tags))
            diff_idx = next(
                (i for i in range(min_len) if en_tags[i] != zh_tags[i]),
                min_len if len(en_tags) != len(zh_tags) else -1,
            )
            if diff_idx >= 0:
                en_ctx = en_tags[max(0, diff_idx - 1) : diff_idx + 2]
                zh_ctx = zh_tags[max(0, diff_idx - 1) : diff_idx + 2]
                pair_errors.append(
                    f"HTML tags differ at pos {diff_idx + 1}: EN={en_ctx}, ZH={zh_ctx}"
                )
            else:
                pair_errors.append("HTML tag structure differs (unknown position)")

        if pair_errors:
            for e in pair_errors:
                errors.append(f"{feature}: {e}")
        else:
            kf_count = len(en_keyframes)
            successes.append(
                f"{feature}: @keyframes match ({kf_count} each), tag structure identical"
            )

    return ValidationResult(len(errors) == 0, successes, errors)


def validate_property_5() -> ValidationResult:
    """Property 5: SVG self-containment."""
    errors: List[str] = []
    successes: List[str] = []

    if not DIAGRAMS_DIR.exists():
        return ValidationResult(False, [], [f"MISSING: {DIAGRAMS_DIR} directory"])

    svg_files = sorted(DIAGRAMS_DIR.glob("*.svg"))

    if not svg_files:
        return ValidationResult(False, [], ["No SVG files found in docs/diagrams/"])

    external_patterns = [
        (re.compile(r'xlink:href\s*=\s*["\']https?://'), "xlink:href to external URL"),
        (re.compile(r'<image[^>]+href\s*=\s*["\']https?://'), "<image href> to external URL"),
        (re.compile(r"@import\s+url\s*\("), "@import url() external resource"),
        (
            re.compile(r'href\s*=\s*["\']https?://[^"\']*\.(css|woff2?|ttf|otf)'),
            "href to external stylesheet/font",
        ),
    ]

    for svg_file in svg_files:
        content = svg_file.read_text(encoding="utf-8")
        file_errors = []

        for pattern, description in external_patterns:
            if pattern.search(content):
                file_errors.append(f"Found {description}")

        if file_errors:
            for e in file_errors:
                errors.append(f"{svg_file.name}: {e}")
        else:
            successes.append(f"{svg_file.name}: no external references")

    return ValidationResult(len(errors) == 0, successes, errors)


# =============================================================================
# Main
# =============================================================================

VALIDATORS = [
    ("Property 1: README Features list bilateral equivalence", validate_property_1),
    ("Property 2: README section structure equivalence", validate_property_2),
    ("Property 3: Official doc bilateral equivalence", validate_property_3),
    ("Property 4: Demo page bilateral equivalence", validate_property_4),
    ("Property 5: SVG self-containment", validate_property_5),
]


def main() -> int:
    """Run all property validations and report results."""
    print("=== Arthas Docs Structure Validation ===")
    print()

    passed_count = 0

    for title, validator in VALIDATORS:
        print(title)
        result = validator()

        if result.passed:
            passed_count += 1
            for msg in result.successes:
                print(f"  ✅ PASSED — {msg}")
        else:
            for msg in result.errors:
                print(f"  ❌ FAILED — {msg}")
            for msg in result.successes:
                print(f"  ✅ PASSED — {msg}")
        print()

    total = len(VALIDATORS)
    print(f"=== Result: {passed_count}/{total} Properties PASSED ===")
    return 0 if passed_count == total else 1


if __name__ == "__main__":
    sys.exit(main())
