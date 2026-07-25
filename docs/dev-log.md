# 开发日志(dev-log)

> 用途:会话可能随时中断,新会话靠本文件 + `git log` 接手。每完成一个任务追加一行:内容 / commit / 遗留。
> 阅读顺序:先看本文件末尾的最新总结,再按需回溯 git log 与 docs/design-*.md。

## 2026-07-21(总管自治批次一:方案A检查点 + M1/M2)

- **方案 A 第一期(统一容器检查点)** / `dd6c03f` / 单一「+ 开始」入口、侧栏母子分组、裁决卡自动落回来源时间线、开会留痕、「就此开会/场边追问」命名;遗留:可点击会议卡、孤儿包台、存储归巢(见 docs/design-unified-container.md 第二期)。
- **A2 redact-patch 隐患修复** / `e748691` / 应用 diff 改用原始 `.patch.raw`,脱敏版仅展示;旧记录回退兼容;回归测试覆盖敏感形态内容逐字节落地。
- **A1 changes 层接线** / `6f767a7` / 动手登记 Revision(CAS 快照),applyBuild 过确定性硬门(基线漂移/快照篡改),应用落 applications.jsonl 审计;旧记录走旧行为。
- **B2 demo 管线适配新 UI(Codex 执行,零返工)** / `fffc71f` / record/config/storyboard 选择器与分镜全面适配;未录制:preflight 报 ELEVENLABS_API_KEY 未设置(证据存档)。
- **B1 模板格式预览(Codex 执行,零返工)** / `24e732a` / 选模板预览辩手/裁决格式,/api/config 补两字段(不含 injections),general 显默认提示;验收实测语言切换经整页重载不复现"预览不刷新",仍按指示在 setLang 补防御性 renderTemplatePreview 调用。
- 遗留清理:scratchpad/wt-b1 目录句柄被外部进程占用删不掉(worktree 注册已清,不影响仓库),待句柄释放后手工删。

## 2026-07-21(总管自治批次二:Codex-first,P2→P5)

(进行中,逐任务追加)
- **P2 分歧处置流(后端 P2a + 前端 P2b,均 Codex 执行,零返工)** / 见上两条 commit / 冲突清单+对比卡+仲裁两档全链路 E2E 验证(digest 前缀、两档产卡、decisions.jsonl 留痕、决断未授权时按钮禁用);161/161 全绿。设计决策:对比卡由仲裁单次生成(省调用+职责对齐);融合=特殊指派复用 build 通道(审批权天然归用户);竞争提案靠 A1 漂移硬门自然失效。
- **P3 统一容器第二期(P3a 服务端 + P3b 前端,均 Codex 执行,零返工)** / 见上两条 commit / 孤儿建会自动包台、时间线会议卡(started/verdict)可点击直达会场、手动回流按钮退场;E2E:独立建会→侧栏包裹台+嵌套会议→双卡→打开会场,163/163 全绿。决策:存储不归巢(平铺+origin 引用,零迁移);draft 预填链路保留(外部技能依赖)。
- **P4 模板实质差异化(Codex 执行,零返工)** / 见上条 commit / roleBriefs 席位制角色简报(consult 技术×商业、codev 架构×交付),提示词注入+预览「角色分工」节,165/165;UI 抽查 consult 显示双视角、general 隐藏。决策:席位制替代按 agent-id 的 injections(阵容不可预知),旧机制保留兼容。
- **P5 委派模式设计修订(我写,写完即止)** / 见上条 commit / 九任务实战复盘:四段式任务书方法论、五个卡点、产品形态四建议;实施待用户拍板。

---

# 总结报告(总管自治批次二收官,2026-07-21)

## 现场盘点结论(第 0 步)
在途改动仅方案 A 后端半成品(即 M0/P 前置,已续做);上一批四项无残留;在跑 codex.exe 为用户自己的会话,未动。B1 在指令下达前已完成提交(24e732a,含语言切换防御调用)。

