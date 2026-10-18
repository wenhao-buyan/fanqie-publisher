const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const CFG = require('./config');
const BOOK_ID = CFG.BOOK_ID;
const BOOK_NAME = CFG.BOOK_NAME;
// type=2 就是草稿箱
const DRAFT_URL = `https://fanqienovel.com/main/writer/chapter-manage/${BOOK_ID}&${encodeURIComponent(BOOK_NAME)}?type=2`;
const GO = process.argv.includes('--go');

const rows = async (p) => p.evaluate(() => {
  const out = [];
  for (const tr of document.querySelectorAll('tr')) {
    const txt = (tr.innerText || '').replace(/\s+/g, ' ').trim();
    const m = txt.match(/第\s*(\d+)\s*章/);
    if (m) out.push({ num: +m[1], txt: txt.slice(0, 70) });
  }
  return out;
});

(async () => {
  const b = await chromium.launch({ headless: false, args: ['--headless=new', '--disable-blink-features=AutomationControlled'] });
  const ctx = await b.newContext({ storageState: path.join(HERE, 'state.json'), viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  const p = await ctx.newPage();
  await p.goto(DRAFT_URL, { waitUntil: 'commit', timeout: 60000 });
  await p.waitForSelector('tr', { timeout: 40000 }).catch(() => {});
  await p.waitForTimeout(4500);
  const know = p.getByText('我知道了', { exact: true }).first();
  if (await know.count().catch(() => 0)) await know.click().catch(() => {});
  await p.waitForTimeout(1000);

  const head = await p.evaluate(() => {
    const m = document.body.innerText.match(/共\s*(\d+)\s*篇草稿/);
    return m ? m[0] : '(未读到草稿统计)';
  });
  console.log('URL:', p.url());
  console.log('统计:', head);
  const first = await rows(p);
  console.log('首行:', first[0] ? first[0].txt : '无');

  if (!GO) { await b.close(); return; }

  // 循环删除第一篇，直到清空
  let deleted = 0;
  let stuck = 0;
  for (let i = 0; i < 120; i++) {
    const list = await rows(p);
    if (!list.length) { console.log('草稿箱已空'); break; }
    const before = list[0].txt;

    const del = p.locator('span.icon-delete, .tomato-delete, .auto-editor-chapter-delete').first();
    if (!(await del.count().catch(() => 0))) { console.log('找不到删除按钮'); break; }
    await del.click({ force: true }).catch(() => {});
    await p.waitForTimeout(1800);

    // 确认弹窗：dump 后按文本点
    const dlgText = await p.evaluate(() => {
      const els = [...document.querySelectorAll('[class*=modal],[class*=dialog]')];
      return els.map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(x => x).join(' || ').slice(0, 200);
    }).catch(() => '');
    let confirmed = false;
    for (const t of ['确定', '确认删除', '确认', '删除', '是']) {
      const btn = p.getByText(t, { exact: true }).last();
      if (await btn.count().catch(() => 0) && await btn.isVisible().catch(() => false)) {
        await btn.click({ force: true }).catch(() => {});
        confirmed = true;
        await p.waitForTimeout(1500);
        break;
      }
    }
    await p.waitForTimeout(2000);

    const after = await rows(p);
    if (after.length && after[0].txt === before) {
      stuck++;
      console.log(`删除 #${deleted + 1} 未生效（${before}）弹窗:${dlgText || '无'} 确认:${confirmed}`);
      if (stuck >= 3) { console.log('连续 3 次失败，停止'); break; }
      await p.reload({ waitUntil: 'commit' }).catch(() => {});
      await p.waitForTimeout(4000);
      continue;
    }
    stuck = 0;
    deleted++;
    console.log(`删除 #${deleted}: ${before} → 剩余 ${after.length}`);
  }
  console.log('共删除', deleted, '篇');
  await p.screenshot({ path: path.join(HERE, 'drafts_cleared.png') });
  await b.close();
})().catch(e => { console.error('出错:', e.message); process.exit(1); });
