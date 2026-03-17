# TASKS

Task Management 技能的任务跟踪 — 一个看板 dashboard，用于维护 Claude Code 项目中的 TASKS.md 文件。

**编辑此文件前，请先阅读 `/octask` skill。**

## 核心基础设施

- [x] 任务创建与编辑 UI #task-create-edit-ui
    - 用 modal 或 inline UI 创建新任务，支持标题、描述、AC、阶段选择和 slug 自动生成。
    AC: 用户可从 dashboard 直接创建和编辑任务，无需手动编辑 markdown 文件。
- [x] Express 服务器与项目发现 #express-server
    - 端口 3847，从 `~/.claude/projects/` 发现有 TASKS.md 的项目，提供首页和各项目 dashboard。
    AC: 服务器启动后能列出项目并为每个项目提供 dashboard 页面。
- [x] TASKS.md 解析与渲染 #parser-renderer
    - 客户端解析器将 markdown 转为结构化数据，按分区和状态列渲染任务。
    AC: Dashboard 正确显示分区、描述和按状态分组的任务。
- [x] 拖拽更改状态 #drag-drop-status
    - 在 Ongoing/Pending/Done/Backlog 列之间拖拽卡片来更新 markdown 中的状态符号。
    AC: 拖拽卡片后自动更新内存模型并通过 PUT API 保存到磁盘。
- [x] Session 心跳与状态展示 #session-heartbeat
    - Hook 发送心跳（包含 session 状态和 PID），server 通过 PID 存活检测实现即时检测已关闭的 session。
    AC: 活跃 session 显示正确状态（idle/running/permission）；已关闭的 session 通过 PID 检测立即识别。
- [ ] 完善项目基础组织与开源规范 #project-housekeeping
    补齐 .gitignore、LICENSE、CONTRIBUTING.md、README.md 等开源基础文件；建立语义化版本号（semver）管理流程，确保 plugin.json / package.json 版本一致且有明确的更新策略。
    AC: 项目包含正确的 .gitignore（覆盖 node_modules、.DS_Store 等）、LICENSE、CONTRIBUTING.md；版本号在 plugin.json 和 package.json 中一致且遵循 semver。
## 打磨与可靠性

- [x] 状态视觉重设计 #status-visual-redesign
    - 为每种状态设计独特颜色和 SVG 图标（蓝色播放=ongoing，琥珀色时钟=todo，绿色勾选=done，石板色归档=backlog），替换统一圆点。
    AC: 每种状态有独特的颜色和图标，在 dashboard 各处一眼可辨。
- [x] 基于 PID 的 session 存活检测 #pid-liveness
    - 用 `process.kill(pid, 0)` 检测替代超时检测，无需 fallback。
    AC: 已关闭的 session 被即时检测，无 60s 延迟。
- [x] 转为 Claude Code Plugin #convert-to-cc-plugin
    将当前项目打包为 Claude Code plugin 格式，使其可通过 Claude Code 的 plugin 机制安装和使用，而非手动放置在 skills 目录。
    AC: 项目符合 Claude Code plugin 规范，用户可通过标准方式安装并正常使用 task-management skill 和 dashboard。
- [x] 重命名项目为更贴切的名字 #rename-project
    当前项目名 "task-management-plugin" 过于通用，需要一个更具辨识度、能体现看板 + Claude Code 集成特色的名字。涉及 repo 目录名、package.json、plugin.json、CLAUDE.md、README 等处的更新。
    CM: 重命名为 Octask（Octopus + Task）。更新了 plugin.json、marketplace.json、SKILL.md、server.js、dashboard.html、start-server.sh、post-install.sh、commands、sync-to-cache.sh、CLAUDE.md 等 14 个文件。skill 目录从 skills/task-management/ 移至 skills/octask/。Dashboard 标题用 "Octask Dashboard"，dashboard 内 header 保留 "Octask"。
    AC: 项目在所有用户可见处（CLI 输出、dashboard 标题、插件名）使用新名字，旧名字不再出现。
- [x] 项目路径解析修复 #project-path-resolve
    - 用正向编码匹配替代有损解码：从 jsonl 会话文件读取 `cwd` 字段，用 `encodeProjectPath(cwd)` 与目录名匹配。
    AC: 路径含连字符的项目（如 task-management）能被正确发现和展示。
- [x] 错误处理与边界情况 #error-handling
    - Server: writeFile 加 try/catch 防崩溃，新增 /api/health 端点，全局 Express 错误处理中间件。
    - Client: 持久错误横幅（断连检测+手动重连按钮），save 失败自动重试（指数退避，最多3次），loadProject 区分网络错误与服务端错误，parseTasksMd 加 try/catch 防崩溃，fetchSessions 断连时触发横幅，showStatus 支持 error 样式。
    AC: Dashboard 显示有意义的错误信息而非静默崩溃；能从瞬态故障中恢复。
