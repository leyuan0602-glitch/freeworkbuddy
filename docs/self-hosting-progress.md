# FreeWorkBuddy Self-hosting 交接文档（进度快照）

> 用途：接手 self-hosting 改造的任何人（或下一轮 agent 会话）从这里继续。
> 计划正本：[`self-hosting-implementation-blueprint.md`](./self-hosting-implementation-blueprint.md)
> （目标、基线、工作流 A–K、§3.18 分阶段、§3.19 PR 拆分、§3.21 风险清单）。
> 状态基准日：2026-09-03。分支：PR #2（`feat/freeworkbuddy-capability-ui`）已开，PR #1 已合并。

## 一、整体进度（对照蓝图 §3.19 PR 拆分）

| §3.19 | 项 | 状态 | 载体 |
|---|---|---|---|
| 1 | 实施蓝图 + docs index | ✅ 已合并 main | PR #1 `1c70079c` |
| 2 | Contract registry + 域名台账 + CI guard | ✅ 已合并 | PR #1 `0596c3c5` |
| 3 | DistributionProfile schema + 官方回归 | ✅ 已合并 | PR #1 `f46b913a` |
| 4 | 独立品牌 + Desktop identity（构建链） | ✅ 已合并 | PR #1 `a95eebba` |
| 5 | Mobile identity | ✅ 已合并（fingerprint 实测不变，冷更确认记录在 commit） | PR #1 `aecf89b6` |
| 6 | embedded/remote bootstrap + self-host 信任根 + 单 realm | ✅ 已合并；FreeWorkBuddy 当前从 `https://freeworkbuddy.me/endpoint.json` remote bootstrap | PR #1 `6a372a14` + 本轮收口 |
| 7 | 单 realm auth routing | ✅ 核心并入 #6；issuer/realm 原子绑定随 Phase 2 server | — |
| 8 | Capability snapshot 管道（main→preload→renderer） | ✅ 已合并 | PR #1 `2135dbcf` |
| 9 | 逐域迁移 gate | ✅ main 边界半边已合并 `fc4c7ad9`；变化推送/hook/updater 闸在 PR #2 `222d1c96d`；UI 入口逐域隐藏 ✅ `867304a91`（登录/设置/标题栏/侧栏/SkillHub/插件市场） | PR #1 + PR #2 |
| 10 | 去官方默认值 | ✅ 主体收口：no-egress 验收 `8a997c2b`；TapDB 发行闸 `2d523dd2`；legalLinks profile 化；About 页更新开关/社媒面板已按 capability 隐藏 `867304a91`（LEGAL_LINKS 按法规要求保留） | PR #1 + PR #2 |
| 11 | Local-first 收口 | ◐ packaged/断网/no-egress macOS 已实测；import adapter 已补 renderer grant、文件指纹复验与整库原子事务；**Windows/Linux packaged UAT 未做** | PR #2 |
| 12–16 | 服务端仓 + Phase 2 MVP | ◐ Auth、operator login、device registry、relay、media presign、单机 Compose 与静态 manifest 已实现；84 例服务端测试及 typecheck/build/lint/guard 通过；**真实 Compose、迁移/备份恢复、Mobile 双设备 UAT 未做** | 独立仓 |
| 17–20 | Phase 3 可选云能力 | ⏸ 按蓝图留接口，不进首发关键路径；对应 endpoint 保持空串且客户端 capability 关闭 | 独立仓 + 客户端 |

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

## 二点一、2026-09-03 安全与部署收口

1. **客户端 capability 强制边界**：`requireAppCapability` 改为消费 main 侧真实快照，发行策略、
   endpoint 与 session 任一不满足都 fail closed；FreeWorkBuddy profile 改为 remote manifest，
   只打开 account、device-link 与 website。
2. **Mobile 自举与单 realm 修复**：FreeWorkBuddy 原生构建强制投影为 global realm，并把
   `https://freeworkbuddy.me` 烘焙为唯一 manifest base；peer realm URL 留空、跨 realm 组织登录
   关闭，避免独立发行包回落到 Cindy 官方 CDN 或因 region mismatch 卡死。
3. **Legacy Import P0 修复**：discovery grant 按 renderer 隔离；执行前复验 realpath、软链接、
   文件类型、大小、mtime/ctime、dev/ino；sessions/messages 使用一个 outer transaction，任一失败
   保证零写入。
