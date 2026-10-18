const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const CFG = require('./config');
const BOOK_ID = CFG.BOOK_ID;
const BOOK_NAME = CFG.BOOK_NAME;
const URL = `https://fanqienovel.com/main/writer/chapter-manage/${BOOK_ID}&${encodeURIComponent(BOOK_NAME)}?type=2`;

const grab = async (p) => p.evaluate(() => {
  const out = [];
  for (const tr of document.querySelectorAll('tr')) {
    const txt = (tr.innerText || '').replace(/\s+/g, ' ').trim();
    const m = txt.match(/第\s*(\d+)\s*章/);
    const a = tr.querySelector('a[href*="/publish/"]');
    if (!m) continue;
    const id = a ? (a.getAttribute('href') || '').match(/publish\/(\d+)/) : null;
    out.push({ num: +m[1], id: id ? id[1] : null, text: txt.slice(0, 90) });
  }
  return out;
});

(async () => {
  const b = await chromium.launch({ headless: false, args: ['--headless=new', '--disable-blink-features=AutomationControlled'] });
  const ctx = await b.newContext({ storageState: path.join(HERE, 'state.json'), viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  await p.waitForSelector('tr', { timeout: 40000 }).catch(() => {});
  await p.waitForTimeout(4000);
  const know = p.getByText('我知道了', { exact: true }).first();
  if (await know.count().catch(() => 0)) await know.click().catch(() => {});
  await p.waitForTimeout(800);
  await p.getByText('草稿箱', { exact: true }).first().click();
  await p.waitForTimeout(4000);

  const total = await p.evaluate(() => {
    const m = document.body.innerText.match(/共\s*(\d+)\s*篇草稿/);
    return m ? +m[1] : -1;
  });
  console.log('草稿箱总数:', total);

  const map = new Map();
  let lastKey = '';
  for (let pg = 1; pg <= 20; pg++) {
    const rows = await grab(p);
    const key = rows.map(r => r.num).join(',');
    if (key === lastKey) { console.log(`  第${pg}页无变化，停止`); break; }
    lastKey = key;
    rows.forEach(r => map.set(r.num, r.id));
    console.log(`  第${pg}页 ${rows.length} 条，累计 ${map.size}`);

    // 点下一页箭头
    const next = p.locator('.arco-pagination-item-next').first();
    if (!(await next.count().catch(() => 0))) break;
    const disabled = await next.getAttribute('class').catch(() => '');
    if (disabled && /disabled/.test(disabled)) { console.log('  已到最后一页'); break; }
    await next.click().catch(() => {});
    await p.waitForTimeout(2500);
  }

  const nums = [...map.keys()].sort((a, b) => a - b);
  console.log('\n抓到章号:', nums.join(','));
  const missing = [];
  for (let i = 1; i <= 175; i++) if (!map.has(i)) missing.push(i);
  console.log('相对全书缺失:', missing.join(','));

  fs.writeFileSync(path.join(HERE, 'draft_rest.json'), JSON.stringify(Object.fromEntries([...map.entries()].sort((a, b) => a[0] - b[0])), null, 2), 'utf8');
  await b.close();
})().catch(e => { console.error('出错:', e.message); process.exit(1); });