- [x] 点击运行中的任务跳转 Ghostty Tab #ghostty-tab-focus
    - 在 ongoing 状态且有活跃 session（running/idle/permission）的任务卡片上，session 状态圆点可点击。后端 POST `/api/focus-ghostty-tab` 通过 AppleScript 在 Ghostty 的 tab bar 中查找包含 session customTitle 的 tab 并点击激活。
    AC: 点击 ongoing 任务的 session dot，浏览器调用后端 API，Ghostty 中对应 tab 被激活并前置。
- [x] Ongoing 状态动画优化 #ongoing-animation-rework
    - Running session dot 移除 pulse 闪烁，改为静态绿点。Running 卡片文本添加绿色 shimmer 光波（`background-clip: text` + `200%→-200%` 标准写法）。Permission dot 改紫色。
    AC: Running 状态的 ongoing 卡片文本有 shimmer 动画，session dot 有旋转动画，视觉上简洁不刺眼。
- [x] 在 Ghostty 中打开 ongoing item 对应的 Claude Code session tab #ghostty-open-ongoing-tab
    - 使用 Ghostty 1.3.0 原生 AppleScript API（`tell application "Ghostty"` → `focus (focused terminal of tab)`）替代 System Events UI hack。在 ongoing 任务卡片的 actions 区域添加 ghost 图标按钮，点击后聚焦 Ghostty 中对应 tab；未找到时显示 status notification。
    AC: 点击 ongoing 任务的 ghost 按钮，Ghostty 中对应 tab 被激活前置并显示成功通知；未找到时显示错误通知。
- [x] 自动监测文件修改 #watch-file-change
    使用 `fs.watch` + SSE 实现。Server 端新增 `/api/watch/:projectId` SSE 端点，用 `fs.watch` 监听 TASKS.md 变化并 debounce 300ms 后推送信号；Client 端用 EventSource 接收变化通知，无未保存编辑时静默刷新，有未保存编辑时显示 amber 通知横幅。自身保存后 500ms 内的变化事件被抑制。
    AC: 当外部文件出现变化的时候，DashBoard 会自动更新。这个操作通过一种资源占用不是很高，优雅的方式解决
- [x] 修复文件监测不稳定问题 #fix-unreliable-file-watch
    改为监听 TASKS.md 所在的目录而非文件本身。目录 watcher 不受 atomic write（temp+rename）影响，因为目录的 inode 不会改变。通过 `filename` 参数过滤只响应 TASKS.md 的变更。
    AC: 外部修改 TASKS.md 后 dashboard 能稳定自动刷新，无论文件是直接写入还是通过 rename 方式保存。
- [x] Overview 模块化重构与用量面板 #overview-modular-redesign
    当前 Overview 只有总进度条和各 section 进度条，视觉上比较平。重构为卡片式模块布局：每个功能区域用圆角矩形卡片包裹。第一个模块是现有的进度总览（总进度 + section 进度条）；新增第二个模块展示 Claude Code 用量信息。布局应支持未来扩展更多模块（如多项目概览）。
    CM: 重新设计了整个 sidebar 排版系统：字体大小从 5 级整合为 3 级（14/13/12/10px），统一字重（700 标题/400 元数据），修复 WCAG AA 对比度问题（--text-muted 从 #9c9b96 加深到 #6b6a65），进度条统一 4px，Usage 面板固定在底部带暖色背景，Progress 区域去掉卡片边框改为内联分割线。
    AC: Overview 区域由独立圆角卡片模块组成；进度总览和 Claude Code 用量分别在各自卡片中展示；视觉上整洁有层次感。
- [x] 同页面多项目切换 #multi-project-switcher
    在 dashboard 中添加项目切换器，无需跳转页面即可在多个项目间切换。侧边栏或顶栏显示已发现的项目列表，点击切换当前看板内容。支持快捷键快速切换。
    CM: 新增 `/api/projects` 端点（返回所有项目及任务统计），`/` 改为 302 重定向到首个项目。Sidebar 单项目卡片替换为多项目列表：未选中项目显示名字+迷你进度条，选中项目展开为白色卡片显示状态图标+section 列表。切换通过 pushState 更新 URL，断开/重连 SSE，重置状态。支持浏览器前进/后退。
    AC: 用户可在同一页面内切换不同项目的看板视图；切换时无整页刷新；当前项目有明确的视觉指示。
