# Fork 设计文档:Vim 式键盘导航(Normal 模式 + Space Leader)

状态:设计定稿,待实现(P0 → P1 → P2)
关联特性:outliner 模式、标注列(@标注)、任务四态、层级(Hierarchy)、升格为子文档

---

## 1. 目标与非目标

**目标**

- 纯键盘完成日常工作流:块间移动、结构调整、任务/标注操作、文档与面板跳转
- vim 心智模型:Insert / Normal 双模态,`Space` 作 leader 键分发低频命令
- **零学习负担的可发现性**:leader 按下后底部弹出 which-key 提示条(LazyVim 式)
- 打字体验零侵入:Insert 态(正常编辑)的行为一个字节都不改

**非目标**

- 不做行内 vim(块内文本的 w/b/e 移动、dd/ciw 等)——块内编辑沿用系统输入习惯
- 不做 visual 模式(原生 ⌥⇧↑/↓ 扩选已够用)
- 不做 vim 寄存器/宏

---

## 2. 模式模型

### 2.1 定义

**Normal 态 = 编辑器中存在选中块**(`.protyle-wysiwyg--select`)。
不引入独立的模式标志位:原生 `Esc` 已实现"选中当前块",选中高亮就是模式指示,天然与
原生行为(多选、框选、gutter 选中)兼容。

| 切换 | 键 | 实现 |
|---|---|---|
| Insert → Normal | `Esc` | 原生已有(keydown.ts Escape 分支) |
| Normal → Insert(行首) | `i` | `focusBlock(block, wysiwyg, true)` |
| Normal → Insert(行尾) | `a` | `focusBlock(block, wysiwyg, false)`(接管原生 a=下方插块) |
| Normal → Insert(原生) | `Enter` | 原生已有 |
| 退出 Normal(不进编辑) | `Esc` | 原生已有(再按一次取消选中) |

### 2.2 多选语义

多块选中时:移动类命令(j/k/h/l)先把选区收敛为**首个选中块**再移动;
操作类命令(t/m/x/y/z)作用于**全部选中块**(与原生选中态操作一致)。

### 2.3 安全护栏(不拦截的情况)

以下情况 Normal 键表**完全不生效**,按键按原生逻辑走:

- `event.isComposing`(输入法组合中)
- 任意修饰键按下(⌘/⌃/⌥/⇧+字母不属于本键表;⇧ 例外:J/K/O/G/Z 是本键表的大写命令)
- 光标在嵌入块 / 数据库(av)/ 只读态(`protyle.disabled`)
- 焦点不在 `protyle-wysiwyg`(面板中的按键由面板自己处理,见 §6)

---

## 3. Normal 态键表

### 3.1 移动(P0)

| 键 | 语义 | 实现原语 |
|---|---|---|
| `j` | 下一个可见块 | 复用原生选中态 `↓` 分支(keydown.ts:214) |
| `k` | 上一个可见块 | 复用原生选中态 `↑` 分支 |
| `h` | 跳到父块 | `getParentBlock(block)` → 选中;顶层块 no-op |
| `l` | 进入第一个子块;折叠则先展开 | 折叠:`setFold`;子块:选中 li 内首个内容块 |
| `g g` | 文档首块 | `wysiwyg.firstElementChild` → 选中 + `scrollCenter` |
| `G` | 文档末块 | `wysiwyg.lastElementChild`(注意动态加载:P2 处理滚动加载边界) |

### 3.2 结构调整(P0)

| 键 | 语义 | 实现原语 |
|---|---|---|
| `J` / `K` | 块下移 / 上移 | 原生 moveToDown/moveToUp(⇧⌘↓/↑ 的处理函数) |
| `Tab` / `⇧Tab` | 缩进 / 反缩进 | 原生已支持选中态 |
| `z` | 折叠/展开 toggle | `setFold(protyle, block)` |
| `Z` | 递归折叠 | `foldBlocksRecursively` |
| `o` / `O` | 下方/上方插新块并进入编辑 | `insertEmptyBlock(protyle, "afterend"/"beforebegin")`(原生 a/b 保留为别名,文档只宣传 o/O) |
| `x` | 删除选中块 | 原生选中态 Backspace 分支(`removeBlock`),可 ⌘Z 撤销 |

### 3.3 工作流操作(P0)

| 键 | 语义 | 实现原语 |
|---|---|---|
| `t` | 任务四态循环(普通→TODO→DOING→DONE→普通) | `cycleTaskState(protyle, li)` |
| `m` | 编辑本行标注(@标注) | `openAnnotationEditor(protyle, block)`;编辑框关闭后焦点回到块(保持 Normal) |
| `y` | 复制块引用 | 原生 copyBlockRef(⇧⌘C)处理逻辑 |
| `/` | 全局搜索 | 原生 globalSearch(⌘P) |

