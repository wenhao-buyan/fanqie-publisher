/**
 * 批量提交草稿 → 发布
 * 每章：编辑页 → 下一步 → 提交(错别字) → 仅基础检测 → AI选否 → 确认提交
 *
 *   node submit.js --count 1            先发 1 章验证
 *   node submit.js --count 10           发 10 章
 *   node submit.js --from 1 --count 20  从第1章起发20章
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const HERE = __dirname;
const BASE = 'https://fanqienovel.com';
const CFG = require('./config');
const BOOK_ID = CFG.BOOK_ID;
const MAP = JSON.parse(fs.readFileSync(path.join(HERE, 'chapter_map.json'), 'utf8'));
const PROG = path.join(HERE, 'submit_progress.json');

// 番茄要求章节标题至少 5 个字，这几个原标题太短，按正文内容补长
const TITLE_FIX = CFG.TITLE_FIX;

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = (n) => argv.includes(`--${n}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const log = (...a) => console.log(`[${new Date().toLocaleTimeString('zh-CN')}]`, ...a);

const loadProg = () => { try { return JSON.parse(fs.readFileSync(PROG, 'utf8')); } catch { return { done: [], failed: [] }; } };
const saveProg = (p) => fs.writeFileSync(PROG, JSON.stringify(p, null, 2), 'utf8');

async function tap(page, texts, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const t of texts) {
      const loc = page.getByText(t, { exact: true });
      const n = await loc.count().catch(() => 0);
      for (let i = n - 1; i >= 0; i--) {
        const el = loc.nth(i);
        if (await el.isVisible().catch(() => false)) {
          await el.click({ timeout: 3000 }).catch(() => {});
          return t;
        }
      }
    }
    await sleep(400);
  }
  return null;
}

async function chooseAI(page, useAI) {
  const want = useAI ? '是' : '否';
  const loc = page.getByText(want, { exact: true });
  const n = await loc.count().catch(() => 0);
  for (let i = n - 1; i >= 0; i--) {
    const el = loc.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const box = await el.boundingBox().catch(() => null);
    if (box && box.width < 80) { await el.click().catch(() => {}); await sleep(500); return true; }
  }
  const ok = await page.evaluate((w) => {
    const all = [...document.querySelectorAll('*')];
    const lab = all.find(e => e.children.length === 0 && (e.textContent || '').trim() === '是否使用AI');
    if (!lab) return false;
    let row = lab.parentElement;
    for (let k = 0; k < 5 && row; k++) {
      const radios = [...row.querySelectorAll('input[type=radio], .arco-radio')];
      if (radios.length >= 2) { (w === '否' ? radios[1] : radios[0]).click(); return true; }
      row = row.parentElement;
    }
    return false;
  }, want).catch(() => false);
  await sleep(500);
  return ok;
}

/** 关掉新手引导浮层：浮层里的「下一步」y 坐标 > 100，顶部的在顶部 */
async function closeGuide(page) {
  for (let i = 0; i < 5; i++) {
    const btns = page.locator('button:has-text("下一步")');
    const n = await btns.count().catch(() => 0);
    let clicked = false;
    for (let j = 0; j < n; j++) {
      const box = await btns.nth(j).boundingBox().catch(() => null);
      if (box && box.y > 100) {                 // 浮层按钮
        await btns.nth(j).click().catch(() => {});
        clicked = true;
        break;
      }
    }
    if (!clicked) return;
    await sleep(1200);
  }
}

/** 点顶部的「下一步」（x>800 且 y<100），避开浮层里的同名按钮 */
async function clickTopNext(page) {
  const btns = page.locator('button:has-text("下一步")');
  const n = await btns.count().catch(() => 0);
  for (let j = 0; j < n; j++) {
    const box = await btns.nth(j).boundingBox().catch(() => null);
    if (box && box.y < 100 && box.x > 800) {
      await btns.nth(j).click().catch(() => {});
      return true;
    }
  }
  return false;
}

