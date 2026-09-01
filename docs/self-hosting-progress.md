# FreeWorkBuddy Self-hosting 交接文档（进度快照）

> 用途：接手 self-hosting 改造的任何人（或下一轮 agent 会话）从这里继续。
> 计划正本：[`self-hosting-implementation-blueprint.md`](./self-hosting-implementation-blueprint.md)
> （目标、基线、工作流 A–K、§3.18 分阶段、§3.19 PR 拆分、§3.21 风险清单）。
> 状态基准日：2026-09-01。分支：PR #2（`feat/freeworkbuddy-capability-ui`）已开，PR #1 已合并。

## 一、整体进度（对照蓝图 §3.19 PR 拆分）

| §3.19 | 项 | 状态 | 载体 |
|---|---|---|---|
| 1 | 实施蓝图 + docs index | ✅ 已合并 main | PR #1 `1c70079c` |
| 2 | Contract registry + 域名台账 + CI guard | ✅ 已合并 | PR #1 `0596c3c5` |
| 3 | DistributionProfile schema + 官方回归 | ✅ 已合并 | PR #1 `f46b913a` |
| 4 | 独立品牌 + Desktop identity（构建链） | ✅ 已合并 | PR #1 `a95eebba` |
| 5 | Mobile identity | ✅ 已合并（fingerprint 实测不变，冷更确认记录在 commit） | PR #1 `aecf89b6` |
| 6 | embedded/remote bootstrap + self-host 信任根 + 单 realm | ✅ 已合并 | PR #1 `6a372a14` |
| 7 | 单 realm auth routing | ✅ 核心并入 #6；issuer/realm 原子绑定随 Phase 2 server | — |
| 8 | Capability snapshot 管道（main→preload→renderer） | ✅ 已合并 | PR #1 `2135dbcf` |
| 9 | 逐域迁移 gate | ✅ main 边界半边已合并 `fc4c7ad9`；变化推送/hook/updater 闸在 PR #2 `222d1c96d`；**UI 入口逐域隐藏未完成** | PR #1 + PR #2 |
| 10 | 去官方默认值 | ◐ no-egress 运行时验收 ✅ `8a997c2b`；TapDB 发行闸 ✅ `2d523dd2`；legalLinks profile 化在 PR #2；**community/support/下载默认值文案未清** | PR #1 + PR #2 |
| 11 | Local-first 收口 | ◐ packaged/断网/no-egress macOS 已实测；**三平台 UAT 未做**；**数据 import adapter 进行中（见下）** | — |
| 12–20 | 服务端仓 + Phase 2/3 | ❌ 未开始（独立仓 `freeworkbuddy-server` 尚未创建） | — |

已合并 main 的 commit：`92c234679`（merge PR #1）。PR #2（capability 推送/hook/updater 闸）**未合并**。

## 二、当前 WIP（必须先读完再动代码）

**数据 import adapter（蓝图 §3.16，第 11 项核心）——已写代码、未完成**，工作树里有未提交文件：

```
apps/desktop/src/main/legacyImport/
├── discover.ts       # 旧官方 userData 只读发现（symlink 拒绝/路径边界/体积上限/mtime 防伪）
├── importAdapter.ts  # schema 桥接导入（PRAGMA 交集列、事务 + INSERT OR IGNORE 幂等、readonly 打开旧库）
└── ipc.ts            # legacy-import:discover / :execute 两个 channel
```

**未完成的事项（接手者按序做）**：
1. importAdapter 的 better-sqlite3 是通过 `createBetterSqliteDatabase`（localDb 工厂）打开的，`npm test` 未验证 —— 需要单测（fixture：手工建最小旧库 sqlite + 新库 sqlite，验证交集列导入、幂等（跑两遍行数不变）、表缺失、超预算回滚、symlink/体积拒绝）。
2. `registerLegacyImportIpc()` 尚未在 bootstrap-electron 注册（应放在 `registerAppCapabilitiesIpc()` 之后）。
3. 设置页入口卡片未做（发现列表 → 勾选 → 执行 → 结果展示；文案遵循「显式 import、失败保留旧数据」）。
4. 交接红线（蓝图 §3.16）：不导入 token/组织 session/model grant/hook binding/push registration；BYOK 重新录入；诊断不含消息正文；失败保留旧数据。

## 三、关键技术决策（已定，勿推翻）

1. **发行维度**：`CINDY_DISTRIBUTION_PROFILE` env（缺省=官方路径逐字节不变；`freeworkbuddy-selfhost` = FreeWorkBuddy）。单一选取入口 `resolveDistributionProfile`（maker-shared `./distribution-profile`）。
2. **FreeWorkBuddy 身份值**：`me.freeworkbuddy.ios/.android/.desktop`、scheme/userData/凭据 namespace = `freeworkbuddy`、companyName=`leyuan0602-glitch`、法律 URL 占位 `https://freeworkbuddy.me/{privacy,terms}`（Phase 2 部署时替换真实路径）。
3. **realm**：self-host v1 内部 `authRealm='global'`、`crossRealmOrgLoginEnabled=false`；官方 cn/global 双 realm 行为不变。
4. **capability**：17 键 taxonomy（maker-shared `DISTRIBUTION_CAPABILITY_KEYS`），四层计算 = build ∧ distribution defaults ∧ endpoint present ∧ session。main 是真相源；renderer 只消费布尔投影（`useAppCapabilities`，判断用 `=== false`）。
5. **打包**：本机 `electron-forge package`（先 `node scripts/build-remote-bundles.mjs`，`NODE_OPTIONS='--max-old-space-size=8192'`，renderer OOM 大户）。产物先 macOS。
6. **验证入口**：`pnpm smoke:no-egress`（no-egress 运行时验收：官方请求=0 + 全部请求域已登记）；`node scripts/smoke-packaged.mjs`（schema smoke）。