### 3.4 保留原生、不重映射

选中态的 `↑↓←→`、`Backspace/Delete`、`⌘C/⌘X/⌘V`、`⌥⇧↑/↓ 扩选`、
数字/标点(无绑定的键一律 no-op 并吞掉,防止误入编辑)。

---

## 4. Space Leader 与 which-key 提示条

### 4.1 状态机

```
Normal ──Space──▶ Leader(空前缀)──g──▶ Leader(前缀 g)──h──▶ 执行 goto-home,回 Normal
                     │                     │
                     ├─ 合法叶子键 → 执行,回 Normal
                     ├─ 非法键 → 提示条抖动/红闪,停留在当前前缀
                     └─ Esc / 点击其他处 / 失焦 → 取消,回 Normal
```

- leader 状态是**全局单例**(window 级),因为部分命令跨面板(goto/focus 类)
- 无超时:提示条常驻直到执行或取消(LazyVim 行为)
- leader 激活期间吞掉所有键盘事件(capture),杜绝漏字入正文

### 4.2 which-key 提示条 UI

- **位置**:主窗口底部悬浮条(状态栏上方),全宽、单行为主,溢出换行
- **触发**:按下 `Space` 立即显示(无延迟——用户明确要求可见性优先)
- **内容**:当前前缀路径 + 可用键位表,分组着色:
  ```
  SPC ▸   g goto   p 升格为子文档   a 标注汇总   t 任务面板   z 聚焦   Z 退出聚焦
  SPC g ▸   h home(今日日记)   p 上级文档   c 子文档   f 文档树   o 大纲   b 反链   t 任务面板
  ```
- **实现**:单例 DOM(`#forkWhichKey`),`position: fixed; bottom: 28px`,
  主题变量配色(`--b3-theme-surface` 底 + `--b3-theme-on-surface` 字,键位用 primary 色)
- 执行/取消后立即隐藏

### 4.3 Leader 键表(P1)

| 序列 | 语义 | 实现 |
|---|---|---|
| `SPC g h` | **home:今日日记**(用户指定语义) | 原生 dailyNote 命令(⌃5 的处理函数,走配置的笔记本) |
| `SPC g p` | 上级文档 | 当前 doc `path` 上一段 → `openFileById` |
| `SPC g c` | 子文档:弹出子文档列表(j/k 选择,Enter 打开) | 复用层级栏数据(`listDocsByPath`),小浮层列表 |
| `SPC g f` | 聚焦文档树 | `getDockByType("file").toggleModel("file", true)` + focus |
| `SPC g o` | 聚焦大纲 | 同上 outline |
| `SPC g b` | 聚焦反链 | 同上 backlink |
| `SPC g t` | 聚焦任务面板 | `getDockByType("forkTasks")` |
| `SPC p` | 升格为子文档 | `promoteListItem(protyle, li)`(要求 Normal 且选中 li) |
| `SPC a` | 标注汇总面板 | `openAnnotationHub(app)` |
| `SPC t` | 任务面板开关 | `getDockByType("forkTasks").toggleModel(...)` |
| `SPC z` | 聚焦(zoom in)当前块 | 原生 enter(⌥→ 处理函数) |
| `SPC Z` | 退出聚焦 | 原生 enterBack(⌥←) |

保留区(不分配,留给后续):`SPC s`(搜索族)、`SPC n`(新建族)、`SPC 数字`。

---

## 5. 视觉反馈

- Normal 态:沿用原生选中高亮(`--b3-theme-primary-lightest` 底色),不额外加边框
- leader 激活:which-key 条本身即状态指示
- 非法键:which-key 条红色闪烁 120ms(不弹 toast,不打断)
- (P2 可选)底部状态栏加 `NORMAL` 徽标,评估视觉噪音后再定

---

## 6. 面板侧键盘化

| 面板 | 现状 | 计划 |
|---|---|---|
| 文档树 | 原生支持方向键/Enter | 聚焦入口走 `SPC g f`,不改内部 |
| 大纲/标签/反链 | Tree 组件,原生键盘支持有限 | P2:聚焦后 j/k/Enter 映射到 Tree 的 ↑↓/点击 |
| 任务面板(fork) | 无键盘 | P2:j/k 移动行高亮,Enter 跳转,r 刷新,Esc 回编辑器 |
| 层级栏(fork) | 无键盘 | 由 `SPC g c` 的浮层列表替代,层级栏本体保持鼠标 |

`Esc` 在任何面板中:焦点归还最近的编辑器(`getAllModels().editor` 最近激活者)。