4. **Auth P0 修复**：challenge 与 authorization code 原子消费，失败尝试原子计数，并发 refresh
   reuse/logout 原子撤销 family；所有受保护 API 统一执行 JWT 验签与 session-active 检查。
   新增 operator login，管理员可生成/轮换
   一次显示的 6 位登录码，无需首期邮件服务。
5. **Relay P0 修复**：production 强制 issuer/audience/realm/RS256；logout/reuse 会写 Redis session
   deny marker 并踢掉同 session 连接；客户端稳定 deviceId 可幂等进入 durable registry。
6. **单机部署清单**：Caddy 统一承载 TLS、静态 manifest/法律页、API 与 WebSocket 反代；PostgreSQL、
   Redis、API、relay 不暴露宿主端口；JWT 私钥仅挂给 API，OSS 使用阿里云外部 endpoint。
7. **验证**：服务端 `typecheck/test/build/lint/guard` 全绿（11 files / 84 tests），Compose config
   可展开，生产 endpoint.json 已通过客户端 parser。Docker daemon 当前未运行，因此镜像构建、
   真实 migration 与 backup/restore smoke 尚无证据。

## 二点五、2026-09-02 本地全链路联调（已验证可用）

**状态：服务端本地真实跑通 + dev 客户端连上，client → gateway → api/relay 全链路打通。**

1. **本地拓扑**（全部原生服务，Docker Desktop 本机损坏无法启动，绕开）：
   - postgres 16 原生（127.0.0.1:5432，库 `freeworkbuddy`，三个迁移已应用）
   - redis 原生（6379）；minio 原生（9000，与 Cohub 共用实例，桶 `freeworkbuddy-local`）
   - api（8080）+ relay（8081）+ **本地单端口网关 gateway.mjs（8090）**：生产是同 origin 反代（`/api/device-link/ws` upgrade → relay、其余 → api），客户端从同一 base URL 推导 HTTP 与 WS，因此本地必须单端口——gateway HTTP 正向代理到 8080、WS upgrade 原样字节转发（保留 authorization 头）到 8081
   - env 清单与密钥见服务端仓 `.env`（gitignored）+ `deploy/local/jwt_*.pem`（openssl RSA 2048，gitignored）
2. **dev 验证码投递**：api 的 `onCodeSend` 钩子在 `NODE_ENV=development` 时把验证码追加写 `/tmp/freeworkbuddy-dev-codes.log`（commit `c2d7c67`）。登录方式：客户端登录页填任意邮箱 → request-code → 取日志里的 code → verify-code 换 RS256 token。
3. **客户端接入方式**：dev 实例 + file 模式 endpoint 清单（不是 selfhost profile——那是「无服务形态 A」，连服务端属形态 B，用官方身份 + `XDT_ENDPOINT_MANIFEST_FILE` 注入 `deploy/local/endpoint.cindy-dev.json`，localhost http 由 file 模式放行）。隔离沙箱 `XDT_USER_DATA_DIR="$HOME/Library/Application Support/CindyGlobal-dev2-dev"`。
4. **验证证据**：/healthz、/readyz ok；request-code → 取码 → verify-code 签发 RS256（claims realm/tenant/device/session/gen）→ JWKS 正常；未鉴权 device list 401 / 鉴权后 `{"devices":[]}`；relay WS upgrade（经 8090、真实登录 token）`WS_UPGRADE_OK`；**客户端真实流量证明**——api 日志出现来自客户端进程的 `GET /api/auth/providers 200`，客户端日志确认 `[clientEndpoints] resolved from local manifest file` 与 `[device-link] ws://localhost:8090/api/device-link/ws`。
5. **本轮修复的真 bug**（已提交）：cindy `forge.config.ts` BRAND_IDENTITY 未 import（forge start 即崩，此前两次 STARTUP_TIMEOUT 的真因，commit `bca843dc9`）；服务端 relay 公钥文件路径解析 + claim 契约漂移（`tenant/device` vs `tenantId/deviceId`，commit `17bc700`）；api dev 码投递（`c2d7c67`）；deploy/local 工具入库（`f1a59ee`）。
6. **wrapper 死结（待用户决策）**：`restart:desktop:local` 每次启动清 `.vite` 缓存 + `startupReadyTimeoutMs` 硬编码 120s → 本机冷编译 >120s 必然 STARTUP_TIMEOUT → kill。本机替代启动命令：
   ```bash
   cd /Users/yuan/gsp-workspace/cindy/apps/desktop
   XDT_USER_DATA_DIR="$HOME/Library/Application Support/CindyGlobal-dev2-dev" \
   XDT_ENDPOINT_MANIFEST_FILE=/Users/yuan/gsp-workspace/freeworkbuddy-server/deploy/local/endpoint.cindy-dev.json \
   pnpm dev:desktop
   ```
   （服务端四件套重启：api/relay 各自 dev script + `node deploy/local/gateway.mjs`；依赖本机 postgres/redis/minio 先在跑。）