- [x] 隐藏已完成任务 #hide-done-tasks
    在 dashboard 中添加切换按钮，允许用户隐藏/显示 Done 列中的已完成任务。偏好持久化到 localStorage。隐藏时 Done 列折叠或显示计数摘要。
    CM: Done 列 header 添加 eye/eye-slash 图标 + Show/Hide 文字按钮，点击切换 body 显隐。偏好存 localStorage（key: octask-hide-done），默认隐藏。列宽保持不变，仅隐藏任务卡片内容。
    AC: 用户可一键切换已完成任务的显示/隐藏；刷新后偏好保留；隐藏时仍能看到已完成任务数量。
- [x] 移除 Phase 概念，替换为可选的 Section #remove-phase-concept
    将整个项目中的 "Phase" 和 "phase-gate" 概念替换为可选的 "Section" 分组。`##` 标题变为普通分区标题（无需 "Phase N:" 前缀），TASKS.md 允许没有任何 section（任务直接在顶级列表）。涉及 SKILL.md、template、dashboard 解析器/渲染器、commands、plugin 描述、evals 等 13 个文件。
    CM: 全量重命名 phase→section 跨 13+ 文件：SKILL.md 移除 phase-gate 叙事改为可选 sections；Goal:→Description:；template 简化为无 section 默认形式；dashboard parser 支持 __default section（## 之前的 tasks）；serializer 对 default section 不输出 ## header；sidebar 在无 named section 时隐藏列表；拖拽支持 drop above first section header → default section；drop indicator 改为 height:0 + ::after 避免布局闪烁；commands/evals/plugin descriptions 同步更新。
    AC: 所有用户可见处不再出现 "phase" 或 "phase-gate"；TASKS.md 支持无 section 的扁平任务列表；dashboard 正确解析和渲染两种格式。
- [-] 迁移到现代技术栈 #modernize-stack
    将运行时从 Node.js + npm 迁移到 Bun，利用其内置 bundler、test runner 和更快的启动速度。移除 Express 依赖，改用 Bun 原生 HTTP server。更新 package.json scripts、post-install hook 和 CI 配置。
    AC: 项目使用 Bun 运行和安装依赖；server 启动正常且功能不变；不再依赖 node/npm。
- [/] Dashboard 动画效果优化 #dashboard-animations
    优化 dashboard 的过渡动画：(1) 切换项目时任务卡片有淡入淡出效果；(2) 外部文件变更导致任务消失/出现时有过渡动画；(3) Done 列隐藏/显示时卡片有收起/展开动画。
    AC: 项目切换时卡片有平滑的淡入淡出过渡；外部文件变更刷新时任务的增减有视觉过渡；Done 列折叠展开有动画而非瞬间切换。
## 快捷命令

- [x] `/creating-task` 命令 #cmd-creating-task
    作为 `task-management:creating-task` 子技能。快速创建任务或分区到当前项目的 TASKS.md。接受标题和可选的分区/描述/AC 参数，自动生成 slug，插入到正确的 section 位置。创建 section 时生成 Description 段落。如果当前正在做这件事，直接标记为 `[/]`。Skill description 要"pushy"以确保触发率。
    CM: 创建 `commands/creating-task.md`。默认状态为 backlog，用户要求立即执行时标记 ongoing。包含重复检测、无 TASKS.md 时从模板 bootstrap、section 创建时建议最小任务集、表格式确认输出、中途触发后恢复先前工作。通过 skill-creator 流程迭代优化。
    AC: 用户调用 `/creating-task` 后，任务或分区被正确写入 TASKS.md 对应位置，格式符合 skill 规范。
- [x] `/starting-task` 命令 #cmd-starting-task
    作为 `task-management:starting-task` 子技能。根据当前对话上下文识别或创建对应任务，标记为 `[/]`，然后直接开始执行。如果用户指定了 slug 则匹配已有任务；如果没有则从上下文推断并创建新任务后继续工作。
    CM: 创建 `commands/starting-task.md` 子技能和 `.claude-plugin/plugin.json`。支持三种输入（slug/标题/空参推断），处理四种状态边界（todo/ongoing/done/backlog）。通过 skill-creator 流程跑了 3 组对照测试，backlogged 任务的安全警告是核心差异点——无 skill 时 baseline 会静默重开 [-] 任务。
    AC: 用户调用 `/starting-task` 后，TASKS.md 中对应任务被标记为 `[/]`，Claude 随即开始执行该任务；无需手动编辑文件。