---

## 7. 实现架构

```
app/src/protyle/forkVim.ts        ← 新增:Normal 键表 + leader 状态机 + 分发
app/src/fork/whichKey.ts          ← 新增:提示条单例 UI(挂 document.body)
app/src/protyle/wysiwyg/keydown.ts ← 挂钩:keydown() 顶部(isComposing 检查之后)
                                     调 forkVimKeydown(event, protyle),返回 true 则短路;
                                     原生选中态 a/b 分支保留但排在 forkVim 之后(被 o/O 文档取代)
app/src/assets/scss/protyle/_attr.scss ← which-key 条样式(或独立 _fork.scss,P1 时拆)
docs/fork/vim-mode.md             ← 本文档
```

**分发顺序**(keydown 内):isComposing 检查 → **forkVim**(仅 Normal 态/leader 态)→ 原生逻辑。
leader 态的全局捕获:`window.addEventListener("keydown", handler, true)`,激活时动态挂载、
结束即卸载,避免常驻捕获干扰其他对话框。

**复用清单**(全部现成,不新造原语):
`focusBlock` `getParentBlock` `getNextBlock/getPreviousBlock` `setFold`
`foldBlocksRecursively` `insertEmptyBlock` `removeBlock` `cycleTaskState`
`openAnnotationEditor` `openAnnotationHub` `promoteListItem` `getDockByType`
`openFileById` `zoomOut` + keydown.ts 既有的 moveToUp/Down、copyBlockRef、选中态 ↑↓ 分支。

---

## 8. 边界与已知取舍

1. **`o/O` 接管原生 `a/b`**:已确认。a 改为"编辑(行尾)",与 vim 对齐;原生插块语义由 o/O 承担
2. `G` 在动态加载长文档中只能到"已加载末块" —— P2 配合滚动加载处理
3. leader 命令大多与具体 protyle 无关(goto/panel);需要块上下文的(`SPC p`)在无选中块时红闪提示
4. Windows/Linux 键位一致(无 ⌘ 参与,天然跨平台)
5. 不提供自定义键表(fork 自用;将来需要再挂到 keymap 体系)
6. 与思源"漫游/聚焦"等模式共存:forkVim 只看"是否有选中块",不感知其他模式

---

## 9. 里程碑与验收清单

**P0 — Normal 核心**
- [ ] j/k/h/l 移动;gg/G;J/K 结构移动;z/Z 折叠;o/O 插块;i/a 进编辑;x 删除;t 任务;m 标注;y 复制引用;/ 搜索
- [ ] IME 组合中字母不被拦截;修饰键组合全部放行
- [ ] 验收:全程不碰鼠标完成"新建行→写字→Esc→jjk 移动→Tab 缩进→t 标 TODO→m 写标注→o 开新行"

**P1 — Leader + which-key**
- [ ] Space 弹提示条(无延迟),g 前缀二级表,非法键红闪
- [ ] SPC g h(今日日记)/ g p / g c / g f / g o / g b / g t;SPC p / a / t / z / Z
- [ ] 验收:提示条内容与实际绑定 100% 一致(从同一张表渲染,单一数据源)

**P2 — 面板与打磨**
- [ ] 任务面板 j/k/Enter/r/Esc;Tree 面板 j/k 桥接
- [ ] 数字前缀(3j);G 的动态加载兜底;NORMAL 徽标评估

---

## 附:P0 首次实现复盘(2026-07-10,已回退)

首版 P0(commit da5ba4aff,revert 于其后)在中文输入法环境下不可用,教训记录:

**根因**:Normal 态(选中块)时**光标仍在 contenteditable 内**,系统输入法处于接管状态。
中文 IME 下按 `k` 等字母键:
- keydown 首键的 `isComposing` 为 false,但 IME 已开始组合(候选窗弹出/keyCode 229/`key === "Process"`),
  `preventDefault` 无法可靠阻止 OS 层的组合行为
- 表现为按键时灵时不灵、候选框闪现、组合残留

**结论**:在 CJK 输入法常开的使用习惯下,"contenteditable 内拦截字母键"这条路线不成立。

**v2 架构方向**(重做时采用):
- 进入 Normal 态时**把焦点移出 contenteditable**(聚焦一个隐藏的 focusable 元素,或 `blur()` 后在
  document 层监听)—— IME 完全脱离接管,字母键干净到达
- 退出 Normal(i/a/Enter)时再把焦点/光标还给块
- 需要处理:焦点移出后原生选中态的按键分支(↑↓/Tab/Backspace)不再触发,须由 Normal 层自行分发;
  以及点击、滚动等把焦点意外还给编辑器的边界
