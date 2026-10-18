---
name: fanqie-publisher
description: 把本地小说批量发布到番茄小说作家后台（fanqienovel.com）。当用户需要把整本小说上传到番茄、批量创建章节、批量提交发布、核对线上章节是否齐全、或排查"重复标题""标题太短""章节顺序错乱""提交了但线上没有"等问题时使用。适用于几十到几百章的长篇连载一次性上架，也可用于补发漏章。
agent_created: true
---

# 番茄小说批量发布

把一份 txt 全稿变成番茄作家后台的已发布章节。核心难点不在写脚本，而在番茄的几条硬规则和一堆反直觉的交互细节——这些都已经踩平并写进脚本。

## 何时使用

- 用户要把整本小说传到番茄小说，章节数在几十章以上，逐章手动粘贴不现实
- 已经发了一部分，需要补发漏章、修章节顺序、清理重复草稿
- 用户报「提交了但后台没有这章」「提示重复标题」「标题至少输入5个字」

## 前置条件

- Node 18+，`npm i playwright`，Chromium 已下载
- Python 3 + `pip install python-docx`
- 番茄账号已完成实名认证（签约前必须）

## 工作流程

### 1. 写配置

复制 `scripts/config.example.json` 为 `scripts/config.json`，填四项：

| 字段 | 怎么拿 |
|---|---|
| `bookId` | 作家后台 → 作品卡片 → 右键「章节管理」复制链接，`chapter-manage/` 后面那串数字 |
| `bookName` | 后台书名，必须一字不差，注意有无标点 |
| `txt` | 全稿绝对路径 |
| `total` | 总章数 |

`useAI` 如实填。`titleFix` 先留空，跑完第 2 步再按报错补。

### 2. 生成 docx（会先自检标题）

```bash
python scripts/build_docx.py            # 全书
python scripts/build_docx.py 161 175    # 只做指定区间
```

脚本会把标题设为 H1、正文设为普通段落，并**先检查两类致命问题**：

- 标题不足 5 个字 → 番茄直接拒收
- 全书标题重名 → 接口返回 `code:-3011 本书中存在重复标题`

出现提示就把新标题写进 `config.json` 的 `titleFix`（格式 `{"章号": "新标题"}`），重跑本步。新标题要贴合正文内容，不要用「（上）」「补」这类敷衍后缀。

### 3. 登录（只做一次）

```bash
node scripts/main.js login
```

弹出浏览器，用户扫码。登录态存 `scripts/state.json`，**该文件含 cookie，绝不能提交到版本库**。

### 4. 清空草稿箱

```bash
node scripts/clear_drafts.js --go
```

草稿箱残留会造成两种事故：同名草稿导致上传时弹「章节序号重复」，以及旧草稿 id 与章号错位导致提交错内容。**每次批量操作前先清空。**

不加 `--go` 只查看数量，不删除。

### 5. 上传 docx

```bash
node scripts/upload.js ../书名_第1-175章.docx
```

脚本走：草稿箱 → 上传章节 → 选文件 → 解析章节 → 保存。若弹「确定保存吗」要点「继续保存」。

### 6. 抓草稿 id

```bash
node scripts/check_draft.js
```

输出 `章号 → chapterId` 映射到 `draft_rest.json`，供提交脚本使用。**草稿箱必须用 `?type=2` 直接访问**，点 tab 切换会拿到「章节管理」的数据。

### 7. 提交发布

```bash
cp draft_rest.json chapter_map.json
node scripts/submit.js --count 30
```

单批建议不超过 30 章，跑完核对一次再继续。脚本会处理：新手引导浮层 → 合规提示 → 错别字提示 → 内容检测方式 → AI 声明 → 确认提交。

### 8. 核对线上（必做）

```bash
node scripts/verify.js
```

翻完所有分页，输出线上章号顺序、缺失章号、顺序断点。**本地进度文件不可信**——番茄会在"看起来提交成功"的情况下丢章，只有这一步能发现。

## 关键约束

| 规则 | 后果 | 处理 |
|---|---|---|
| 标题 ≥ 5 个字 | 编辑器内联报错，发不出去 | `titleFix` 补长 |
| 全书标题唯一 | 接口 `-3011` 拒绝 | `titleFix` 改名 |
| 章节顺序按发布时间 | 补发的章排到目录最前 | 见下方说明 |
| 无批量导入入口 | 只能逐章建 | docx 上传 + 脚本提交 |
| 上传只吃 .docx | txt 传不进去 | `build_docx.py` 转换 |

**关于章节顺序**：网页后台没有任何排序功能，补发章节必然排在末尾。唯一的补救是番茄作家助手 APP → 我的 → 帮助与反馈 → 章节编辑 → 「发错章节顺序怎么办」，且**发布后 3 天内有效**。所以批量发布要一次按顺序做完，不要分批补。

## 脚本清单

| 脚本 | 作用 |
|---|---|
| `build_docx.py` | txt → docx，含标题自检 |
| `main.js` | `login` 登录 / `check` 查线上章号 / `status` 看本地进度 |
| `clear_drafts.js` | 清空草稿箱（`--go` 才真删） |
| `upload.js` | 上传 docx 到草稿箱 |
| `check_draft.js` | 抓草稿箱 章号→chapterId |
| `submit.js` | 批量提交（`--count N --from N --ai yes`） |
| `verify.js` | 核对线上完整性与顺序 |
| `check_titles.js` | 查线上标题重复与占用 |

详细的踩坑记录、报错对照表见 `references/pitfalls.md`，遇到异常先查那里。
