/**
 * check-links.mjs — 验证 dist/ 中所有内部链接的完整性
 * 
 * 扫描所有 HTML 文件中的 href 和 src 属性，
 * 检查以 /arthas/ 开头的内部链接是否能解析到 dist/ 中的实际文件。
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distDir = resolve(__dirname, '..', 'dist');

function getAllHtml(dir) {
  let results = [];
  const items = readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const full = join(dir, item.name);
    if (item.isDirectory()) {
      results = results.concat(getAllHtml(full));
    } else if (item.name.endsWith('.html')) {
      results.push(full);
    }
  }
  return results;
}

const htmlFiles = getAllHtml(distDir);
const linkRegex = /(?:href|src)=["'](\/arthas\/[^"'#?]*)["']/g;
const broken = [];

for (const file of htmlFiles) {
  const content = readFileSync(file, 'utf-8');
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const link = match[1];
    // Convert /arthas/foo to <distDir>/foo
    const relativePath = link.replace('/arthas/', '');
    const localPath = join(distDir, relativePath);
    
    // Check if the path resolves to an existing file or directory with index.html
    let resolved = false;
    
    // Direct file match
    if (existsSync(localPath) && statSync(localPath).isFile()) {
      resolved = true;
    }
    // Directory with trailing slash → check for index.html
    else if (localPath.endsWith('/') || localPath.endsWith('\\')) {
      const indexPath = join(localPath, 'index.html');
      if (existsSync(indexPath)) {
        resolved = true;
      }
    }
    // Directory without trailing slash → check dir/index.html
    else if (existsSync(localPath) && statSync(localPath).isDirectory()) {
      resolved = true;
    }
    // Path without extension → try adding /index.html
    else if (existsSync(join(localPath, 'index.html'))) {
      resolved = true;
    }
    
    if (!resolved) {
      const relFile = file.replace(distDir + '\\', '').replace(distDir + '/', '');
      broken.push({ file: relFile, link });
    }
  }
}

if (broken.length === 0) {
  console.log('✅ All internal links resolve correctly!');
  console.log(`   Checked ${htmlFiles.length} HTML files.`);
} else {
  console.log(`❌ Found ${broken.length} broken link(s):`);
  for (const b of broken) {
    console.log(`   ${b.file} → ${b.link}`);
  }
  process.exit(1);
}
