const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const HERE = __dirname;
const CFG = require('./config');
const BOOK_ID = CFG.BOOK_ID;
const BOOK_NAME = CFG.BOOK_NAME;
const URL = `https://fanqienovel.com/main/writer/chapter-manage/${BOOK_ID}&${encodeURIComponent(BOOK_NAME)}?type=2`;
const DOCX = process.argv[2] || path.join(HERE, '番茄上传_第24-26章_小样.docx');

(async () => {
  const b = await chromium.launch({ headless: false, args: ['--headless=new', '--disable-blink-features=AutomationControlled'] });
  const ctx = await b.newContext({ storageState: path.join(HERE, 'state.json'), viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  await p.waitForTimeout(8000);

  const know = p.getByText('我知道了', { exact: true }).first();
  if (await know.count().catch(() => 0)) await know.click().catch(() => {});
  await p.waitForTimeout(800);
  await p.waitForTimeout(3000);

  const before = (await p.locator('body').innerText()).match(/共\s*(\d+)\s*篇草稿/);
  console.log('上传前草稿数:', before ? before[1] : '未知');

  await p.getByText('上传章节', { exact: true }).first().click();
  await p.waitForTimeout(2500);

  const [chooser] = await Promise.all([
    p.waitForEvent('filechooser', { timeout: 15000 }),
    p.getByText('点击或拖拽文件到此上传').first().click(),
  ]);
  await chooser.setFiles(DOCX);
  console.log('已选文件:', path.basename(DOCX));
  await p.waitForTimeout(2500);

  await p.getByText('解析章节', { exact: true }).first().click();
  console.log('已点解析，等待拆章...');
  await p.waitForTimeout(30000);
  await p.screenshot({ path: path.join(HERE, 's1_parsed.png') });

  // 解析后的章节数（左侧列表）
  const navCount = await p.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/正文字数\s*(\d+)/);
    return m ? m[1] : '?';
  });
  console.log('解析后页面正文字数:', navCount);

  // 点「保存」
  const save = p.getByText('保存', { exact: true }).first();
  const hasSave = await save.count().catch(() => 0);
  console.log('保存按钮存在:', hasSave);
  if (hasSave) {
    await save.click();
    console.log('已点保存，等待写入...');
    await p.waitForTimeout(2500);
    // 可能弹「确定保存吗？章节序号重复」→ 点继续保存
    const confirm = p.getByText('继续保存', { exact: true }).first();
    if (await confirm.count().catch(() => 0)) {
      await confirm.click().catch(() => {});
      console.log('   · 已确认「继续保存」');
    }
    await p.waitForTimeout(20000);
  }
  await p.screenshot({ path: path.join(HERE, 's2_saved.png') });

  const tail = (await p.locator('body').innerText()).slice(-500);
  console.log('\n=== 保存后页面尾部 ===');
  console.log(tail.replace(/\n{2,}/g, '\n'));

  // 回草稿箱核对
  await p.goto(URL, { waitUntil: 'commit', timeout: 60000 });
  await p.waitForTimeout(8000);
  const k2 = p.getByText('我知道了', { exact: true }).first();
  if (await k2.count().catch(() => 0)) await k2.click().catch(() => {});
  await p.waitForTimeout(4000);
  const after = (await p.locator('body').innerText()).match(/共\s*(\d+)\s*篇草稿/);
  console.log('\n上传后草稿数:', after ? after[1] : '未知');
  await p.screenshot({ path: path.join(HERE, 's3_after.png'), fullPage: true });

  await b.close();
})().catch(e => { console.error('出错:', e.message); process.exit(1); });