## 四、已修复的重要 bug（背景知识）

- **packaged 启动竞态**：bootstrap chunk（18MB）动态 import 期间 ready 事件已发出，`app.on('ready')` 注册晚于事件 → 回调永不执行 → 包静默卡死。已改 `app.whenReady()`（`8a997c2b`）。dev 不拆包无此问题。
- `ENDPOINT_UNAVAILABLE`：空 baseUrl 在 `serverApiClient.rawFetch` 受控拒绝（503），是全部自建 server 调用的单点 gate。

## 五、已知遗留问题

1. `BillingPage.test.tsx` 2 例失败 = **基线既有**（stash 对照验证过），与本改造无关；desktop threads pool 偶发 SIGSEGV（环境问题，forks pool 可复跑）。
2. `pnpm check:dco` 在从 main 切出的分支上会误报（对比 upstream/main 老 merge-base 把全仓历史算进去）；以 PR 的 DCO App 为准。
3. no-egress audit 的 `app.exit(0)` 在长启动链下可能不立即收敛（脚本有 SIGKILL 兜底 + 报告已落盘，验收功能完整）；优雅退出链是独立遗留问题。
4. **GitHub Actions 额度耗尽**：`client-ci`、`pr-code-review` 两个 workflow 已通过 API 禁用（fork 仓设置），`pr-design-basis` 保留。所有门禁改为本地跑（见下）。恢复 CI 需 owner 配置 secrets 或换自托管 runner。

## 六、本地验证命令（替代 CI 的等价门禁）

```bash
pnpm test:unit                    # 全量单测（已知 2 例基线失败除外应全绿）
pnpm --filter desktop typecheck   # 0 errors
pnpm --filter mobile typecheck    # 0 errors
pnpm test:runner                  # 511 pass（scripts 层门禁自测）
pnpm check:network-contract       # 契约 registry 双向校验
pnpm check:self-host-egress       # 域名台账校验
pnpm check:dco                    # DCO（注意第五节第 2 条误报）
# 打包 + no-egress 验收（macOS）：
cd apps/desktop && node scripts/build-remote-bundles.mjs
CINDY_DISTRIBUTION_PROFILE=freeworkbuddy-selfhost NODE_OPTIONS='--max-old-space-size=8192' \
  pnpm exec electron-forge package --platform darwin --arch arm64
node scripts/no-egress-smoke.mjs --platform=darwin --arch=arm64
```

## 七、分支与 PR 约定

- 全部工作经 PR 进 main（`gh pr create --repo leyuan0602-glitch/freeworkbuddy`）。
- PR #1（蓝图+Phase1 前半，10 commits）已合并；**PR #2**（capability 推送/hook/updater 闸）OPEN，等 merge。
- 本 import adapter WIP 建议直接在 PR #2 分支追加 commit（同属 Phase 1 收口）或按需另开。
- commit 一律 `git commit -s`（DCO）。
- ⚠️ 签名约定（2026-09 修正）：sign-off 由 `-s` 自动生成（与 repo config 的
  author 一致，`leyuan0602-glitch <leyuan0602@gmail.com>`）。**不要在 commit
  message heredoc 里手写 Signed-off-by trailer**——此前手写的 `yuan
  <yuan@leyuan.glitch.local>` 与 author 不一致，是多余噪音（DCO App 判定看
  任一匹配 author 的 trailer，故已推 commit 合规；新增 commit 勿再手写）。

## 八、剩余工作清单（按优先级）

1. **完成 import adapter**（本 WIP：测试 → 注册 IPC → 设置页卡片）——第 11 项核心。
2. **UI 入口逐域隐藏**：按 `useAppCapabilities`（`=== false`）迁移 Settings 各卡片；已知 SkillHub market 有组织门禁天然 fail-closed；updater banner 由 updateMode 闸天然关闭。
3. **legal/support/社区链接默认值清理**（legalLinks 已 profile 化；About/Help 的官网/下载链接待接 `CURRENT_DISTRIBUTION_BRAND.websiteUrl`，空则隐藏）。
4. **三平台 packaged UAT**（Windows/Linux 需对应环境或 CI runner——Actions 额度未恢复前需外部方案）。
5. **服务端仓 `freeworkbuddy-server`**（§3.19 12-20：scaffold → Auth Core → device registry/relay → media/push → Mobile 集成；Compose、备份、监控）——Phase 2，独立立项。
