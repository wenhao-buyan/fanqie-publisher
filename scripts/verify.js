const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const CFG = require('./config');
const BOOK_ID = CFG.BOOK_ID;
const BOOK_NAME = CFG.BOOK_NAME;
const URL = `https://fanqienovel.com/main/writer/chapter-manage/${BOOK_ID}&${encodeURIComponent(BOOK_NAME)}?type=1`;

const grab = async (p) => p.evaluate(() => {
  const out = [];
  for (const tr of document.querySelectorAll('tr')) {
    const txt = (tr.innerText || '').replace(/\s+/g, ' ').trim();
    const m = txt.match(/第\s*(\d+)\s*章/);
    if (m) out.push({ num: +m[1], text: txt.slice(0, 80) });
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

  const pages = [];
  let lastKey = '';
  for (let pg = 1; pg <= 20; pg++) {
    const rows = await grab(p);
    const key = rows.map(r => r.num).join(',');
    if (key === lastKey) break;
    lastKey = key;
    pages.push({ page: pg, rows });
    console.log(`第${pg}页: ${rows.map(r => r.num).join(' ')}`);
    const next = p.locator('.arco-pagination-item-next').first();
    if (!(await next.count().catch(() => 0))) break;
    const cls = await next.getAttribute('class').catch(() => '') || '';
    if (/disabled/.test(cls)) break;
    await next.click().catch(() => {});
    await p.waitForTimeout(2200);
  }

  const flat = pages.flatMap(x => x.rows.map(r => r.num));
  console.log('\n页面顺序（前30）:', flat.slice(0, 30).join(' '));
  console.log('页面顺序（后30）:', flat.slice(-30).join(' '));
  console.log('总数:', flat.length);

  // 检查是否递增
  const breaks = [];
  for (let i = 1; i < flat.length; i++) {
    if (flat[i] < flat[i - 1]) breaks.push(`${flat[i - 1]}→${flat[i]}`);
  }
  console.log('倒序断点:', breaks.length ? breaks.join(' | ') : '无（整体递增）');

  fs.writeFileSync(path.join(HERE, 'online_order.json'), JSON.stringify(flat, null, 2), 'utf8');
  await b.close();
})().catch(e => { console.error('出错:', e.message); process.exit(1); });
