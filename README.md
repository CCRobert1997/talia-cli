# Talia CLI (`@talia/cli`)

用命令行(或让 AI 帮你)把备好的素材**批量搭成一个互动影游** —— 建节点、连分支、挂视频、配互动、发布,一条条命令或一句话搞定。**和 editor.taliaapp.com 用的是同一套引擎和规则**,所以 CLI 建出来的东西和编辑器里手搭的完全一致、绝不会造出"发布得出却玩不了"的坏数据。

> 适合:批量建树、从大纲一键生成、脚本化/可复现、让 AI 代劳。
> 不适合(仍去编辑器):**产视频**(CLI 不生成素材)、**精细摆放**(tap/热点的精确位置、按钮在画面上的构图对着真帧拖更准)、**最终预览眼校**。
> 最佳姿势 = **CLI 搭骨架 + 编辑器精修**。

---

## 1. 安装 & 登录

```bash
# 公开仓一键装(推荐,无需 npm 账号):
npm i -g github:CCRobert1997/talia-cli
# 装好后直接用:
talia <命令>

# 仓库内(内部/开发):
npm run cli -- <命令>
```
> 需要 Node 20+。下面示例统一写作 `talia <命令>`。

登录(用你的 Talia 创作者账号,和网页版同一个):
```bash
talia login you@example.com
talia whoami        # 确认已登录
```
你只能读写**自己**的项目(和网页版一样的权限)。

> **连哪个库**:不传环境变量时,CLI 默认连 Talia 生产库(内置的 project URL + 匿名 anon key 本就是公开的,RLS 把每次写入限定到登录者本人)。要连自建/其他实例,设 `SUPABASE_URL` / `SUPABASE_ANON_KEY`(或写 `~/.talia/config.json`)覆盖。
>
> **给 agent 用**:所有读命令(`whoami`/`projects`/`choices`/`vars`/`achs`/`assets`/`validate` 等)加 `--json` 输出一行 JSON(行数据);写命令加 `--json` 输出 `{"ok":true,"id":"…"}`。比解析自然语言稳。

---

## 2. 五分钟做一个 demo(视频已备好)

假设你有 3 段视频,想做一个"电梯相遇 → 举报 / 沉默 → 结局"的分支 demo。

**① 把故事写成一个大纲文件 `story.md`:**
```markdown
# 电梯相遇
- 举报她 -> 举报线
- 假装没看见 -> 沉默线
# 举报线
- 继续 -> 结局
# 沉默线
- 继续 -> 结局
# 结局
```
规则:`#` 标题 = 一个节点;`- 文字 -> 目标节点标题` = 一个选项(按标题连线)。**第一个节点自动设为开始。**

**② 一把建出整棵树:**
```bash
talia project new "电梯 Demo"        # 记下返回的 <项目ID>
talia import-outline <项目ID> story.md
# ✓ Imported 4 nodes, 4 choices, Start = "电梯相遇"
```

**③ 传视频并挂到节点上:**
```bash
talia asset upload <项目ID> elevator.mp4   # 返回一个 https://videos.taliaapp.com/... 链接
talia choices <某节点ID>                   # 忘了节点/选项 ID 时,用列表命令查
talia node set <节点ID> video <上一步的视频链接>
```
> 查节点 ID:在编辑器打开项目能看到;或先 `talia import-outline` 后用 `talia choices`/项目页对照。

**④(可选)配互动玩法**,比如让某个选项变成"找热点":
```bash
talia choice interaction <选项ID> '{"template":"hotspot_collect","hitGoto":"<目标节点ID>","defaultGoto":"<目标节点ID>"}'
# 热点会自动预置好、发布校验会保证它能玩;精确位置到编辑器里拖
```

**⑤ 校验 + 发布:**
```bash
talia validate <项目ID>    # 跑和编辑器一样的 13 条发布校验,列出问题
talia publish <项目ID>     # 通过后发布,玩家端即可见
```

**⑥ 去编辑器精修**:`editor.taliaapp.com` 打开项目,对着真帧拖热点、调选项皮肤/位置、Preview 眼校。