## 各里程碑成果与 commit
- **P2 分歧处置流**:后端 25a4101 / 前端 1e5f602。冲突清单(无重叠默认接纳)、深入讨论 pro/con 对比卡(用户触发、仲裁生成)、仲裁两档融合(facilitate/decide,均产普通待批卡,应用权在用户),decisions.jsonl 留痕;E2E 全链路验证,161→163 测试。
- **P3 统一容器第二期**:服务端 0f98ec7 / 前端 00a11d6。孤儿会议自动包台、时间线会议卡(started/verdict)可点击直达会场、手动回流按钮退场(自动落卡为唯一机制,投放保留作再分发);163 测试。
- **P4 模板实质差异化**:71972b1。席位制 roleBriefs(consult 技术×商业、codev 架构×交付,对抗性设计),提示词注入+预览「角色分工」节;165/165。
- **P5 委派模式设计修订**:9a83457。九任务实战复盘,四段式任务书方法论,产品形态建议;写完即止待拍板。
- **收官 demo**:mock+免费 EdgeTTS 路线录屏链路全通(新 UI 分镜实拍成功,.work/timeline.json 留档),旁白合成因 Edge TTS 服务端故障失败(exit 13,unsettled await);原成品 demo.mp4/gif 未受影响。

## Codex 表现统计
本批 5 任务(P2a/P2b/P3a/P3b/P4)+ 上批 2(B1/B2),**共 7 任务全部零返工**。共性优点:边界遵守严格(禁区清单逐字执行)、沙箱受限时自行降级验证并如实报告;共性短板:workspace-write 沙箱禁 spawn,node --test 无法整跑,验收必须回主环境复跑(本批全部复跑通过)。

## 我拍板的决策清单(均可逆、未违铁律)
1. 对比卡由仲裁单次生成(省调用+职责对齐),而非各方自辩;
2. 融合=复用 build 通道的特殊指派(审批权天然归用户,零新增审批面);
3. 竞争提案不做显式失效状态机——靠 A1 基线漂移硬门在融合应用后自然拦截;
4. 存储不归巢:会议目录保持平铺+origin 强引用(零迁移风险);
5. draft 预填链路保留(roundtable-meeting 外部技能依赖);
6. 模板角色采用席位制内联简报,弃按 agent-id 的文件注入(阵容不可预知);
7. 收官 demo 不烧 ElevenLabs(花钱类)与真实模型额度(用户额度见底),走 mock+EdgeTTS。

## 搁置项
1. **成品 demo 旁白**:EdgeTTS 服务端故障;真人声版一条命令待跑(设 ELEVENLABS_API_KEY 后 `npm.cmd --prefix scripts/demo run demo`,zh/en 各一版),或等 EdgeTTS 恢复重试 --mock 预览版;
2. **委派模式实施**(P5 设计已备);
3. **diff 机制第③步余量**:聊天中自主产 diff(写开关行为化——权限位已存储待读取);
4. scratchpad/wt-b1 目录句柄残留(注册已清,句柄释放后手工删);
5. 冲突面板的「深入讨论」结果目前只进聊天流,未来可在面板内嵌摘要(小打磨)。

## 建议醒来先看什么
1. 重启 7777(侧栏会亮 ⟳ 横幅)后**亲手走一遍**:「+ 开始」建台 → 指派两个模型改同一文件 → 看冲突面板 → 深入讨论 → 仲裁融合 → 审批——这是本批的灵魂动线;
2. 再开一场 consult 会议感受技术×商业双视角的差异;
3. 看 docs/proposal-delegate-task.md 修订版,拍板委派模式是否立项;
4. 决定 demo 旁白方案(ElevenLabs 真人声 or 等 EdgeTTS)。

