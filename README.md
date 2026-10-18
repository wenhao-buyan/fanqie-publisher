# fanqie-publisher

把整本小说批量发布到**番茄小说作家后台**的工具包。已实测跑完一本 175 章 / 24 万字的长篇。

## 它解决什么

番茄作家后台**没有**整本导入功能，只能一章一章手动粘贴。官方唯一的批量入口藏在草稿箱里：上传 `.docx`，按 H1 标题自动拆章——但有几条硬规则，踩不中就直接失败：

- 标题至少 5 个字
- **全书标题不能重复**（重名直接返回 `code:-3011`）
- 章节顺序按发布时间排，补发的章会跑到目录最前面，且后台没有排序功能
- 提交时会连弹三个对话框，错一个就发不出去

这个工具包把这些全部处理掉了。

## 流程

```
txt 全稿
  ↓ build_docx.py      转 docx（H1 标题 + 标题自检）
  ↓ upload.js          上传到草稿箱，自动拆章
  ↓ check_draft.js     抓 章号 → chapterId
  ↓ submit.js          逐章提交（AI 声明 / 内容检测 / 各种弹窗）
  ↓ verify.js          以线上数据核对，找漏章
```

## 快速开始

```bash
# 依赖
npm i playwright
pip install python-docx

# 配置
cp scripts/config.example.json scripts/config.json
# 填 bookId / bookName / txt / total

# 登录（只做一次）
node scripts/main.js login

# 生成 docx（会先检查标题长度和重名）
python scripts/build_docx.py

# 清空草稿箱（残留会导致 id 错位、重复标题）
node scripts/clear_drafts.js --go

# 上传
node scripts/upload.js ../书名_第1-175章.docx

# 抓 id 并提交
node scripts/check_draft.js
cp draft_rest.json chapter_map.json
node scripts/submit.js --count 30

# 核对
node scripts/verify.js
```

## 脚本

| 脚本 | 作用 |
|---|---|
| `build_docx.py` | txt → docx，H1 标题，含标题长度/重名自检 |
| `main.js` | `login` 扫码登录 / `check` 查线上章号 / `status` 看进度 |
| `clear_drafts.js` | 清空草稿箱（`--go` 才真删） |
| `upload.js` | 上传 docx 到草稿箱并保存 |
| `check_draft.js` | 抓草稿箱 章号 → chapterId 映射 |
| `submit.js` | 批量提交（`--count N --from N --ai yes`） |
| `verify.js` | 核对线上章节完整性与顺序 |
| `check_titles.js` | 查线上标题重复与占用 |

## 几条必须知道的

**章节顺序**：网页后台没有排序功能。补发的章节一定排在目录末尾。唯一补救是番茄作家助手 APP → 我的 → 帮助与反馈 → 章节编辑 →「发错章节顺序怎么办」，且**发布后 3 天内有效**。所以要么一次按顺序发完，要么接受顺序错乱。

**「是否使用AI」**：这是作者声明项，发布时必须勾选。本工具默认填「否」，请按实际情况在 `config.json` 里改。虚假声明的处罚是下架 + 封号。

**独家授权**：番茄签约要求独家。同一作品已在其他平台正式发布的，会被判非独家。

更多细节、报错对照表、界面交互的坑，见 [`references/pitfalls.md`](references/pitfalls.md)。

## 结构

```
fanqie-publisher/
├── SKILL.md                  # Skill 定义（WorkBuddy / Claude 可直接加载）
├── README.md
├── scripts/
│   ├── config.example.json   # 配置模板
│   ├── config.js             # 配置读取
│   ├── build_docx.py
│   ├── main.js
│   ├── upload.js
│   ├── check_draft.js
│   ├── submit.js
│   ├── verify.js
│   ├── check_titles.js
│   └── clear_drafts.js
└── references/
    └── pitfalls.md
```

## 免责

仅用于操作**自己账号**下的作品。请遵守番茄小说的平台规则与《用户协议》。自动化操作存在被平台风控识别的风险，请自行评估。作者不对因使用本工具导致的账号异常、内容下架等后果负责。

## License

MIT