7. **边界**：UI 内完成一次真实登录（取码填码到登录成功）尚未由用户实机走完；S3 media 路由 UI 侧验证未做；Docker Desktop 需人工修复/升级。

## 三、关键技术决策（已定，勿推翻）

1. **发行维度**：`CINDY_DISTRIBUTION_PROFILE` env（缺省=官方路径逐字节不变；`freeworkbuddy-selfhost` = FreeWorkBuddy）。单一选取入口 `resolveDistributionProfile`（maker-shared `./distribution-profile`）。
2. **FreeWorkBuddy 身份值**：`me.freeworkbuddy.ios/.android/.desktop`、scheme/userData/凭据 namespace = `freeworkbuddy`、companyName=`leyuan0602-glitch`；法律页由 `https://freeworkbuddy.me/{privacy,terms}` 同源提供。
3. **realm**：self-host v1 内部 `authRealm='global'`、`crossRealmOrgLoginEnabled=false`；官方 cn/global 双 realm 行为不变。
4. **capability**：17 键 taxonomy（maker-shared `DISTRIBUTION_CAPABILITY_KEYS`），四层计算 = build ∧ distribution defaults ∧ endpoint present ∧ session。main 是真相源；renderer 只消费布尔投影（`useAppCapabilities`，判断用 `=== false`）。
5. **打包**：本机 `electron-forge package`（先 `node scripts/build-remote-bundles.mjs`，`NODE_OPTIONS='--max-old-space-size=8192'`，renderer OOM 大户）。产物先 macOS。
6. **验证入口**：`pnpm smoke:no-egress`（no-egress 运行时验收：官方请求=0 + 全部请求域已登记）；`node scripts/smoke-packaged.mjs`（schema smoke）。

## 四、已修复的重要 bug（背景知识）

- **packaged 启动竞态**：bootstrap chunk（18MB）动态 import 期间 ready 事件已发出，`app.on('ready')` 注册晚于事件 → 回调永不执行 → 包静默卡死。已改 `app.whenReady()`（`8a997c2b`）。dev 不拆包无此问题。
- `ENDPOINT_UNAVAILABLE`：空 baseUrl 在 `serverApiClient.rawFetch` 受控拒绝（503），是全部自建 server 调用的单点 gate。

## 五、已知遗留问题

1. desktop 单测原有基线失败已在本轮补齐测试 fixture：Grok mock 增加
   `getGrokAccessToken`，LoginPage mock 增加 `CURRENT_DISTRIBUTION_BRAND`，Billing 日期 fixture
   改为跨时区稳定值。定向回归 202 passed、2 skipped。
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

## 八、剩余工作清单（需要外部环境或后续产品决策）

1. **push 与 PR**：本轮提交完成后仍需由用户明确决定 push 时机；客户端进入现有 PR #2，
   服务端首次 push 到独立 private 仓。
2. **三平台 packaged UAT**（Windows/Linux 需对应环境或 CI runner——Actions 额度未恢复前需外部方案）：含设置页 legacy import 真实导入演练、UI 入口隐藏的 self-host 构建目检。
3. **Mobile 侧完整 capability projection**：首期账号/device-link 已可从 endpoint manifest 取值；
   尚需在启用 Phase 3 功能前把 voice、OAuth、push、更新等 UI/后台任务统一接入同构 capability。
4. **服务端 Phase 2 环境验收**：Docker 可用后执行真实 PostgreSQL migration、Compose build、
   backup/restore smoke；DNS/TLS/OSS 配置完成后跑 Desktop + iOS + Android 双设备 UAT。设备 DELETE
   当前会踢掉在线连接，但不会永久撤销该设备持有的 auth session；正式提供“移除设备”前需把
   device registry 删除与 session/family 撤销做成同一业务动作。
5. **Phase 3 可选云能力**（§3.19 17-20）：蓝图明确「按需、不进关键路径」，接口已留，暂不实现。