测试基线:165/165 全绿;三条铁律(零依赖/双语字典/审批权归用户)全程未破;全部 commit 未 push。
- **fix3 运维性 UX 三修(Codex 执行,零返工;累计第 8 个零返工任务)** / 见上条 commit / 引擎诊断面板(只读+指引)、工作区路径可改(含挂载/卸载与表单高亮)、会话内成员灯可点检;166/166,E2E 三场景验证。误报澄清:fix3.out 为 0 属正常(codex 输出走 stderr),判活看 .err 大小与 mtime。
- **fix4 四项 UX/配置(Codex 执行,零返工;累计第 9 个零返工任务)** / 见上条 commit / 参与者竖排、目录浏览弹窗+文件校验、引擎状态→Agent 改名、手工配置 Agent(编 agents.json 全文+热重载免重启);169/169,API+浏览器双层验收。设计决策:手工配置采用「编全文+形态校验+热重载」而非逐字段表单(最可靠、给足权力、免重启);安全上=用户本机可直接编辑的文件,不新增远程面。
- **fix5 工作区路径容错(Codex,零返工;第 10 个)** / 见 commit / 去引号规范化(四入口)+错误文案可操作化+「使用所在文件夹」一键修复;172/172,用户原样故障路径实测通过。根因:Windows「复制文件地址」带引号致 existsSync 假阴性。
- **fix6 原生目录对话框(Codex,零返工;第 11 个)** / 见 commit / POST /api/pick-folder 调起系统原生选择框(Win 现代 Explorer 样式,mac/linux 各有命令),自建列表降为兜底并修「陈旧错误行」与路径不可编辑;173/173,实弹验证拉起+单飞 409+降级+临时脚本清理。安全:路径只走环境变量、单飞、超时、finally 清理、仅 loopback。
- **fix7 原生对话框卡死修复(我自己做——用户被阻塞,直接动手最快)** / 见 commit / 根因:后台隐藏进程拉起的 GUI 抢不到前台,对话框藏在浏览器后面且占住 pickInFlight,只能重启服务。修法:TopMost 隐形宿主 Form 作 owner 强制置前 + /api/pick-folder/cancel 自救端点 + 前端 6 秒逃生口。173/173,实测前台切换与解锁均生效。教训:后台服务调起 GUI 必须显式处理前台焦点,且任何独占锁都要有 UI 可达的释放通道。
- **fix8 选文件夹要选两次(我自己做——用户被阻塞,且是 fix7 引入的回归)** / 见 commit / 根因:fix7 那个 TopMost 隐形宿主 Form 会让 `ShowDialog($owner)` 在**无人操作约 2.4 秒后自行返回 Cancel**(A/B 实测:owner 组 2384ms 退出、noowner 组仍在等待),用户还在翻目录对话框就没了,再点一次「浏览」于是命中 catch 兜底的旧式 FolderBrowserDialog——「两次、两种样式」的完整解释。修法:去掉 owner(对话框恢复正常停留),前台焦点改由 WinForms Timer 在模态消息循环内拿到窗口句柄后 `SetForegroundWindow` 一次搞定;另加 `$shown` 闸门,第一个对话框出现过就绝不再弹兜底框;`Split-Path` 换成不抛异常的 `[IO.Path]::GetDirectoryName` + 目录存在校验。验证:隐藏进程实弹 `ALIVE=True FG_IS_DIALOG=True`(停留与置前同时成立),且直接抽取 server.js 里的模板字符串复测一致;178/178。教训:排查此类"UI 自己消失"必须做 A/B 计时实测,不能靠读代码;以及,一个修复引入的副作用要用它自己的判据复验(fix7 只验了"能到前台",没验"能停住")。
- **fix9 ambient context 泄漏关闭(我自己做——用户指定主执行者)** / 见 commit / 根因:runner 的 envWhitelist 放行 USERPROFILE 等家目录变量,claude/codex 子进程照常发现 ~/.claude、~/.codex,全局 hooks/skills/插件/MCP/记忆全量装载(实测:claude 基线原始事件流含 superpowers/webnovel/网文项目状态;codex 基线吃下 cwd AGENTS.md canary 且用户 Stop hook 触发,一次调用 14.5k tokens)。探针结论:claude `--setting-sources project --strict-mcp-config` 实测 plugins:[]/mcp_servers:[]/用户技能清零且不碰 OAuth;`CLAUDE_CONFIG_DIR` 全新目录虽隔离但认证 403,否决;去 USERPROFILE 不隔离还断认证,否决。codex `--ignore-user-config` 实测认证保留、hooks 不触发、项目 canary 消失;但全局 AGENTS.md 与 skills 仍装载(`--disable skills` 不存在、`experimental_instructions_file` 无效)——如实标注 partial/not-enforced。修法:新增 src/profile.js(三档 cwdPolicy 受控枚举 scratch/readonly-materials/trusted-project + ALLOWED_ENV 环境重建 + 引擎隔离参数注入 + context_manifest.json 逐调用落盘);runner 强制显式 profile(缺 profile/传 env/传 cwd 一律抛错,无 ambient 回退);8 个调用点(委员会 call、工作台聊天/互聊/冲突分析/动手×2、健康检查、smoke)全部走同一入口;动手路径保留原生 session resume(不加 no-session-persistence),scratch 路径才加。测试 194/194(新增 profile.test.js 15 项:无 profile 拒启、伪 profile 拒收、env/cwd 拒传、canary 基线可测/装配后消失、scratch 清理、manifest 无秘密、child_process 旁路扫描)。E2E 经 WMI 拉起(绕开本会话代理变量污染)。定位影响:README「全局技能/记忆自动生效」卖点段已改写为「Roundtable 唯一装配者」——与旧铁律「不做技能屏蔽」相悖,系用户本次任务书明确指示。
- **v1 会议模板与 Skill 授权装配(我自己做——用户指定主执行者)** / 见 commit / 新增 adapters/capabilities.json(策划能力目录:id/名称/一行安全用途/版本/来源/风险六档/权限/阶段/装配方式)、adapters/meeting-templates.json(五模板 enabled/recommendable/blocked/permissions+writebackHistory)、capabilities/*.md(strategy-core 与四纪律本体,双语分节)、src/capabilities.js(compileCaps/disciplineBlock/suggestionMenu/parseCapSuggestions/capsManifest/writebackTemplate,全确定性无 LLM)。装配点:工作台 preamble(聊天/互聊/冲突/动手)+委员会 call() 单一漏斗(辩手/书记/仲裁天然共享同一授权,无法私自扩权);建议协议=确定性文本标记【建议能力:id|理由:…】,host 只解析→事件→等批准→重编译→记录;两阶段确认(本场授权≠模板写回,写回版本+1 留记录);manifest 扩 capabilities 小节(模板版本/strategy-core 哈希/启用/建议/拒绝/权限/授权史/诚实边界)。前端最小闭环:建台建会各一个能力模板选择器(默认 basic_strategy)、工作台 chip+面板(模板切换带能力/权限变化 confirm、写回独立 confirm)、建议卡(批准/拒绝,失败保留可重试)。Design Read:全复用现有语汇;UX 契约:按钮五态、错误不清会话、原生控件键盘可达、块级布局 360 安全。测试 206/206(新增 capabilities.test.js 11 项:默认模板/不按议题猜/模板外拒绝/未授权本体不进 prompt/建议→批准→才装配/写回版本化/控制链共享/manifest 无秘密/catalog 无祈使命令/codex 残余仍 best-effort)。铁律未破:零依赖/双语字典/审批权归用户/host 不做模型推理。
- **fix10 对话框压在浏览器后面(fix8 的置顶机制从未生效)** / 见 commit / 证据链:用户报「正在打开系统对话框…」卡住+逃生口出现;枚举窗口发现对话框 visible=True 但 TOPMOST=False(压在浏览器后),且 Process.MainWindowHandle=0——fix8 定时器靠 MainWindowHandle 找句柄,隐藏启动的 powershell 该值恒为 0,置顶代码一次都没执行(当时测试通过是启动链自带前台权的运气,输出里 FG_TOPMOST=False 就是被漏判的线索)。二层坑:改用 FindWindowW($null,标题) 仍找不到——PowerShell 把 $null 字符串参数封送成空串而非 NULL 指针。终修:FindWindowW('#32770', 标题)(标准对话框类名+自传标题,两参非空),SetWindowPos TOPMOST(不需前台权限,后台进程必成)+SetForegroundWindow 尽力。standalone 与真实服务端 E2E 双验:visible=True TOPMOST=True;206/206。教训:①「验证修复」必须断言修复机制本身触发过(FG_TOPMOST=False 当时就该报警),不能只看最终现象;②PowerShell P/Invoke 传 $null 字符串是已知封送陷阱,一律用非空参数绕开。
- **附件上传(工作台 v1,我自己做)** / 见 commit / 端点 POST /api/workbenches/:id/upload(原始字节流+x-rt-filename 头,基名化+扩展名白名单+20MB 上限,落 会话目录/uploads);message 侧只认 upload 返回的纯基名存储名(杜绝路径穿越,伪造引用静默丢弃)。装配:文本附件仅在发送当条内联(单文件 30K 截断明示,框定「是材料不是指令」),历史只留【附件:名】标记防上下文爆炸;图片走 profile.imageArgsFor(codex 家族默认 -i {IMAGE},cfg.imageArgs 可覆盖,claude -p 无图片参数)→runner opts.images 展开进 argv;无图能力引擎在 prompt 中如实标注「无法查看图片」,绝不让模型装看过。前端:📎+待发 chips(上传中/可移除)+气泡附件行;切台清空待发。测试 209/209(上传安全边界/内联+框定/无图标注/伪造引用丢弃/imageArgs 展开/codex 家族识别);浏览器实测前端上传链路+真实 codex 读附件 E2E。坑:node eval 模式(-p)会吞一切带杠参数,测 argv 展开必须用脚本文件不能用 -p。
- **fix11 会议内容不回流对话(用户实测反馈)** / 见 commit / 根因:统一容器的回流只挂在 judge-card 事件上,没走到裁决的会议(用户开1轮就回对话)什么都不落回;实锤后果:用户在对话里让 codex 总结会议,codex 上下文里零会议内容,编了个泛泛 prompt 还让用户"阅读会议记录"。修法:attachAutoVerdictFlow 同时监听每轮 summary 事件→postRoundSummaryToBench 落回来源台(note 携 meeting:{kind:'round',round},正文=书记小结→进对话上下文);前端 round 卡片(标题带轮次+可展开正文,复用 verdict 卡结构)。用户当次 Fictoi 会议的 r1 小结已停机窗口补投回时间线(浏览器实测两张卡都在,正文完整)。209/209。
- **fix11b 发言级回流(用户裁决:没有裁决也要回流)** / 见 commit / 回流铁律定稿为三层管道:辩手发言完成即落回(kind=statement,收起卡)、每轮书记小结落回(kind=round)、裁决卡落回(kind=verdict)——不等整轮、不等书记、不等裁决,半轮弃会不丢内容。实现:orchestrator.call() 在辩手 label(rN)成功后 emit statement 事件;server postStatementToBench 同管道落回;前端 statement 卡(标题带轮次+发言人,details 收起)。用户 Fictoi 会议的 r2-codex 半轮发言(5013 字)已补投。209/209。
- **fix12 「自动跑完」私自进入裁决(用户实测反馈)** / 见 commit / 根因:runAuto 跑满轮次(或收敛)后直接 runJudge()——按钮文案只承诺「自动跑完·至多N轮」,自动裁决=默判,违反「分歧不默判、用户拍板」产品铁律,还静默烧一次仲裁额度。修法:runAuto 只跑轮次,跑满/收敛后停在 paused,emit sys 明示两种到达原因与下一步选项(进入裁决/加轮/插话);会议视图补 sys 事件渲染(走状态条);裁决唯一入口=「进入裁决」按钮(原有)。测试:runAuto 后 state=paused、judge 未被调用、sys 指引存在、显式 runJudge 仍可用;209/209。
- **fix13 codex 在挂载会议中 exit:1 + 恢复丢挂载 + running 可误点(用户截图反馈,三修)** / 见 commit / ①根因:codex 信任检查「Not inside a trusted directory」——--skip-git-repo-check 此前只在 scratch 策略加,readonly-materials 挂载的材料目录(用户挂了 ~/.codex/skills 下的技能文件夹)非 git 仓库即拒启动;旧代码能跑是因为 cwd 恒在 Roundtable 仓库内蹭 git 信任。修:三档策略统一加该参数(worktree 是仓库,无副作用)。②连带发现:Committee.resume 签名不收 workspace→恢复后首次 saveMeta 把挂载信息抹掉,再恢复静默降级 scratch(manifest 与 metadata 矛盾即此)。修:resume/constructor 收 workspace,server 传 meta.workspace;用户存量会议的 metadata 已停机补回。③running/judging 时「下一轮/自动跑完/进入裁决」未禁用,点击弹 409 红条——state 事件驱动禁用。210/210(新增:readonly 策略含 skip 参数断言、resume 保 workspace 断言)。诊断路径:raw stderr 一句定案+manifest argv/cwdPolicy 对照 metadata 揪出矛盾——manifest 首次立功。
- **聊天↔会议双向交接 v1(我自己做——用户任务书指定主执行者)** / 见 commit / 正式委员会=显式跨界+轮末对称注入+版本化重审:消息行「→会议」四类型枚举(supplement_material/correct_fact/answer_question/change_goal_or_constraint)走结构化 API 进 pending 队列(host 零文本推断);运行中只入队,轮末批准后经 userNote 主持人通道注入——双方简报天然同一份全文(杜绝不对称);批准 correct_fact/change_goal 即标 verdict possibly_stale(绝不静默复原),rejudge 产新裁决版本、旧卡改名归档(judge-card-vN.md)+版本表;supplement_material 注入块带「此前结论形成于该材料加入之前」标注。承重墙(结构层):defuseControlMarkers 把用户文本/附件中的能力建议标记在入库前拆除引信(防「材料→模型回显→洗白成模型信道」攻击);无写权限的任务只落 authorization_request 进 deniedLog/manifest。回流卡补 role/outputType/verdictVersion/verdictState;工作台入站按 user_task/external_material/meeting_update 分类进 manifest;会议 manifest 记录跨界事件全量+stateVersion+裁决新鲜度。UI:消息行内四类型菜单、会议待纳入队列(running 时批准禁用)、possibly_stale 徽章+重新评审/暂不重审、附件「基于此材料建任务」显式预填。测试 221/221;Canary A(恶意材料零触发,ship-blocking)/B(越权任务只产授权请求)/D(轮内不见+轮末对称)全绿,C 由既有 worktree/按文件审批测试结构性保证。
- **委派恢复第 1 单:轮末待批提醒+全部批准(Codex 执行,1 轮返工)** / 见 commit / 返工原因不在 Codex:我给委派运行错带了 --ignore-user-config,把用户 config.toml 的 Windows 沙箱特性一并丢掉,workspace-write 未生效,apply_patch 被只读沙箱拒——Codex 正确报原文未越权。去掉该参数重跑一次通过。验收:diff 只动 app-committee.js+i18n.js 两文件,api() 返回 undefined 的网络错误契约读对了,串行批准+五态+失败保留可重试+meetingRunning 禁用全对;主环境 221/221。教训:隔离参数是给「会议参会者」的,委派运行是我的工具链,不共用一套参数;worktree 委派前必须同步未提交状态(git diff HEAD apply + 复制 untracked)。
- **OpenWorker 风格视觉对齐(Codex 执行,零返工;委派第 2 单)** / 见 commit / 接地方式:OpenWorker 开源,直接提取其真实 token(surfaces/gui/src/styles.css)而非对截图猜——契约「颗粒度」的上限打法。发现:Roundtable 与其本就同源(同款钴蓝/off-black),差距在①应用内主题切换(浅色一直存在但只跟随系统,用户从未见过)②双级灰/双级描边/soft 语义色成套③圆角 18→14/10 ④frosted 顶栏 ⑤用户气泡软中性填充。Codex 按 token 表逐值落地+38 处硬编码归一(留 7 处非语义投影,有理由)+pre-paint 防闪+auto/light/dark 三档循环。验收:221/221;计算样式机械复审(两档 token 逐值核对/圆角/blur/循环/零溢出)全过;截图复审因预览面板未展开改由用户亲验。契约边界守住:零外部资源、零布局改动、只抽 style contract。
- **会议界面布局改造:双轨对峙+决策侧栏+底部控制条(Codex 执行,零返工;委派第 3 单)** / 见 commit / 三等分三列→#arenaBody{#arenaMain(brief+双 track)+#arenaSide 可折叠决策侧栏}+#arenaCtl 底部毛玻璃控制条。侧栏收纳(顺序):staffStatus/summary/resummarize/judgecard/xoverQueue/chatPanel;未读机制(summary/judge-card/verdict-status/crossover 四类事件,侧栏关时计数,徽标+aria-live,用户发言不计);回应锚点(辩手在场边追问回用户时其轨道出现「回应你:首句」按钮,点击开侧栏定位消息);窄屏双轨堆叠+侧栏抽屉(scrim+Escape)。安全边界守住:mid 列 11 元素全迁移、31 个 id 无一改名、业务函数仅三处只加行小改、工作台/聊天零接触。验收:221/221;真实会议回放实测(轨道有内容/侧栏顺序/折叠主区扩展/未读计数与清零/360px 零溢出/抽屉+Escape)。遗留:归档回放时若侧栏关闭,历史事件会计入未读(轻噪音,下轮可在 attach 回放期间抑制计数)。
- **决策侧栏每轮小结独立可折叠+轮内分节(Codex 执行,零返工;委派第 4 单)** / 见 commit / 用户三连反馈:①侧栏小结此前每轮覆盖(textContent=ev.data),无历史→改为每轮一个 details(data-round 定位,重摘要替换不重复建条,最新展开旧轮收起);②轮内按书记固有结构(- 标题:)拆节可折叠(<2 节不硬拆,全 textContent 无 innerHTML);③顺带修复暗伤:归档会议此前只能看到最后一轮小结,现在回放逐轮重建全部历史。验收:221/221;真实存档回放实测 3 轮全部重建、标题正确、最新开旧收、分节可切换、pre 全部 pre-wrap+anywhere(样式级核查——浏览器面板零宽时 scrollWidth 是假信号,教训:视口相关断言必须先验 clientWidth>0)。
- **书记小结结构化渲染(Codex 执行,零返工;委派第 5 单)** / 见 commit / 前置核查改变了方案:真实书记输出是 ### 标题节+markdown 竖线表(比 prompt 字面要求富),内容已足够原子——按任务书第 5 条不动 Prompt,纯前端渲染。双形态解析(### 主/- X: 兜底/整体回退三层),真实列表化,唯一行内格式=还原模型自写 ** 加粗(不成对按字面),分歧表 5×4 结构化(类型=琥珀标签/处置=加重+「→下一步」列头/窄屏纵向信息组),六节语义标题(✓⇄▪?⚠→+语义色圆点,非纯色表达),每轮固定「查看原文」兜底。机器协议零接触(ev.data 只读,分歧块/问X:/字段序不产不改)。Codex 验证方式值得记:new Function 从源码抽出解析器做纯函数断言(真实 r2.md:6 节/5×4/78 行逐行在场/原文逐字相等),并自起本地 HTTP 夹具页跑真实渲染复审。验收:221/221;真实会议回放实测(六节图标标题/真实 li/44 处 strong/表 5 行/查看原文与原文逐字一致)。
- **小结每节恢复折叠+裁决卡结构化(Codex 执行,零返工;委派第 6 单)** / 见 commit / 两条用户反馈:①结构化改造把节做成静态标题→改回原生 details(视觉不变,32px 可点头,键盘原生可达);②裁决卡仍是 pre 拍平→复用同一解析渲染器(parseStructuredText/renderSection 提为共用,summary/judge 各传 profile,零复制粘贴),裁决卡语义表:✓一致(绿)/✎修正(主色)/⇄遗留分歧(琥珀+「待你拍板」pill)/⚠证伪(红)/→行动与下一步(主色);#judgecard pre 五处引用逐一迁到 #judgeRaw(复制按钮仍复制完整原文,与磁盘逐字相等);顺手修嵌套 * 子弹显示为字面星号的问题。验收:221/221;真实裁决卡回放实测(6 节图标齐/拍板标签在/节可折叠/copySource=2210 字原文)。
- **决策侧栏三形态:收起/标准/加宽(Codex 执行,零返工;委派第 7 单)** / 见 commit / 状态模型 closed/open/wide(localStorage 三态,旧 '1'/'0' 自动迁移);加宽档 flex:2.6+max-width:min(58vw,900px)(对齐 OpenWorker artifact rail 尺度),仅桌面生效、窄屏抽屉忽略;侧栏头部 ⤢/⤡ 切换钮(aria-pressed,150ms 过渡+reduced-motion);toggleArenaSide 保布尔语义薄封装(布尔 true 恢复上次非 closed 档)——锚点/Escape/scrim/reset 调用点零改;未读仅 closed 档计数。DOM stub 断言:三态循环/迁移/未读规则/reset 恢复全过;桌面 wide 规则与 1150px 压缩规则、窄屏覆盖三层齐备。221/221。

- 锁定执行线程 v1 后端安全核心（Codex 执行；委派第 8 单）/ 见 commit / 地基已存在（build+buildSessions=托管 CLI 原生执行线程），v1 加执行包+发送硬闸+外部投递+审计。CLI resume 实测：claude session_id/--resume；codex --json thread.started.thread_id、exec resume（--ephemeral 不可 resume）。交付 execpkg.js（evaluateSendGate 唯一发送判定纯函数）、exec-threads.js（managed/external+状态机拒 nl-parse 来源）、workbench.sendExecutionPackage（唯一发送入口）、server exec-send 端点（userAction!==true 前置拦截）、manifest executionThread（safeSessionId 前8位无秘密）。三层不变量：host（orchestrator 零发送路径+结构扫描测试）/runner（makeProfile trusted-project）/ACL（evaluateSendGate 独立范围检查，越界 needs_authorization 不执行，fullText 自然语言不影响判定）。canary A/B ship-blocking 真实通过；243/243。验收踩三漏拷坑+一实现缺口：误拷 test 进 src 污染白名单、漏拷共用夹具 mock-cli.cjs、defuse 需扩线程/工具/发送标记。教训：worktree 收回先 git status --short 列全改动逐一拷。

- 锁定执行线程 v1 前端面板（Codex 执行；委派第 9 单，v1 收官）/ 见 commit / 工作台右栏新增执行线程面板：锁定托管/外部线程、结构化表单编译执行包、展示完整 fullText+contentHash、勾选确认闸（改表单重编译则确认失效）、发送并执行/投递/复制降级/继续任务/新建干净线程、十态语义徽章+aria-live。后端只加读接口 execThreadSummary()（安全摘要，无完整 sessionId）+GET 详情暴露+exec-thread 刷新事件。前端 121 个 exec.* 双语词条。用户钦定右栏顺序：变更在上、执行线程在下——用 CSS order 调序（不动 DOM）。验收：243/243；浏览器端到端实测闭环全通（锁定托管线程→编译含 fullText+hash→未确认发送被拒 PACKAGE_UNCONFIRMED→确认后 hash 稳定），面板视觉顺序 top=72/422 确认变更在上。收尾清理临时台+委派孤儿进程（本轮起把孤儿清理纳入验收收口）。至此锁定执行线程 v1 全链路可用：会议裁决→编译执行包→用户确认→发锁定 CLI 线程→diff/测试回流，全程无复制粘贴。

- 合并派活入口:执行线程成为唯一派活门（Codex 执行；委派第 10 单）/ 见 commit / 用户指出「变更」里的执行者与「执行线程」重复（底层同一 build 引擎，两个派活门造成困惑）。方向 1：从变更面板移除快速派活控件（wbActor 下拉/wbTask 任务框/wbBuild 指派按钮/hint），保留角色权限行+冲突流+diff 审批列表+角色说明；原位置放低调指引「派任务请用下方执行线程面板」，点击展开并滚动到执行线程。后端一行不改。零残留引用（grep wbActor/wbBuild/wbTask/syncWbBuildLabel 空）。心智澄清：下面派活（执行线程）、上面收 diff 审批（变更）。243/243；浏览器实测派活控件全消失、保留物全在、指引可点展开执行线程。已知限制：执行线程只支持 claude/codex，非这两家的可写引擎失去 UI 派活入口（默认配置只有 claude/codex 有 writeArgs，不影响）；旧 demo 录制脚本仍引用旧选择器，重录时需迁移。

- 从结论一键起草执行（Codex 执行；委派第 11 单）/ 见 commit / 用户要「得出结论直接在线程执行」，之前需手动锁线程+填表。一键：execConclusionSeed()（裁决>轮次小结>对话摘要三优先级取结论）+exec-package 端点 fromConclusion:true 用种子填 objective+前端 execFromConclusion 按钮（自动锁定第一个可写 claude/codex 引擎→编包→展开滚动到预览，确认框复位）。安全红线：一键只到「已编包待确认」，静态旁路检查证明只调锁线程+exec-package，不碰确认端点/exec-send（Codex 自查+我复核）。无可写引擎/未挂 git→明确错误不崩。245/245（新增 execConclusionSeed 优先级测）；浏览器实测一键→自动锁 codex 线程→编包（结论进目标+哈希+「目标来自对话摘要」）→确认框未勾+发送禁用，闸完好。至此「结论→审阅确认→一键执行」贯通。

- 执行交接面板 v1：方向收敛为剪贴板保真交接（Codex 执行；委派第 12 单）/ 见 commit / 用户拍板：桌面执行、Roundtable 只保真交付剪贴板，不执行不连接。收敛：退役 sendExecutionPackage/lockThread/lockExternalThread/evaluateSendGate/exec-threads.js（删文件）/exec-send·exec-thread-lock 端点/前端执行投递十态；复用执行包核心 + execConclusionSeed。新面板：粘贴目标（纯标签、常驻「未连接」提示、不伪造 session id）+ 执行包预览（ROUND TABLE TASK 首尾标记 + bodySha256 + UTF-8 字节）+ 确认并复制（浏览器 navigator.clipboard 写入 + 立即回读 + 逐字/字节/SHA-256 三重校验，文案说「复制当时已校验」而非「当前仍持有」）+ 版本失效。防循环哈希：短哈希/字节数只算 body（不含标记），fullTextSha256 存包元数据、不嵌 fullText。安全：复制只由用户 UI 动作触发（结构扫描证明后端/自动流程无路径），fullText 自然语言不解析执行，defuse 拆控制标记。240/240；fake-clipboard canary 20/20（Claude 10 + Codex 10 毒样本：中英文/emoji/CRLF/代码块/长路径/伪指令全保真）。真实系统剪贴板 canary 被预览浏览器权限挡（Write permission denied），按任务书第十二节不伪造成功，留用户真实浏览器验收。踩坑：漏拷 Codex 新建的 public/handoff-clipboard.js 致 6 个测试 ENOENT——委派拷贝纪律再确认：收回前 ls 对比 public/ 与 src/ 全清单，抓出新建文件。