async function submitOne(page, num, aiYes) {
  const id = MAP[num];
  if (!id) throw new Error('无 chapterId');
  await page.goto(`${BASE}/main/writer/${BOOK_ID}/publish/${id}/?enter_from=modifydraft`, { waitUntil: 'commit', timeout: 60000 });

  // 等编辑器真正就绪（标题框出现），而不是死等固定秒数
  await page.waitForSelector('input[placeholder="请输入标题"]', { timeout: 45000 }).catch(() => {});
  await sleep(rand(2500, 3500));

  // 1) 新手引导 3 步
  await closeGuide(page);
  await sleep(800);
  // 2) 平台合规提示
  await tap(page, ['我知道了'], 5000);
  await sleep(800);

  // 2.5) 标题过短的，先补长
  if (TITLE_FIX[num]) {
    const ti = page.locator('input[placeholder="请输入标题"]').first();
    if (await ti.count().catch(() => 0)) {
      await ti.click().catch(() => {});
      await ti.fill('').catch(() => {});
      await ti.type(TITLE_FIX[num], { delay: 30 }).catch(() => {});
      await sleep(800);
      log(`   · 标题补长 → ${TITLE_FIX[num]}`);
    }
  }

  // 3) 顶部「下一步」
  if (!(await clickTopNext(page))) throw new Error('未找到顶部「下一步」');
  await sleep(3000);

  const r1 = await tap(page, ['提交'], 6000);
  if (r1) log('   · 错别字提示 → 提交');
  await sleep(2000);

  const r2 = await tap(page, ['仅基础检测', '全面检测'], 7000);
  if (r2) log(`   · 内容检测 → ${r2}`);
  await sleep(2500);

  const aiOk = await chooseAI(page, aiYes);
  if (!aiOk) log('   · AI 选项未找到，尝试继续');
  const r3 = await tap(page, ['确认提交'], 9000);
  if (!r3) throw new Error('未找到「确认提交」');
  await sleep(4500);

  const after = await page.locator('body').innerText().catch(() => '');
  if (/发布失败|提交失败|系统繁忙/.test(after.slice(0, 600))) throw new Error('页面提示失败');
  return true;
}

(async () => {
  const count = parseInt(opt('count', '1'), 10);
  const from = parseInt(opt('from', '1'), 10);
  const aiYes = (opt('ai', 'no') || 'no') === 'yes';
  const prog = loadProg();

  const order = Object.keys(MAP).map(Number).sort((a, b) => a - b)
    .filter(n => n >= from && !prog.done.includes(n))
    .slice(0, count);

  if (!order.length) { log('没有待提交章节'); return; }
  log(`本次提交 ${order.length} 章：第 ${order[0]} — ${order[order.length - 1]} 章｜AI=${aiYes ? '是' : '否'}`);

  const b = await chromium.launch({ headless: false, args: ['--headless=new', '--disable-blink-features=AutomationControlled'] });
  const ctx = await b.newContext({ storageState: path.join(HERE, 'state.json'), viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();

  for (let i = 0; i < order.length; i++) {
    const num = order[i];
    log(`—— 第${num}章`);
    let ok = false;
    let lastErr = null;
    for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
      try {
        await submitOne(page, num, aiYes);
        ok = true;
      } catch (e) {
        lastErr = e;
        if (attempt < 3) {
          log(`   · 第${attempt}次失败（${e.message}），8s 后重试`);
          await sleep(8000);
        }
      }
    }
    if (ok) {
      prog.done.push(num);
      saveProg(prog);
      log(`   ✓ 已提交，累计 ${prog.done.length}/175`);
    } else {
      log(`   ✗ 三次均失败：${lastErr.message}`);
      prog.failed.push({ num, err: lastErr.message, at: new Date().toISOString() });
      saveProg(prog);
      await page.screenshot({ path: path.join(HERE, `提交失败_第${num}章.png`), fullPage: true });
      break;
    }
    if (i < order.length - 1) {
      const w = rand(6000, 14000);
      log(`   等待 ${Math.round(w / 1000)}s`);
      await sleep(w);
    }
  }
  await b.close();
  log('本轮结束');
})().catch(e => { console.error('出错:', e.message); process.exit(1); });
