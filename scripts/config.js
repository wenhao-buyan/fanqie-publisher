/**
 * 配置读取：所有可变项都在 config.json，换一本书只改那一个文件
 */
const fs = require('fs');
const path = require('path');

const cfgPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(cfgPath)) {
  console.error('缺少 config.json。请先复制模板：cp scripts/config.example.json scripts/config.json');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const p = raw.txt || '';
const abs = path.isAbsolute(p) ? p : path.resolve(__dirname, '..', p);

module.exports = {
  BOOK_ID: raw.bookId,
  BOOK_NAME: raw.bookName,
  TXT: abs,
  TOTAL: raw.total || 0,
  USE_AI: !!raw.useAI,
  DETECT: raw.detect || '仅基础检测',
  TITLE_FIX: raw.titleFix || {},
};
