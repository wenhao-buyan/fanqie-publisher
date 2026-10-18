/**
 * 番茄小说 本地批量发文工具（v2）
 * ------------------------------------------------------------
 * 已按实际后台校准的流程：
 *   打开发布页 → 填章节号/标题/正文 → 下一步
 *   → 弹窗「发布提示（错别字）」→ 提交
 *   → 弹窗「请选择内容检测方式」→ 仅基础检测
 *   → 弹窗「发布设置」→ 是否使用AI 选「否」→ 确认提交
 *
 * 用法（在 番茄上传包 目录下，需先设 NODE_PATH）：
 *   node fanqie.js login              扫码登录（只需一次）
 *   node fanqie.js check              查已发章节，防重复
 *   node fanqie.js status             看本地进度
 *   node fanqie.js publish --count 1           发 1 章（无头，不弹窗）
 *   node fanqie.js publish --count 1 --show    发 1 章（显示窗口）
 *   node fanqie.js publish --count 3 --ai yes  指定 AI 声明为「是」
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = 'https://fanqienovel.com';
const CFG = require('./config');
const BOOK_ID = CFG.BOOK_ID;
const BOOK_NAME = CFG.BOOK_NAME;
const PUB_URL = `${BASE}/main/writer/${BOOK_ID}/publish/`;

const HERE = __dirname;
const STATE = path.join(HERE, 'state.json');
const PROGRESS = path.join(HERE, 'progress.json');
const LOGIN_INFO = path.join(HERE, 'login_info.json');
const BOOK_TXT = CFG.TXT;

const argv = process.argv.slice(2);
const cmd = argv[0];
const has = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};

const log = (...a) => console.log(`[${new Date().toLocaleTimeString('zh-CN')}]`, ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

/* ---------------- 章节解析 ---------------- */
function parseBook(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  const re = /^第(\d+)章[\s\u3000]+(.+)$/;
  const out = [];
  let cur = null;
  for (const ln of lines) {
    const s = ln.trim();
    if (!s) continue;
    const m = re.exec(s);
    if (m) { cur = { num: +m[1], title: m[2].trim(), paras: [] }; out.push(cur); continue; }
    if (cur) cur.paras.push(s);
  }
  return out.map(c => ({
    num: c.num,
    title: c.title,
    body: c.paras.join('\n'),
    words: (c.paras.join('').match(/[\u4e00-\u9fa5]/g) || []).length,
  }));
}

/* ---------------- 进度 ---------------- */
const loadProgress = () => {
  if (!fs.existsSync(PROGRESS)) return { done: [], failed: [] };
  try { return JSON.parse(fs.readFileSync(PROGRESS, 'utf8')); } catch { return { done: [], failed: [] }; }
};
const saveProgress = (p) => fs.writeFileSync(PROGRESS, JSON.stringify(p, null, 2), 'utf8');