- [x] Skill 规范增强：CM 字段与完成保护 #skill-cm-and-guard
    在 task-management skill 规范中增加两项规则：(1) `CM:` (completion memo) 字段 — AI 完成任务后必须在任务描述下追加一两句完成备注，记录实际做了什么、关键决策或意外发现；(2) 完成保护 — AI 不得擅自将任务标记为 `[x]`，必须在完成工作后提示用户确认，用户同意后才能标记。
    CM: 在 SKILL.md 中将 "Updating Tasks" 重写为 "Completing Tasks" 三步流程（添加 CM → 报告用户 → 用户确认后标记），Status Symbols 表中也同步更新了 [x] 的使用说明。template.md 增加了 CM 占位行。
    AC: Skill 文档明确要求 CM 字段和完成确认流程；AI 遵循规范时不会自行标记 `[x]`，而是先报告完成情况并等待用户确认。
- [x] Skill 规范补充：backlog 用法与 section 创建准则 #skill-backlog-phase-guidance
    在 task-management skill 中补充实践指南：(1) backlog `[-]` 适用于"好主意但时机未到"的任务，不是垃圾桶；首先确认一下，现在的 SPEAR 里面这些东西都没怎么描述
    CM: 重写 SKILL.md backlog 段落：明确 backlog 是已识别、值得做但未排入当前焦点的工作项，预期未来会被拉入执行；真正废弃的任务应删除。Section 创建准则因即将移除 phase/section 强制概念而跳过。
    AC: Skill 文档包含 backlog 使用场景说明和 section 创建门槛准则；AI 遵循规范时不会为单个小任务创建新 section。
- [x] 优化 creating-task 命令：先做后问 #creating-task-act-first
    当前 `/creating-task` 命令倾向于先询问确认再创建任务，且创建后展示冗长的表格。优化 skill 文本：(1) 模型应总是直接创建任务写入 TASKS.md，不要先问"要不要创建"；(2) 创建后用简洁的一两行确认代替表格输出；同时让默认要创建到 pending 而不是 backlog。然后也可以使用 Skill creator 稍微优化一下
    CM: 重写 creating-task.md：去掉确认询问门控，改为"直接写入再汇报"；默认状态从 [-] 改为 [ ]；输出从表格改为 1-2 行简述；步骤从 5 步精简到 4 步。新增 creating-task-evals.json 用于验证。
    AC: 调用 `/creating-task` 后模型直接将任务写入 TASKS.md 而非先询问确认；输出简洁无表格；通过 eval 验证行为改善。
- [x] 优化 starting-task 命令节奏控制 #starting-task-pacing
    当前 `/starting-task` 命令触发后模型倾向于立即冲进实现，缺少必要的理解和规划阶段。优化 skill 文本措辞，进行适当的简化了依靠模型的默认行为，而不要尝试过度 steer.通过 skill-creator改善效果。
    CM: 将 step 3 "Go"（含 "not a planning discussion"）替换为 "Understand, then execute" 三步流程（理解→计划→执行）。新增无匹配任务时引用 creating-task.md 创建任务的逻辑。添加 pacing 专项 eval。
    AC: 优化后的 `/starting-task` 命令在标记任务 ongoing 后，模型先展示对任务的理解和执行计划，而非直接开始修改代码；
- [ ] 拆分大文件优化代码结构 #split-large-files
    当前项目最大的文件（dashboard.html ~2300 行、server.js）过长，难以维护和 AI 编辑。拆分为更合理的模块结构，如将 dashboard 的 CSS、parser、renderer、drag-drop 等逻辑分离。
    AC: 最长文件不超过合理阈值；拆分后功能不变；模块间接口清晰。
- [ ] 拆分 marketplace 和插件为独立仓库 #split-marketplace-repo
    当前 marketplace 配置和插件代码混在同一仓库。拆为两个独立 repo：一个是插件本体（代码、skill、commands），另一个是 marketplace registry（marketplace.json、发布元数据）。插件 repo 通过 git URL 被 marketplace 引用。
    AC: 插件代码和 marketplace 配置分别在两个独立 git 仓库中维护；marketplace repo 通过 URL 引用插件 repo；两边可独立发版。
- [x] 全局 CLI 工具 #global-cli-tool
    使得技能在安装以后会暴露一个 pgdashboard 命令，运行这个命令就可以启动 dashboard 服务器
    AC: 在 claude 完成安装以后，pgdashboard 命令存在并且可以正确启动服务器。
- [/] 统一拖拽跨 section 逻辑与卡片排序逻辑 #unify-drag-section-logic
    当前"拖到 section header 上方进入 default section"的判定是独立于卡片排序的特殊逻辑，识别不够精准。应统一为同一套位置检测：应该把 section Head 和卡片视为同一种东西
    AC: 拖拽跨 section 移动与同 section 内排序使用同一套位置检测逻辑；拖到列顶部（第一个 section header 之上）能正确归入 default section；无额外的特殊分支代码。
