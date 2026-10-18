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
    const m = txt.match(/第\s*(\d+)\s*章\s*(.*?)\s+(\d+)\s/);
    if (m) out.push({ num: +m[1], title: m[2], text: txt.slice(0, 60) });
  }
  return out;
});

(async () => {
  const b = await chromium.launch({ headless: false, args: ['--headless=new', '--disable-blink-features=AutomationControlled'] });
  const ctx = await b.newContext({ storageState: path.join(HERE, 'state.json'), viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  await p.waitForSelector('tr', { timeout: 40000 }).catch(() => {});
  await p.waitForTimeout(4000);
  const know = p.getByText('我知道了', { exact: true }).first();
  if (await know.count().catch(() => 0)) await know.click().catch(() => {});
  await p.waitForTimeout(800);

  const all = new Map();
  let prev = '';
  for (let pg = 1; pg <= 15; pg++) {
    const rows = await grab(p);
    const key = rows.map(r => r.num).join(',');
    if (key === prev) break;
    prev = key;
    rows.forEach(r => all.set(r.num, r.title));
    const next = p.locator('.arco-pagination-item-next').first();
    if (!(await next.count().catch(() => 0))) break;
    const cls = await next.getAttribute('class').catch(() => '') || '';
    if (/disabled/.test(cls)) break;
    await next.click().catch(() => {});
    await p.waitForTimeout(2200);
  }

  const arr = [...all.entries()].map(([num, title]) => ({ num, title }));
  console.log('抓到', arr.length, '章');
  fs.writeFileSync(path.join(HERE, 'online_titles.json'), JSON.stringify(arr, null, 2), 'utf8');

  // 查重
  const byTitle = new Map();
  arr.forEach(x => {
    const t = x.title.trim();
    byTitle.set(t, [...(byTitle.get(t) || []), x.num]);
  });
  console.log('\n重复标题:');
  let dup = 0;
  for (const [t, nums] of byTitle) {
    if (nums.length > 1) { console.log(`  「${t}」→ 第${nums.join('、')}章`); dup++; }
  }
  if (!dup) console.log('  无重复');

  // 目标标题是否已存在
  const targets = ['夏远', '小朵', '告别', '北出口', '交换', '交班'];
  console.log('\n目标标题占用情况:');
  targets.forEach(t => {
    const hit = arr.filter(x => x.title.trim() === t).map(x => x.num);
    console.log(`  「${t}」→ ${hit.length ? '已被第' + hit.join('、') + '章占用' : '未占用'}`);
  });

  await b.close();
})().catch(e => { console.error('出错:', e.message); process.exit(1); });