/* ---------------- 浏览器 ---------------- */
async function launch(show) {
  // 用完整 Chromium + --headless=new 实现无头，避免依赖未下载的 headless-shell
  const args = ['--disable-blink-features=AutomationControlled'];
  if (!show) args.push('--headless=new');
  const b = await chromium.launch({ headless: false, args });
  const ctx = await b.newContext({
    storageState: fs.existsSync(STATE) ? STATE : undefined,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  return { b, ctx };
}

/* ---------------- 通用点击 ---------------- */
/** 在 timeout 内反复找文本，找到可见的就点。返回点到的文本或 null */
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

/** 关闭新手引导浮层（首次进编辑器才有） */
async function closeGuide(page) {
  for (let i = 0; i < 4; i++) {
    const btn = page.locator('button:has-text("下一步")').first();
    if (!(await btn.count().catch(() => 0))) break;
    const box = await btn.boundingBox().catch(() => null);
    if (!box) break;
    if (box.x > 700) break;               // 顶部那个不是引导
    await btn.click().catch(() => {});
    await sleep(1000);
  }
}

/* ---------------- 发布设置里选 AI ---------------- */
async function chooseAI(page, useAI) {
  const want = useAI ? '是' : '否';
  // 策略1：弹窗内精确定位文本
  const loc = page.getByText(want, { exact: true });
  const n = await loc.count().catch(() => 0);
  for (let i = n - 1; i >= 0; i--) {
    const el = loc.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const box = await el.boundingBox().catch(() => null);
    if (box && box.width < 80) {          // 排除正文里的同名长句
      await el.click().catch(() => {});
      await sleep(600);
      return true;
    }
  }
  // 策略2：找「是否使用AI」同一行的 radio
  const ok = await page.evaluate((w) => {
    const all = [...document.querySelectorAll('*')];
    const lab = all.find(e => e.children.length === 0 && (e.textContent || '').trim() === '是否使用AI');
    if (!lab) return false;
    let row = lab.parentElement;
    for (let k = 0; k < 5 && row; k++) {
      const radios = [...row.querySelectorAll('input[type=radio], .arco-radio')];
      if (radios.length >= 2) {
        const target = w === '否' ? radios[1] : radios[0];
        target.click();
        return true;
      }
      row = row.parentElement;
    }
    return false;
  }, want).catch(() => false);
  await sleep(600);
  return ok;
}

/* ---------------- 发一章 ---------------- */
async function publishOne(page, ch, aiYes) {
  await page.goto(PUB_URL, { waitUntil: 'domcontentloaded' });
  await sleep(rand(4500, 6000));
  await closeGuide(page);

  // 章节号
  const numInput = page.locator('input.serial-input').first();
  await numInput.waitFor({ state: 'visible', timeout: 20000 });
  await numInput.click();
  await numInput.fill('');
  await numInput.type(String(ch.num), { delay: 80 });

  // 标题
  const titleInput = page.locator('input[placeholder="请输入标题"]').first();
  await titleInput.click();
  await titleInput.fill('');
  await titleInput.type(ch.title, { delay: 25 });

  // 正文
  const editor = page.locator('div.ProseMirror').first();
  await editor.click();
  await sleep(400);
  await editor.fill(ch.body).catch(async () => {
    const paras = ch.body.split('\n');
    for (let i = 0; i < paras.length; i++) {
      await page.keyboard.insertText(paras[i]);
      if (i < paras.length - 1) await page.keyboard.press('Enter');
    }
  });
  await sleep(1500);

  // 字数核对
  const pageTxt = await page.locator('body').innerText();
  const m = pageTxt.match(/正文字数\s*(\d+)/);
  const shown = m ? +m[1] : 0;
  if (shown && Math.abs(shown - ch.body.length) > 80) {
    log(`   ⚠ 字数差异：页面 ${shown}，本地 ${ch.body.length}`);
  }

  // 下一步
  await page.locator('button:has-text("下一步")').last().click();
  await sleep(3000);

  // 弹窗1：错别字提示 → 提交
  const r1 = await tap(page, ['提交'], 6000);
  if (r1) log('   · 错别字提示 → 提交');
  await sleep(2000);

  // 弹窗2：内容检测方式 → 仅基础检测
  const r2 = await tap(page, ['仅基础检测', '全面检测'], 6000);
  if (r2) log(`   · 内容检测 → ${r2}`);
  await sleep(2500);

  // 弹窗3：发布设置 → AI → 确认提交
  const aiOk = await chooseAI(page, aiYes);
  log(`   · AI 声明 → ${aiYes ? '是' : '否'}${aiOk ? '' : '（未找到选项）'}`);
  const r3 = await tap(page, ['确认提交'], 8000);
  if (!r3) throw new Error('未找到「确认提交」按钮');
  await sleep(4000);

  const after = await page.locator('body').innerText();
  if (/失败|错误/.test(after.slice(0, 400))) throw new Error('页面提示发布失败');
  return true;
}

/* ---------------- login ---------------- */
async function cmdLogin() {
  const { b, ctx } = await launch(true);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/main/writer/login`, { waitUntil: 'domcontentloaded' });
  log('浏览器已打开，请扫码登录（最多等 6 分钟）');
  const end = Date.now() + 6 * 60 * 1000;
  while (Date.now() < end) {
    await sleep(2000);
    if (!page.url().includes('/login')) break;
  }
  if (page.url().includes('/login')) { log('超时未登录'); await b.close(); process.exit(1); }
  await sleep(4000);
  await ctx.storageState({ path: STATE });
  fs.writeFileSync(LOGIN_INFO, JSON.stringify({ url: page.url(), at: new Date().toISOString() }, null, 2));
  log('登录态已保存');
  await b.close();
}

/* ---------------- check：读章节管理页 ---------------- */
async function cmdCheck(show = false) {
  const { b, ctx } = await launch(show);
  const page = await ctx.newPage();
  const url = `${BASE}/main/writer/chapter-manage/${BOOK_ID}&${encodeURIComponent(BOOK_NAME)}?type=1`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await sleep(6000);
  const txt = await page.locator('body').innerText();
  const nums = [...txt.matchAll(/第\s*(\d+)\s*章/g)].map(m => +m[1]);
  const uniq = [...new Set(nums)].sort((a, b) => a - b);
  console.log('线上已识别章号：', uniq.length ? uniq.join(', ') : '（无）');
  const wc = txt.match(/共\s*(\d+)\s*章/);
  if (wc) console.log('页面显示章节数：', wc[1]);
  await page.screenshot({ path: path.join(HERE, 'check.png'), fullPage: true });
  await b.close();
  return uniq;
}

/* ---------------- publish ---------------- */
async function cmdPublish() {
  const show = has('show');
  const count = parseInt(opt('count', '1'), 10);
  const aiYes = (opt('ai', 'no') || 'no').toLowerCase() === 'yes';

  const chapters = parseBook(BOOK_TXT);
  const prog = loadProgress();

  let online = [];
  try { online = await cmdCheck(false); } catch { log('线上检查失败，按本地进度走'); }

  const todo = chapters
    .filter(c => !prog.done.includes(c.num) && !online.includes(c.num))
    .slice(0, count);

  if (!todo.length) { log('没有待发章节'); return; }
  log(`总计 ${chapters.length}｜本地完成 ${prog.done.length}｜线上已有 ${online.length}｜本次发 ${todo.length}｜AI=${aiYes ? '是' : '否'}`);

  const { b, ctx } = await launch(show);
  const page = await ctx.newPage();

  for (const ch of todo) {
    log(`—— 第${ch.num}章 ${ch.title}（${ch.words}字）`);
    try {
      await publishOne(page, ch, aiYes);
      prog.done.push(ch.num);
      saveProgress(prog);
      log(`   ✓ 完成，累计 ${prog.done.length}/${chapters.length}`);
    } catch (e) {
      log(`   ✗ 失败：${e.message}`);
      prog.failed.push({ num: ch.num, err: e.message, at: new Date().toISOString() });
      saveProgress(prog);
      await page.screenshot({ path: path.join(HERE, `失败_第${ch.num}章.png`), fullPage: true });
      break;
    }
    if (todo.indexOf(ch) < todo.length - 1) {
      const w = rand(5000, 12000);
      log(`   等待 ${Math.round(w / 1000)}s`);
      await sleep(w);
    }
  }
  await b.close();
  log('本轮结束');
}

/* ---------------- status ---------------- */
function cmdStatus() {
  const chapters = parseBook(BOOK_TXT);
  const p = loadProgress();
  console.log(`书名：${BOOK_NAME}`);
  console.log(`总章数：${chapters.length}　总汉字：${chapters.reduce((s, c) => s + c.words, 0).toLocaleString()}`);
  console.log(`本地已发：${p.done.length}　失败：${p.failed.length}`);
  const next = chapters.find(c => !p.done.includes(c.num));
  if (next) console.log(`下一章：第${next.num}章 ${next.title}（${next.words}字）`);
}

/* ---------------- main ---------------- */
(async () => {
  switch (cmd) {
    case 'login': await cmdLogin(); break;
    case 'check': await cmdCheck(has('show')); break;
    case 'publish': await cmdPublish(); break;
    case 'status': cmdStatus(); break;
    default:
      console.log(`番茄批量发文（v2）

  node fanqie.js login                     扫码登录（一次）
  node fanqie.js check                     查线上已有章节
  node fanqie.js status                    看本地进度
  node fanqie.js publish --count 1         发 1 章（无头）
  node fanqie.js publish --count 1 --show  发 1 章（显示窗口）
  node fanqie.js publish --count 5 --ai yes
`);
  }
})().catch(e => { console.error('出错：', e.message); process.exit(1); });
