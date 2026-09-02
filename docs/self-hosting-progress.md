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
| 9 | 逐域迁移 gate | ✅ main 边界半边已合并 `fc4c7ad9`；变化推送/hook/updater 闸在 PR #2 `222d1c96d`；UI 入口逐域隐藏 ✅ `867304a91`（登录/设置/标题栏/侧栏/SkillHub/插件市场） | PR #1 + PR #2 |
| 10 | 去官方默认值 | ✅ 主体收口：no-egress 验收 `8a997c2b`；TapDB 发行闸 `2d523dd2`；legalLinks profile 化；About 页更新开关/社媒面板已按 capability 隐藏 `867304a91`（LEGAL_LINKS 按法规要求保留） | PR #1 + PR #2 |
| 11 | Local-first 收口 | ◐ packaged/断网/no-egress macOS 已实测；import adapter ✅ `efee82b56`（代码+27 例单测+设置页入口）；**三平台 UAT 未做** | — |
| 12–20 | 服务端仓 + Phase 2/3 | ◐ **Phase 2 核心已开发完（本地 commit，未 push）**：scaffold `75cf669` / Auth Core `0db4baa` / device registry+relay+media+push `08df7a9`（`freeworkbuddy-server` 仓，11 测试文件 70 例全绿，typecheck/lint/build/guard 过）；Phase 3 可选云能力按蓝图留接口未实现；**packaged 实机联调未做** | 独立仓 |

已合并 main 的 commit：`92c234679`（merge PR #1）。PR #2（capability 推送/hook/updater 闸）**未合并**。

## 二、2026-09-01 本轮已完成（接手轮收口记录）

1. **数据 import adapter**（蓝图 §3.16，第 11 项核心）✅ 已提交 `efee82b56`（PR #2 分支）：
   `src/main/legacyImport/{discover,importAdapter,ipc}.ts` + `src/shared/legacyImport.ts` +
   设置页 `LegacyImportSection.tsx` + 27 例单测。红线（不导入 token/组织 session/model
   grant/hook binding/push registration）已按蓝图实现并有用例锁定。
2. **UI 入口逐域隐藏**（第 9 项收口）✅ 已提交 `867304a91`：全量清单见该 commit message。
   消费入口统一走 `useAppCapabilities`（`=== false`），既有可见性 helper 加可选 capability
   参数，官方构建行为不变。测试桥 `src/test/vitest/appCapabilitiesTestBridge.ts` 的
   `withAppCapabilities()` helper 供单测显式注入全 true 快照——**勿注册为全局 setupFiles**
   （threads 池 worker 上确定性 SIGSEGV，见第五节 5）。
3. **服务端 Phase 2 核心**（第 12-15 项）✅ 本地三 commit（未 push 到 GitHub）：
   scaffold `75cf669`（monorepo 骨架/health/migration runner/compose/守卫脚本）→
   Auth Core `0db4baa`（RS256 JWT+JWKS 轮换、refresh token family reuse 检测、
   bcrypt verification code、501 NOT_IMPLEMENTED 兜底）→
   device registry/relay/media/push `08df7a9`（upgrade 前 JWT、hello 协商、
   src 覆写、三限流、Redis 目录 fail closed、S3 presign）。API 入口接线：
   Bearer token → identity resolver fail closed。11 测试文件 70 例全绿。

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

1. desktop 单测存量基线失败（均 stash 对照验证过，先于 self-hosting 改造存在）：
   `BillingPage.test.tsx` 2 例；`piNativeProviders.test.ts` 套件损坏（`42ffcffce`
   给 host 模块加了 `getGrokAccessToken`，该测试的 grok mock 未同步）；
   `LoginPage.{harness,pr2a.harness,region.harness,regionPill}.test.tsx` 4 个套件损坏
   （`f8849d6ba` 让 legalLinks 进入 LoginPage 模块图后，这些文件的 brandRegion
   mock 工厂缺 `CURRENT_DISTRIBUTION_BRAND` 导出，模块求值即抛）。
2. desktop threads 池 SIGSEGV：**注册全局 setupFiles 后 100% 复现**（本机 Node 24 +
   vitest threads worker），去掉 setupFiles、改 per-test 显式注入后稳定；forks 池
   不受影响。勿再往 `vitest.config.ts` 加 setupFiles。
3. `pnpm check:dco` 在从 main 切出的分支上会误报（对比 upstream/main 老 merge-base 把全仓历史算进去）；以 PR 的 DCO App 为准。
4. no-egress audit 的 `app.exit(0)` 在长启动链下可能不立即收敛（脚本有 SIGKILL 兜底 + 报告已落盘，验收功能完整）；优雅退出链是独立遗留问题。
5. **GitHub Actions 额度耗尽**：`client-ci`、`pr-code-review` 两个 workflow 已通过 API 禁用（fork 仓设置），`pr-design-basis` 保留。所有门禁改为本地跑（见下）。恢复 CI 需 owner 配置 secrets 或换自托管 runner。

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

⚠️ 本机 node 版本坑（2026-09-01 实测）：本机的 `node_modules/better-sqlite3`
native binding 是按 node 24（NODE_MODULE_VERSION 137）编译的，而默认 PATH 里的
node 是 22（ABI 127）——任何加载 better-sqlite3 的单测（含 legacy import 全部
用例）在 node 22 下会直接 ABI 报错。跑 vitest 前先把 node 24 的 shim 目录放进
PATH：`PATH="/Users/yuan/.local/state/fnm_multishells/84059_1788176933773/bin:$PATH"`。
另外 `fs.utimesSync` 传数字时单位是**秒**不是毫秒（传 `Date.now()` 会把 mtime
顶到文件系统钳制的哨兵值），测试里要传 `Date` 对象。

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

1. **push 与 PR**：PR #2 分支现有 3 个新 commit（`efee82b56` import adapter、
   `867304a91` UI gate、本文档更新）未 push；`freeworkbuddy-server` 3 个 commit
   （scaffold/Auth Core/device+relay+media+push）未 push。push 时机由用户决定。
2. **三平台 packaged UAT**（Windows/Linux 需对应环境或 CI runner——Actions 额度未恢复前需外部方案）：含设置页 legacy import 真实导入演练、UI 入口隐藏的 self-host 构建目检。
3. **Mobile 侧同构 capability projection**（蓝图 §3.6 Mobile 部分，未做）。
4. **服务端 Phase 2 收尾**：Media/Push 的 S3/Redis 真实依赖部署联调、Auth Core 与
   客户端 self-host 信任根的端到端登录演练、备份/监控启用。
5. **Phase 3 可选云能力**（§3.19 17-20）：蓝图明确「按需、不进关键路径」，接口已留，暂不实现。
6. **存量基线失败修复**（第五节 1，与本改造无关，建议独立小 PR）：piNativeProviders
   grok mock 补 `getGrokAccessToken`；4 个 LoginPage 测试的 brandRegion mock 补
   `CURRENT_DISTRIBUTION_BRAND`（或改用部分 mock）。