---

## 3. 大纲格式(`import-outline`)

```markdown
# 节点标题
- 选项文字 -> 目标节点标题
- 另一个选项 -> 另一个节点
# 另一个节点
...
```
- `#`~`######` 标题 → 一个节点(标题即节点名)。
- `- 文字 -> 目标标题` → 从当前节点出的一个选项,连到标题匹配的节点。
- 第一个节点 → 自动设为项目 Start。
- 目标标题找不到 → 该选项目标留空 + 给出警告(不报错,方便先搭骨架)。

---

## 4. 命令速查

| 分类 | 命令 |
|---|---|
| 账号 | `login [email] [password]` · `whoami` · `logout` |
| 项目 | `projects` · `project new <标题>` · `project rm <id>` · `project theme <id> <preset\|clear\|custom>` |
| 项目·主题背景 | `project theme <id> warm_dark`(6 预设)· `project theme <id> clear` · `project theme <id> custom "#RRGGBB,#RRGGBB" [dark]`(2-5 色) |
| 节点 | `node add <项目>` · `node set <节点> <title\|video\|image\|auto> <值>` · `node start <项目> <节点>` |
| 选项 | `choice add <节点> [文字] [目标]` · `choice set <choice> <label\|target> <值>` · `choice rm <choice>` · `choices <节点>` |
| 选项·呈现 | `choice present <choice> '{"skin":"preset:gilded","size":"l","font":"playfair"}'` |
| 选项·手势 | `choice tap <choice> <x> <y> <w> <h> [提示]`(归一化 0..1) |
| 选项·高级玩法 | `choice interaction <choice> '{"template":"hotspot_collect",...}'` |
| 变量 | `var add <项目> <名> <bool\|int> [默认值]` · `vars <项目>` · `var rm <id>` |
| 成就 | `ach add <项目> <名> <emoji> [描述]` · `achs <项目>` · `ach rm <id>` |
| 素材 | `asset upload <项目> <文件>` · `assets <项目>` · `asset rm <id>` |
| 建树 | `import-outline <项目> <file.md>` |
| 发布 | `validate <项目>` · `publish <项目>` |

**高级玩法模板**(`choice interaction` 的 `template`):`hotspot_collect`(找热点)/ `bullet_time`(限时躲避)/ `combo_rated`(连击)/ `wipe_reveal`(擦除揭示)/ `roaming_reticle`(游标瞄准)/ `timing_meter`(节奏条)。字段:`hitGoto`/`missGoto`/`defaultGoto`(节点 ID)、`params`(模板参数,如 `{"needK":3}`)。

**皮肤**(`choice present` 的 `skin`):`default` / `preset:outline` / `preset:gilded` / `preset:film` / `preset:romance` / `image:<r2链接>`。字体:`modak`/`playfair`/`bebas`/`oswald`/`pacifico`/`anton`/`noto_sans_sc`/`noto_serif_sc`/`ma_shan_zheng`/`long_cang`/`cairo`。尺寸:`s`/`m`/`l`。

---

## 5. 让 AI 代劳

CLI 人能敲,**AI/agent 也能敲**。所以你也可以直接对着 Claude 这类工具说:

> "把这 5 段视频做成一个三分支互动 demo,主角在电梯里决定要不要举报她"

让它帮你**生成大纲 + 跑上面这串命令 + 传素材 + 配玩法 + 校验发布**。你从"逐个点编辑器"变成"描述需求"。

---

## 6. 说明 & 注意

- **权限**:所有操作在你自己账号名下,只能动自己的项目(和网页版一致)。
- **别在正式作品上乱试**:`project rm` 会连级删除。测试请新建临时项目、用完删。
- **发布校验是主防线**:`validate` 有 error 就发不出去(比如空热点、选项没目标);按提示补齐。
- **视频/图片**:`asset upload` 传到 Talia 的 CDN 并登记;`node set video <链接>` 挂到节点。
- **精细视觉**去编辑器:CLI 适合结构和粗配,tap/热点的精确位置对着真帧拖更准。

有问题或想加命令,反馈给 Talia 团队。
