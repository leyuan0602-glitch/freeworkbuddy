# FreeWorkBuddy Self-hosting 改造实施计划

> 状态：实施方案正本；Phase 1 与 Phase 2 MVP 已进入实现，完成度以
> [`self-hosting-progress.md`](./self-hosting-progress.md) 为准。现阶段仍保持既有 wire
> protocol，不以改协议来规避兼容问题。
> 范围：本客户端仓，以及独立的 FreeWorkBuddy 服务端仓
> 基线日期：2026-09-01

本文回答三个问题：当前项目的真实基线是什么，Self-hosting 发行版最终要达到什么状态，
以及客户端、服务端、部署和发布要按什么顺序修改。

### 已确定的项目参数

| 项目 | 决策 |
|---|---|
| 正式产品名 | `FreeWorkBuddy` |
| 客户端上游 | `makecindy/cindy` |
| 客户端 fork | `leyuan0602-glitch/freeworkbuddy`，保留对 `makecindy/cindy` 的 GitHub fork 关系 |
| 服务端仓 | `leyuan0602-glitch/freeworkbuddy-server`，personal private repository |
| 本地目录 | 客户端 `/Users/yuan/gsp-workspace/cindy`；服务端 `/Users/yuan/gsp-workspace/freeworkbuddy-server` |
| 首个部署域名 | `freeworkbuddy.me`；子域在服务上线前按职责配置 |
| 首台服务器 | 阿里云轻量应用服务器，香港地域，Ubuntu 24.04，2 CPU / 1 GB / 30 GB |
| 首阶段范围 | Local-first Desktop、独立发行身份、capability gate、官方运行时流量归零；随后以 `freeworkbuddy.me` remote manifest 启用账号与 device-link |
| 暂缓 | 邮件投递、Mobile push、Apple / Windows 签名、镜像仓库、自动更新发布、可选云能力 |

服务端、DNS、SSH 和 OSS 资源已经具备开工条件。Phase 1 的 Local-first Desktop 不依赖它们；
Phase 2 通过同一发行 profile 的 remote manifest 打开账号与 device-link，并继续关闭所有尚未
部署的云能力。第一台 1 GB 服务器只作为开发和轻量集成环境；生产期的数据库、Redis、relay
与可观测性是否同机部署，要在压测和内存基线完成后再决定。

### 开发资源与操作入口

| 资源 | 位置 / 标识 | 用法与约束 |
|---|---|---|
| 客户端 GitHub | `https://github.com/leyuan0602-glitch/freeworkbuddy` | `origin`；功能分支、push 和 PR 的目标 |
| 客户端上游 | `https://github.com/makecindy/cindy` | 本地 remote 名为 `upstream`；只 fetch / rebase，不向其 push |
| 服务端 GitHub | `https://github.com/leyuan0602-glitch/freeworkbuddy-server` | 独立 private 仓；服务端代码、migration 与部署清单均放这里 |
| 客户端本地 | `/Users/yuan/gsp-workspace/cindy` | 当前工作目录；现有目录不搬迁，以免破坏本地依赖与未提交改动 |
| 服务端本地 | `/Users/yuan/gsp-workspace/freeworkbuddy-server` | 与客户端平行的 sibling directory |
| GitHub 身份 | `leyuan0602-glitch`，通过 `gh` 已认证 | 仓库和 PR 操作使用 GitHub CLI；不得把 token 写入仓库 |
| 阿里云 CLI | `/opt/homebrew/bin/aliyun`，OAuth profile `default` | 云资源以 CLI 查询和配置为准；不得导出或落盘 access key / OAuth token |
| 轻量服务器 | instance `3f3f61e6724a4ff5a1b5c15c06ae6c0c` | region 与 biz-region 都是 `cn-hongkong`；公网 IP `47.82.73.32` |
| 服务器系统 | Ubuntu 24.04，2 CPU / 1 GB / 30 GB ESSD | 开发 / 集成基线；先设 swap 和资源限制，不承诺生产容量 |
| 域名与 DNS | `freeworkbuddy.me`，AliDNS，NS 为 HiChina | 初期规划 `api.freeworkbuddy.me` 与 `relay.freeworkbuddy.me`，真正部署服务时再写解析 |
| 对象存储 | 阿里云 OSS，bucket 尚未在本文锁定 | 使用前先通过 CLI 盘点所在 region、ACL、CORS、versioning 和 lifecycle；默认 private |

阿里云操作约定：

1. 先用 `aliyun help <service>` / `aliyun <service> --help` 确认可用 API，再执行读操作；不能凭记忆
   假定 SWAS 子命令名。
2. SWAS 调用显式传入 `--region cn-hongkong --biz-region-id cn-hongkong`；DNS 与 OSS 调用也显式
   指定资源所属区域或 zone，不依赖 CLI profile 的 `cn-hangzhou` 默认 region。
3. 优先使用阿里云 CLI 管理实例、密钥、DNS、OSS 和后续安全组；SSH 只用于服务器内的系统配置
   与应用部署。
4. 任何会创建、修改或删除云资源的命令，执行前先读取当前状态并保留变更记录；不处理自动续费。
5. SSH 公钥、数据库密码、JWT key、OSS credential 和 TLS 私钥只能进入本机 credential store、
   CI secret 或服务器 secret 文件，绝不进入 Git tracked path。
6. 当前只开放 22 / 80 / 443；SSH key 验证可用后收窄 22 的来源，数据库、Redis、管理端口不开放公网。
7. Phase 1 不提前创建 DNS 记录或 OSS bucket；Phase 2 服务具备 health check 后再切 DNS，媒体能力
   开工后再选择或创建 bucket，避免空资源和错误公开配置。

## 1. 基线

### 1.1 仓库与产品边界

当前仓库是客户端 monorepo：

| 目录 | 当前职责 |
|---|---|
| `apps/desktop` | Electron Desktop，包括 main、preload、renderer、本地 SQLite、Agent runtime、device-link client 和更新器 |
| `apps/mobile` | Expo / React Native Mobile，负责登录、发现 Desktop、远程控制和会话镜像 |
| `packages/*` | Desktop / Mobile 共享的 auth、device-link、provider、Agent 和 UI 契约 |
| `config/endpoint*.json` | CN / Global / Dev 的远端 endpoint manifest 正本 |
| `scripts/`、`tools/` | 构建、发布、运行时二进制下载、校验和迁移工具 |

本仓没有服务端实现。README 明确说明 backend 位于独立仓库。公开资料提到的官方后端
`xindong/cindy-server` 当前不可公开获得，因此 Self-hosting 计划不能依赖拿到官方 server
源码，也不能在本客户端仓里补一个隐蔽的内嵌服务端。

### 1.2 当前发行身份

`packages/maker-shared/src/brandIdentity.ts` 是 Desktop 系统身份的主要事实源，当前身份包括：

- `CindyRegion = cn | global | dev`；默认是 `global`。
- Cindy 展示名、Desktop executable、app ID、deep-link scheme、userData 目录、数据库前缀、
  updater 名和 CDN 前缀。
- CN / Global 是官方发行区域，`dev` 是开发发行身份，不是 Self-hosting 身份。
- `apps/desktop/forge.config.ts`、Desktop main、CI / release scripts 消费这些身份。
- `apps/mobile/app.config.js` 内仍有 CN / Global / Dev 的 scheme、iOS bundle ID、Android package、
  OAuth、Expo updates 和原生插件选择。

`apps/mobile/scripts/self-host-regions.json.example` 名字中虽然有 `self-host`，实际只解决 Mobile
分区打包、bundle / package ID、签名、TapDB、OSS 和发布落点。它不描述 auth、device-link、
数据库、relay 或业务服务，不能作为完整 Self-hosting 配置。

当前品牌、包名、keychain / SecureStore namespace、URL scheme、更新产物、网站、GitHub、
法律链接和外部服务都仍以 Cindy 官方发行版为中心。Apache-2.0 允许 fork 和修改，但不授予
Cindy 商标使用权；fork 发行时还必须保留 `LICENSE`、`NOTICE`、第三方归属，以及对修改文件
的必要声明。

### 1.3 当前启动与 endpoint manifest

共享 endpoint schema 位于 `packages/maker-shared/src/clientEndpoints.ts`，当前
`schemaVersion` 为 1。字段包括：

```text
authApiBaseUrl, authDesktopCallbackUrl, deviceLinkApiBaseUrl,
oauthBrokerApiBaseUrl, ossApiBaseUrl, heartbeatUrl,
telegramHookWsUrl, xHookWsUrl, slackHookWsUrl, websiteUrl,
modelAccessApiBaseUrl, voiceApiBaseUrl, githubApiBaseUrl,
skillhubApiBaseUrl, pluginApiBaseUrl, cdnBaseUrl,
mobileUpdateBaseUrl, review
```

schema 已允许业务 endpoint 缺失或留空，并统一归一化为 `''`。但当前启动链仍有以下约束：

#### Desktop

- `apps/desktop/src/main/clientEndpointsService.ts` 在创建窗口和更新检查之前加载 manifest。
- packaged build 固定从构建期烘焙的 CDN base 拉取 `endpoint.json`；开发模式才可读本地文件。
- 一次启动只使用一份完整 manifest 快照；非法 JSON、schema 或非空 URL 会阻断启动。
- 网络失败可重试，并在符合条件时使用严格校验过的完整缓存。
- `apps/desktop/src/main/endpointManifestCache.ts` 把离线缓存的可信域写死为
  `cindy.com.cn` 和 `cindy.app`。
- `clientEndpointsService.ts` 同时烘焙 CN / Global 两份 manifest base，用于跨 realm SSO
  发现和已绑定会话恢复。
- `cdnBaseUrl` 同时承担 Desktop 更新 / runtime artifact CDN 的入口，当前还没有与 manifest
  bootstrap 解耦。

#### Mobile

- `apps/mobile/src/config/clientEndpointStartup.ts` 和
  `apps/mobile/src/config/useStartupEndpointGate.ts` 在业务树放行前从 CDN 拉取 manifest。
- `apps/mobile/src/config/env.ts` 把 auth、OAuth broker、device-link、voice 和 Mobile update
  endpoint 写入运行时 live binding。
- `apps/mobile/app/_layout.tsx` 顺序执行 endpoint gate 和 OTA gate。
- `apps/mobile/src/update/useStartupOtaGate.ts` 在 self-host OTA 变体中缺少
  `mobileUpdateBaseUrl` 会抛错，尚不支持“更新服务未部署但正常运行”。
- Expo OTA URL、bundle identity、OAuth scheme 和 push identity 属于原生构建输入，不完全受
  endpoint manifest 控制。

因此，当前正式包仍要求一个远端 manifest bootstrap，空 endpoint 也没有自动等价成完整的
功能关闭。

### 1.4 当前登录、本地模式与能力门控

Desktop 已有可复用的 Local-first 基础：

- 登录页支持 Skip Sign-In。
- 本地模式拥有独立 data owner，可使用本地 SQLite、Agent、BYOK 和本地模型。
- `apps/desktop/src/main/appCapabilities.ts` 已提供一层中央账号能力门控。
- 当前能力包括 account services、Cindy gateway、device-link、SkillHub cloud、OAuth broker
  和 heartbeat；本地模式统一关闭这些账号能力。
- main 侧的 device-link、model-access、voice、SkillHub、hook、GitHub feedback 等部分模块
  已消费这层 gate。

但现有 `AppCapabilities` 只由 `local | cloud` 会话状态推导，没有同时表达：

- 某个 endpoint 是否存在；
- 当前 distribution 是否允许该能力；
- server 是否协商出对应子能力；
- updater、website、Plugin Market、voice、feedback 等非统一账号能力；
- Mobile 的同一份能力模型。

结果是“已经登录”仍可能被当成“所有官方服务均可用”，不同模块对空 endpoint 的处理不一致。
部分 main service 已能安全拒绝，部分 UI 或后台任务仍需逐项审计。

### 1.5 当前远端服务依赖

当前 endpoint manifest 对应的运行时域如下：

| 域 | 主要客户端位置 | 当前用途 |
|---|---|---|
| Auth | `packages/auth-client`、Desktop `authManager.ts`、Mobile `AuthContext.tsx` | 登录、refresh、账号、组织 SSO、资料和删除 |
| Device-link | `packages/device-link`、Desktop `main/device-link/**`、Mobile session / notification | 设备发现、WS relay、远程控制、媒体和 push |
| Model access | Desktop `main/model-access/**`、`maker-host/**`、billing / usage | 动态模型、短期网关凭据、余额和 usage |
| Voice | Desktop `main/voice-input/**`、Mobile `mobileCindyVoiceSession.ts` | 托管语音 session 和 refine |
| OAuth broker | Desktop `authManager.ts` / `cindy-brain`、Mobile `AuthContext.tsx` | 第三方 OAuth exchange / refresh、feature flags |
| OSS | Desktop `bootstrap-electron.ts` | 头像和公开资产 presign |
| Hooks | Desktop `main/hook-control/**` | 托管 Slack / Telegram / X WebSocket |
| Feedback | Desktop `main/github-issue/**` | 创建和查询 GitHub issue |
| SkillHub | Desktop `main/skillhub/**` | 市场、安装、发布和组织可见性 |
| Plugin Market | Desktop `main/plugin-market/**`、`plugin-publisher/**` | 插件目录、下载和发布 |
| Heartbeat | Desktop `heartbeatService.ts`、`packages/heartbeat-client` | 匿名在线心跳 |
| Desktop update | Desktop `manifestService.ts`、`updateService.ts`、`cindy-updater` | manifest、hotfix、runtime artifact 和整包更新 |
| Mobile update | Mobile `src/update/**`、Expo updates 原生配置 | 自建整包发现与 OTA |
| Log upload | Desktop `main/log-upload/**` 和构建注入 | 客户端日志采集、脱敏和上报 |

此外还要审计静态网站、法律页、GitHub release、runtime 二进制下载、插件 / Skill 默认源、CSP、
OAuth redirect、App Store / Play Store 和 analytics。它们不全在 endpoint manifest 中。

### 1.6 当前公开协议与服务端缺口

公开且已归档的
[`makecindy/cindy-protocol`](https://github.com/makecindy/cindy-protocol) 只提供四组跨端
wire contract：

- `@cindy/device-link-protocol`
- `@cindy/slack-hook-protocol`
- `@cindy/plugin-protocol`
- `@cindy/model-access-protocol`

这些 package 提供类型、envelope、parser / validator、builder、版本和兼容规则，不提供：

- HTTP / WebSocket 服务启动；
- 用户、组织、设备和 token 持久化；
- 鉴权、JWKS、验证码、OAuth 或 SSO；
- relay 路由、presence、队列、push 和对象存储；
- 模型网关、额度、账单、hook runtime、市场或更新发布；
- 部署、migration、备份、监控和运维。

所以服务端需要按客户端消费契约重新实现。第一轮只能复刻已观察语义，不能一边重建 server
一边重写 wire protocol，否则无法区分兼容问题和新设计问题。

### 1.7 基线问题清单

| 编号 | 当前问题 | 直接影响 |
|---|---|---|
| B1 | 正式包身份只支持 CN / Global / Dev | Self-host 身份会与 region、官方品牌和数据目录耦合 |
| B2 | packaged startup 强依赖远端 manifest bootstrap | 无 server 的 Local-first 包不能真正离线首启 |
| B3 | 缓存 trust root 写死官方域名 | 自建域名的离线缓存会 fail closed |
| B4 | 正式包默认启用双 realm 机制 | 自建 token 进入不需要的跨 realm 路由复杂度 |
| B5 | capability 只表达账号模式，不表达 endpoint / distribution / server | 空 endpoint 仍可能留下入口、timer 或调用 |
| B6 | `cdnBaseUrl` 混合 bootstrap 后运行时更新职责 | 关闭 updater 可能同时破坏启动 |
| B7 | Mobile self-host OTA 缺 endpoint 会抛错 | 不部署更新服务时 Mobile 无法正常通过启动链 |
| B8 | 品牌、域名、签名、scheme、数据目录和官方链接分散 | 只改展示名会造成 identity 冲突和官方流量 |
| B9 | 公开 protocol 不是 backend | auth、relay、数据和运维都需要独立实现 |
| B10 | 没有完整 route / domain registry | 无法证明 server 契约完整，也无法证明零官方 egress |

## 2. 目标

### 2.1 Self-hosting 完成标准

目标发行版应满足：

1. 使用独立品牌、应用 ID、scheme、数据目录、签名证书、域名、发布通道、支持和法律页面。
2. 默认启动、登录、运行、更新检查和崩溃恢复不会访问 Cindy 官方域名或服务。
3. Desktop 可以在没有账号、控制面和网络时启动，并用 BYOK 或本地模型完成真实任务。
4. 启用 Mobile 后，auth、device registry、relay、媒体、push、数据和密钥全部由部署方控制。
5. 只有实际部署且通过协商的能力才会出现在 UI 中；未部署服务不会产生按钮、菜单、后台重试
   或错误 toast。
6. 自建 server 通过客户端 contract suite，并维护旧 / 新客户端与 server 的兼容矩阵。
7. 提供 Compose 部署、备份恢复、可观测性、安全基线和可回滚发布；Kubernetes 是后续 HA
   选项，不是 Local-first 的前置条件。

### 2.2 非目标

- 不在本客户端仓实现 backend。
- 不复制官方云内部代码、数据库或商业计费逻辑。
- 不把 `dev` 改名为 self-host，也不直接把 `selfhost` 塞进 `CindyRegion`。
- 不在第一阶段实现组织 SSO、跨 realm、托管模型、账单、官方 hooks、市场和自动更新。
- 不迁移无法合法导出的官方云账号、账单、市场或 server-side 数据。
- 不在第一轮修改 device-link、hook、plugin 或 model-access wire semantics。

### 2.3 目标产品形态

#### 形态 A：Local-first Desktop

```text
Desktop
  -> local SQLite / files / safeStorage
  -> local Agent runtimes
  -> user-configured model provider or local model

No auth, no relay, no control plane, no updater required
```

这是首个可发布 MVP，也是单人或小团队最应该长期保留的最小产品面。

#### 形态 B：Desktop + Mobile Core

```text
Desktop / Mobile
  -> HTTPS API: auth, account, device registry, media
  -> WSS relay: presence and opaque device-link frames
  -> worker: verification, push, cleanup
  -> PostgreSQL + Redis + S3/MinIO
```

只有该形态需要账号。部署仍是单 realm，不依赖官方身份或数据面。

#### 形态 C：可选云能力

在形态 B 上按需增加 model access、voice、OAuth broker、hooks、Plugin Market、SkillHub、
Desktop / Mobile updates。每项都有独立 capability、数据边界、部署开关和回滚，不组成一个
必须全部安装的“完整版”。

### 2.4 目标客户端配置模型

新增与 `CindyRegion` 正交的构建期 `DistributionProfile`：

```ts
interface DistributionProfile {
  distributionId: string;
  brand: {
    productName: string;
    companyName: string;
    desktopAppId: string;
    iosBundleId: string;
    androidPackage: string;
    urlSchemes: string[];
    userDataName: string;
    secureStorageNamespace: string;
    websiteUrl?: string;
    supportUrl?: string;
    privacyUrl: string;
    termsUrl: string;
  };
  authRealm: 'global';
  crossRealmOrgLoginEnabled: false;
  endpointManifest:
    | { mode: 'embedded'; trustedEndpointDomains: string[] }
    | {
        mode: 'remote';
        bootstrapUrl: string;
        trustedEndpointDomains: string[];
      };
  capabilityDefaults: Record<string, boolean>;
  telemetryPolicy: 'disabled' | 'self-hosted';
  updateMode: 'disabled' | 'manual' | 'self-hosted';
}
```

这是目标结构，不是要求原样提交的最终 TypeScript。实际 schema 要遵守配置分层：

- `DistributionProfile` 回答“安装包是谁”，只在构建期决定。
- endpoint manifest 回答“部署提供哪些服务”，不能改 app ID、scheme、trust root 或签名根。
- 管理员策略回答“部署允许用户使用哪些服务”。
- 用户设置只能在允许范围内开关偏好，不能提升部署能力。
- Local-first Desktop 使用 embedded manifest；联网部署使用 remote manifest。

为了兼容当前 `ClientEndpointRegion` 和 auth contract，Self-host v1 内部 realm 继续使用
`global`，但 UI 不显示“Global edition”。客户端禁用 peer manifest 和跨 realm discovery。
若未来需要任意 realm ID，再单独设计 token claim、manifest 和数据迁移版本。

### 2.5 目标 capability 模型

最终 capability 的计算规则为：

```text
build supports feature
AND distribution policy enables feature
AND required endpoint set is present
AND session satisfies auth/tenant requirements
AND server negotiation supports protocol sub-capability
```

main / native 层是安全真相源，Renderer 只消费投影后的 capability。UI 隐藏不能替代 main、IPC、
background worker 和 WebSocket 边界的拒绝。

#### Endpoint 与目标行为

| endpoint / 配置 | 可留空 | 为空时必须发生的行为 |
|---|---:|---|
| `authApiBaseUrl` | 是 | 进入 Local-first；不初始化账号 client；隐藏登录、资料、组织和账号删除 |
| `authDesktopCallbackUrl` | 是 | auth 存在时使用 loopback PKCE；非空才启用 hosted callback |
| `deviceLinkApiBaseUrl` | 是 | 不启动 WS / push / device timer；隐藏设备、Mobile pairing 和远程控制 |
| `oauthBrokerApiBaseUrl` | 是 | 隐藏 broker-backed integration 和远端 feature flags |
| `ossApiBaseUrl` | 是 | 隐藏公共头像 / 资产上传，或使用明确的 local-only fallback |
| `heartbeatUrl` | 是 | 不创建 heartbeat timer，不显示错误 |
| `telegramHookWsUrl` | 是 | 只隐藏托管 Telegram hook，保留个人 / 本地 bot |
| `xHookWsUrl` | 是 | 只隐藏托管 X hook |
| `slackHookWsUrl` | 是 | 只隐藏托管 Slack hook，保留不依赖它的本地 integration |
| `websiteUrl` | 是 | 不保留官方 URL；空时隐藏外链，必需法律 / 支持内容随包提供 |
| `modelAccessApiBaseUrl` | 是 | 隐藏托管模型、动态媒体目录、余额、账单、usage；保留 BYOK / local provider |
| `voiceApiBaseUrl` | 是 | 隐藏托管 voice；本地配置的 voice provider 可独立保留 |
| `githubApiBaseUrl` | 是 | 隐藏 feedback / my issues，或改用 fork 支持 URL |
| `skillhubApiBaseUrl` | 是 | 隐藏市场、组织可见性和发布；本地 Skill 继续工作 |
| `pluginApiBaseUrl` | 是 | 隐藏市场、组织和 publisher；保留手动 `.cindy`、本地和允许的 Git 来源 |
| `cdnBaseUrl` | 是，改造后 | 与 bootstrap 解耦；更新关闭时不启动 updater、不显示更新 UI |
| `mobileUpdateBaseUrl` | 是 | 不运行 JS 整包 / OTA gate，不显示更新 UI；不得抛启动错误 |
| `review` | 是 | 空值关闭 review mode |
| log upload build config | 是 | 未配置即不采集、不上传；它不进入 endpoint manifest |

### 2.6 目标服务端架构

服务端放入独立仓，初期采用模块化单体、独立 WebSocket relay 和 worker：

| 模块 | 进程边界 | 职责 | 状态 |
|---|---|---|---|
| Auth / Control API | API 单体 | provider discovery、登录、token、账号、tenant、device registry | PostgreSQL |
| Device-link relay | 独立服务 | WS 握手、presence、同账号路由、背压、协议校验 | Redis + PostgreSQL |
| Media broker | API 模块 | device-link / avatar presign、对象生命周期 | S3 / MinIO + PostgreSQL |
| Worker | 独立进程 | 邮件 / 短信、push、outbox、清理、扫描 | PostgreSQL + Redis / queue |
| Model access | 可选模块 | model catalog、短期 gateway grant、entitlement、usage | PostgreSQL + KMS |
| Voice | 可选服务 | 短期 provider ticket、refine | PostgreSQL + KMS |
| OAuth broker | 可选模块 | 第三方 OAuth exchange / refresh、加密 grant | PostgreSQL + KMS |
| Hooks | 可选独立 worker | provider binding、dispatch、ack、idempotency | PostgreSQL + queue |
| Plugin / SkillHub | 可选模块 | catalog、release、ACL、publisher、scan | PostgreSQL + object storage |
| Update publisher | 可选静态服务 | 签名 manifest、artifact、rollout、minimum version | object storage / CDN |

HTTP route group 初期可共用一个 public API origin；不同 endpoint 可以指向同一 origin。relay
独立部署，因为长连接、排空、背压和扩缩容模型与普通 API 不同。

### 2.7 目标部署与质量

- 最小联网部署：reverse proxy + API + relay + worker + PostgreSQL + Redis + S3 / MinIO。
- Docker Compose 是首个生产基线；Kubernetes 在契约和 SLO 稳定后提供。
- access JWT 非对称签名，refresh token 轮换并只存 hash，JWKS 支持重叠轮换。
- BYOK 只在客户端 secure storage；server 只签发短期 model / voice grant。
- 日志、trace 和 metrics 不记录 token、prompt、消息、附件名、presigned query 或用户凭证。
- 有 contract tests、no-egress tests、备份恢复、兼容矩阵、渗透测试和可回滚发布。

## 3. 改造实施计划

### 3.1 总体实施原则

1. 先固化发行身份、endpoint、capability 和网络契约，再改业务 UI。
2. 先交付无 server 的 Desktop，再写 auth / relay；不要让 Phase 1 被云能力拖住。
3. 官方 CN / Global 构建行为保持不变。Self-host 使用独立 profile，不覆盖现有常量。
4. 第一轮不改 wire protocol；新增字段必须 append-only，并保持旧客户端可忽略。
5. 每项远端能力必须同时完成 endpoint、main/native gate、Renderer gate、测试和运维开关。
6. 客户端仓与服务端仓通过版本化 fixture / OpenAPI / AsyncAPI 协作，不跨仓 import 源码。

### 3.2 工作流 A：建立网络与契约清单

#### 要改什么

在客户端仓新增机器可读的 contract registry 和 domain inventory，例如：

```text
docs/contracts/network-contract-registry.json
docs/contracts/external-domain-inventory.json
scripts/check-network-contract-registry.mjs
scripts/check-self-host-egress.mjs
```

registry 每条记录至少包含：

```text
owner, capability, clientCallsite, method, path, auth, headers,
requestSchema, responseSchema, errorCodes, timeout, retry,
idempotency, sideEffects, confidence, protocolVersion
```

置信度分级：

- A：有 runtime parser / protocol package 和 tests。
- B：有 typed consumer，但没有严格 runtime parser。
- C：只从 UI、错误处理或调用方式推断。

#### 怎么做

1. 用 AST 或受控的 `rg` 扫描 fetch、WebSocket、deep link、callback 和对象存储调用。
2. 把 `packages/auth-client`、`packages/device-link` 和现有 parser 当作消费端真相源。
3. 为每条 route 提取成功、缺字段、未授权、过期 token、限流和未知字段 fixture。
4. C 级关键契约先补 characterization test，再允许 server 实现。
5. CI 检查新增网络调用是否同步登记 registry；未登记即失败。
6. 静态扫描源码、构建脚本、原生配置和 packaged artifact 中的外部域名；只对 license、历史
   migration 和测试 fixture 建精确 allowlist。

#### 当前 API 盘点种子

Auth：

```text
GET  /api/auth/providers
POST /api/auth/discovery
POST /api/auth/sso/discovery
POST /api/auth/{email|phone}/request-code
POST /api/auth/{email|phone}/verify-code
POST /api/auth/token
POST /api/auth/desktop/callback/poll
POST /api/auth/social/{apple|google|wechat}
POST /api/auth/select-account
POST /api/auth/binding/request-code
POST /api/auth/binding/verify
POST /api/auth/refresh
GET  /api/auth/account
POST /api/auth/account/exchange
POST /api/auth/account/refresh
POST /api/auth/account/logout
POST /api/auth/sso/verification/request-code
POST /api/auth/sso/verification/verify
GET  /api/me
PATCH /api/me/profile
POST /api/auth/logout
GET  /api/auth/social/:provider/authorize
GET  /api/auth/sso/:provider/authorize
GET  /captcha/turnstile
```

账号删除的 availability / challenge / confirm / status 必须从
`packages/auth-client/src/client.ts` 逐项抽出精确 method 和状态机。

Device-link：

```text
WS     /api/device-link/ws
GET    /api/device-link/devices
PATCH  /api/device-link/devices/:deviceId
DELETE /api/device-link/devices/:deviceId
POST   /api/device-link/media/presign-put
POST   /api/device-link/media/presign-get
DELETE /api/device-link/media
POST   /api/device-link/push-token
DELETE /api/device-link/push-token
```

v1 envelope kind 至少包括：

```text
hello, hello-ack, presence-set, presence-changed, ping, pong, notify,
link-open, link-accept, link-close, invoke, invoke-result, push, relay-error
```

其他能力的 route seed：

| 域 | 调用面起点 |
|---|---|
| Model access | `/api/model-access/credentials[/rotate]`、`/models?schemaVersion=5`、balance、credit usage、invocation guides |
| Voice | `/api/voice/sessions`、refine、refine-warmup |
| OSS | `/api/oss/presign-put` |
| OAuth broker | `/api/user/feature-flags`、`/api/integrations/:slug/oauth/{exchange|refresh}` |
| Feedback | `POST /api/github/issues`、`GET /api/github/issues/mine` |
| Heartbeat | `POST /heartbeat` |
| Plugin | `/api/plugins` 和 `/api/publisher` 的 list / detail / download / upload / commit / status |
| SkillHub | list / detail / files / versions / download、publish init / commit、visibility / team / category / scan |
| Desktop update | `manifest-<platform>[-canary|-beta].json` 和 artifacts |
| Mobile update | `/latest?platform=...&channel=...`；Expo OTA 是独立原生通道 |

#### 验收

- 所有生产网络调用都有 owner 和 capability。
- server MVP 需要的 route 没有 C 级未决项。
- CI 能在新增未登记调用和新增未批准域名时失败。

### 3.3 工作流 B：增加 DistributionProfile

#### 主要改动位置

| 文件 / 模块 | 修改内容 |
|---|---|
| `packages/maker-shared/src/brandIdentity.ts` | 保留官方 identity，增加从 distribution profile 解析系统身份的入口；legacy identifier 只增不减 |
| 拟新增 `packages/maker-shared/src/distributionProfile.ts` | profile schema、默认官方 profile、self-host profile 校验和构建期选择 |
| `packages/maker-shared/src/branding.ts` | 展示品牌从 profile 获取，不把 OS identity 与显示文案混成一个运行时开关 |
| `apps/desktop/forge.config.ts` | app ID、exe、protocol、artifact、signing 和 updater 名从 profile 解析 |
| Desktop Vite / release scripts | 注入 `distributionId`、manifest mode、bootstrap URL、trust root、telemetry 和 update policy |
| `apps/mobile/app.config.js` | bundle / package、scheme、associated domain、OAuth plugin、updates 和 push identity 从 profile 解析 |
| `apps/mobile/scripts/lib/self-host-region.mjs` | 把“地区分包配置”改造成发行 profile 的 Mobile 构建投影，不再声称它等于 backend self-host |
| `scripts/__tests__/brand-identity-sync.test.mjs` | 覆盖 profile 到 Forge、runtime、release script 的逐字段一致性 |

#### 实现规则

- 官方 profile 是默认值，现有 CN / Global / Dev 构建和测试保持原行为。
- Self-host profile 必须显式提供独立 app ID、scheme、userData、secure-storage namespace 和品牌。
- profile 缺少身份、安全或法律必填项时构建失败，不回退 Cindy 官方值。
- profile 文件只含非机密配置；签名私钥、keystore 密码和 provider secret 继续走外部 secret。
- Desktop 与 Mobile 使用同一个 `distributionId`，但允许各平台有独立 app ID。

#### 验收

- 官方三种构建身份的现有快照不变。
- Self-host Desktop / Mobile 产物中不存在官方 app ID、scheme 或签名目标。
- 新旧发行版可并存，互不共享 userData、keychain、SecureStore、deep link 和 updater。

### 3.4 工作流 C：完成重新品牌和官方依赖清除

#### 要改什么

- 替换产品名、公司名、图标、启动图、安装器、About、菜单、通知和错误页。
- 替换 Desktop app ID / AUMID / bundle、Windows publisher、Linux desktop entry。
- 替换 Mobile bundle ID / package、scheme、Associated Domains、Universal Links 和 push topic。
- 替换 GitHub repo / issue / release、下载、网站、支持、隐私、条款、邮箱和社区链接。
- 替换 package / container scope、artifact 名、SBOM 名、update key 和发布 bucket。
- 禁用或替换 TapDB、heartbeat、log upload、analytics、feedback proxy 和 symbol upload。
- 审计 runtime binary、插件、Skill、模型 catalog 和 updater 的默认下载源。
- 保留 Apache `LICENSE`、`NOTICE`、第三方 notices 和历史 migration identifier。

#### 实现方式

建立 `external-domain-inventory.json` allowlist。packaged app 在透明代理 / DNS sink 下执行冷启动、
Skip Sign-In、Agent、设置浏览、退出和 crash restart；访问官方域名即失败。静态扫描与运行时测试
都要覆盖 Electron CSP / navigation、OAuth popup、Mobile native config、Expo updates 和 updater。

#### 验收

- 普通产品表面不再使用 Cindy 商标；归属说明仅出现在 license / About 的合法位置。
- 官方域名运行时请求为 0。
- mandatory legal 内容在无网站时也可离线读取。

### 3.5 工作流 D：改造 endpoint bootstrap 和单 realm

#### Desktop

修改 `apps/desktop/src/main/clientEndpointsService.ts`：

1. `resolveEndpointSource` 增加 packaged `embedded` 来源。
2. embedded manifest 走与 remote 相同的 schema parser，但不做网络重试、诊断或缓存。
3. remote manifest 的 bootstrap URL 和 trusted domains 来自 build-time profile。
4. self-host profile 只建立一个 realm manifest cache，不设置 peer base。
5. `getClientEndpointRealmConfig()` 对 self-host 返回
   `crossRealmOrgLoginEnabled: false`，不允许加载 peer manifest。
6. 清单切换仍是整份原子快照，不增加逐字段 fallback。

修改 `apps/desktop/src/main/endpointManifestCache.ts`：

- 官方 profile 保留当前 `cindy.com.cn` / `cindy.app` trust policy。
- Self-host profile 使用构建期固定的 trusted domains。
- cache source URL 或任一非空 endpoint 越界时 fail closed。
- 不把 trusted domains 放进远端 manifest，否则攻击者可以同时改 endpoint 和信任根。

修改 `apps/desktop/src/shared/endpoints.ts` 和构建脚本：

- 将 manifest bootstrap 与 `cdnBaseUrl` 分离。
- `cdnBaseUrl` 只表示 update / runtime artifact capability。
- update policy 为 disabled 时，空 `cdnBaseUrl` 不阻断启动。

修改 `apps/desktop/src/main/authManager.ts`：

- Self-host 禁止 CN / Global 并行 SSO discovery。
- session 保存的 issuer / realm 与 endpoint snapshot 原子绑定。
- refresh、logout、push revoke 和 account deletion 不得回退到另一个 realm。

#### Mobile

修改 `apps/mobile/src/config/clientEndpointStartup.ts`、`env.ts` 和 `app/_layout.tsx`：

- Phase 2 Self-host Mobile 只加载一个 remote manifest。
- 不解析 peer manifest，不执行跨 realm discovery。
- auth / device-link endpoint 缺失时不进入账号产品树，而不是在调用时才报错。

修改 `apps/mobile/src/update/useStartupOtaGate.ts`：

- `mobileUpdateBaseUrl === ''` 时直接 ready，关闭检查和 UI，不抛异常。
- Expo OTA native check policy 由 distribution build 决定；JS endpoint 不能假装关闭原生层行为。

#### 验收

- Local-first packaged Desktop 断网首启成功。
- Remote self-host manifest 只能来自 profile 信任的 origin。
- Self-host 不请求 peer manifest，不执行双 realm discovery。
- `cdnBaseUrl` 和 `mobileUpdateBaseUrl` 为空时更新关闭但应用可用。

### 3.6 工作流 E：扩展中央 capability 并迁移所有消费者

#### Desktop 设计

扩展现有 `apps/desktop/src/main/appCapabilities.ts`，不要另造平行系统。建议把能力拆为：

```text
canUseAccount
canUseDeviceLink
canUseManagedModels
canUseManagedVoice
canUseOAuthBroker
canUseHostedTelegramHook
canUseHostedXHook
canUseHostedSlackHook
canUploadPublicAssets
canUseFeedback
canUseSkillHubCloud
canUsePluginMarket
canPublishPlugins
canSendHeartbeat
canCheckDesktopUpdates
canOpenWebsite
```

计算输入从单一 `AppSessionMode` 扩为 distribution policy、resolved endpoints、session boundary 和
server-negotiated capabilities。通过现有 main / preload 边界向 Renderer 提供只读 snapshot 和变化
事件。Renderer 不直接读取 endpoint URL。

需要逐项迁移的 main 模块：

| 能力 | main 消费模块 |
|---|---|
| Account | `authManager.ts`、profile / deletion IPC |
| Device-link | `main/device-link/**` |
| Managed models / usage | `main/model-access/**`、`maker-host/**`、`billing/**`、`usage/**`、`cindy-media/**` |
| Voice | `main/voice-input/**` |
| OAuth | `authManager.ts`、`cindy-brain/**` |
| Hooks | `main/hook-control/**` |
| Feedback | `main/github-issue/**` |
| SkillHub | `main/skillhub/**` |
| Plugin market | `main/plugin-market/**`、`plugin-publisher/**` |
| Heartbeat | `heartbeatService.ts` |
| Updates | `manifestService.ts`、`updateService.ts`、`cindy-updater` 入口 |

Renderer 重点入口包括 Settings catalog、My Devices、Remote Control、Providers / Usage、Voice、
Hook Connections、SkillHub / Plugin 页面、About / Help、更新提示和账号菜单。每个入口既要隐藏，
其对应 main IPC 也要拒绝调用。

#### Mobile 设计

在 `apps/mobile/src/config/` 增加同构的 deployment capability projection，由 endpoint snapshot、
distribution 和 auth state 计算。`AuthContext`、device-link session、voice composer、push registration
和 update UI 全部消费它，不直接把 URL 非空检查散落在页面。

#### 测试方式

为矩阵中每个空 endpoint 建四类测试：

1. capability 为 false；
2. UI / route / menu 不可达；
3. main / native API 被直接调用时受控拒绝；
4. 没有 background timer、WS 或 fetch。

### 3.7 工作流 F：交付 Local-first Desktop

Local-first profile 的 embedded manifest 示例：

```json
{
  "schemaVersion": 1,
  "authApiBaseUrl": "",
  "deviceLinkApiBaseUrl": "",
  "oauthBrokerApiBaseUrl": "",
  "ossApiBaseUrl": "",
  "heartbeatUrl": "",
  "telegramHookWsUrl": "",
  "xHookWsUrl": "",
  "slackHookWsUrl": "",
  "websiteUrl": "",
  "modelAccessApiBaseUrl": "",
  "voiceApiBaseUrl": "",
  "githubApiBaseUrl": "",
  "skillhubApiBaseUrl": "",
  "pluginApiBaseUrl": "",
  "cdnBaseUrl": "",
  "mobileUpdateBaseUrl": ""
}
```

需要完成：

- 首启不等待 auth，直接建立 local data owner；仍保留用户以后连接 self-host control plane 的入口，
  但只有 profile 允许且 auth endpoint 存在时显示。
- 保留 BYOK、Coding Plan、本地 model、项目文件、本地 Skill、手动插件和本地 / 个人 IM。
- 托管模型、账单、hooks、市场、feedback、heartbeat、log upload 和 updater 全部不初始化。
- provider 添加、safeStorage、重启恢复、删除和日志脱敏通过 packaged 测试。
- 提供离线 artifact 和手工升级说明；不因关闭 updater 阻止使用。

验收标准：

1. 新机器断网安装和启动成功。
2. 不显示登录阻断，能创建工作区并用 BYOK / local model 完成真实任务。
3. 未部署能力无入口、无后台请求、无错误 toast。
4. 官方域名请求数为 0。
5. 与官方 Cindy 安装可并存，数据和凭证不互相读取。

### 3.8 工作流 G：创建独立服务端仓

建议目录：

```text
apps/api
apps/relay
apps/worker
packages/auth-domain
packages/device-domain
packages/media-domain
packages/contracts
packages/observability
deploy/compose
deploy/kubernetes
migrations/
```

首个 PR 只建立：

- Node runtime、lint、typecheck、test、container 和 migration 框架；
- OpenAPI / AsyncAPI 和从客户端发布的 fixture 消费方式；
- PostgreSQL、Redis、MinIO 的 Compose；
- secret schema、health / readiness、structured logging 和 request ID；
- 无业务数据的备份 / restore smoke；
- 禁止服务端直接 import 客户端仓源码。

归档 protocol package 锁定 release / commit 和 hash；需要长期维护时镜像到 fork scope，保留
license 和 provenance。不能依赖归档仓永久可安装。

### 3.9 工作流 H：实现 Auth Core

#### Phase 2 最小 API

先实现客户端启动和单一登录 provider 真正需要的 route：

- `/api/auth/providers`
- 选定 provider 的 request / verify 或 OIDC authorize / callback
- `/api/auth/token`、`/api/auth/refresh`、`/api/auth/logout`
- `/api/me`、必要的 profile update
- device registration 所需身份 claim

其他 route 在 capability / provider discovery 中明确关闭。不能返回假成功或空对象骗过客户端。

#### Token 和 key

- access token 使用非对称 JWT，严格包含 `iss`、`aud`、realm、subject、tenant、device、
  session generation、`iat`、`exp`、`kid`。
- JWKS 支持新旧 key 重叠轮换。
- refresh token 为高熵 opaque value，只保存 hash；每次 refresh 轮换并检测 reuse。
- verification code 保存 hash，绑定用途 / transaction，短 TTL、单次消费、限制尝试。
- browser auth 使用 Authorization Code + PKCE + state / nonce。
- JWT signing、object presign、update、plugin artifact key 分离。
- service-to-service 使用 mTLS / workload identity，不共享用户 JWT secret。

#### 建议数据表

```text
users, passports, tenants, memberships,
login_transactions, verification_challenges,
refresh_token_families, devices,
deletion_requests, deletion_receipts
```

组织、verified domain 和 SSO connection 不是 Phase 2 必需，可在普通账号稳定后追加。

#### 验收

- 登录、refresh rotation、reuse detection、logout、device binding 和 key rotation 通过。
- issuer / audience / realm 错误 fail closed。
- IDOR、账号枚举、验证码重放、PKCE / state 攻击和敏感日志测试通过。

### 3.10 工作流 I：实现 Device-link、媒体和 Push

#### Relay 必须实现

1. upgrade 前校验 token、issuer / audience / realm、账号和 device binding。
2. `hello` 协商 protocol version、device、instance generation 和 capability。
3. server 覆盖客户端提交的 `src`，不信任 source / tenant 字段。
4. 路由强制 same-tenant + same-account，target 必须登记、在线且允许操作。
5. `remoteControlEnabled` 在 relay 和 Desktop 双重校验。
6. 限制 frame、连接、账号吞吐和 pending invoke；拒绝 replay 和 stale generation。
7. tunnel payload opaque，不持久化，不写日志。
8. 明确 ping / pong、idle timeout、reconnect jitter、backpressure、drain 和 `1013` 行为。
9. Redis 保存 connection directory、presence、route 和 rate limit TTL；durable device 在 PostgreSQL。
10. invoke-result 绑定 caller、target、correlation ID 和 generation，迟到结果不能进入新连接。

#### 媒体

- `media_objects` 保存 owner、purpose、object key、size、hash、MIME、expiry 和 delete state。
- PUT presign 限制 owner prefix、MIME、size、checksum 和 TTL。
- GET 只对同账号且持有一次性引用的设备签发短期 URL。
- worker 清理对象和 metadata；通用 `ossApiBaseUrl` 为空不影响 device-link 专用 media route。

#### Push

- `push_registrations` 绑定 device、app identity、provider 和环境。
- payload 只包含唤醒所需最小信息，不包含 prompt、回复或附件正文。
- 登出 / 换账号时 best-effort revoke；失败 tombstone 仍绑定原 issuer，不能发给新 realm。

#### 验收

- 同账号多设备路由成功，跨账号 / 禁用控制 / replay / oversized frame 全部拒绝。
- relay、Redis 和 API 重启后受控重连，无跨 generation 迟到结果。
- presign 越权、过期、内容限制、对象清理和 push revoke 通过。

### 3.11 工作流 J：接入 Mobile

Mobile 只在 Auth Core 和 Device-link 达标后进入：

- 使用独立 app identity、OAuth redirect、Universal Link、APNs / FCM 项目。
- 删除对 CN / Global 双 realm 的依赖，只保存 self-host issuer / realm session。
- `AuthContext.tsx` 使用 server provider discovery，未声明 provider 不显示。
- device list、pairing、remote session、media、voice 和 push 都由 capability 控制。
- 更新服务未部署时 OTA / 整包检查完全关闭。
- Mobile 原生配置、原生依赖、config plugin 或模块的改动按冷更边界单独审批。

UAT 使用仓库规定的 `agent-device`：

- iOS 26.5 `iPhone 17 Pro` Simulator；
- Android `agent-device-pixel-7-api-36`，等待 `sys.boot_completed=1`；
- 覆盖首次登录、refresh、pairing、设备命名、远程调用、断网重连、push、登出和换账号；
- 测试结束关闭每个 session。

Simulator 不能替代真机 push、签名、Universal Link、TestFlight / Store 和 Play Console 验证。

### 3.12 工作流 K：按需补云能力

这些能力不进入 Phase 1 / 2 的关键路径：

| 能力 | 实现内容 | 服务未部署时 |
|---|---|---|
| Model access | model catalog、短期 gateway grant、entitlement、usage；billing 后置 | 保留 BYOK / local provider |
| OSS | 头像 / 公共资产 presign 和 lifecycle | 隐藏上传或 local-only |
| Voice | 短期 provider ticket、refine、quota | 隐藏托管 voice |
| OAuth broker | provider exchange / refresh、KMS 加密 grant | 隐藏对应 integration |
| Hooks | binding、授权、inbound dispatch、idempotent outbox、ack | 隐藏单个托管 provider |
| Plugin / SkillHub | catalog、release、ACL、publisher、scan、签名 | 保留本地 / 手动来源 |
| Updates | 签名 manifest、artifact、channel、rollout、minimum version | manual update，应用照常启动 |

BYOK 始终只保存在 Desktop `safeStorage` / Mobile SecureStore，不能上传给 self-host server。托管
model / voice 只签发短期、scope 化、不可重放的 grant，不向客户端暴露长期 provider key。

Plugin / SkillHub 改动必须保持已安装、已批准、已启用插件兼容；改到插件基座需明确 Approve。
Desktop updater 改动必须先获得 updater owner 确认。Mobile update 的原生改动另走冷更批准。

### 3.13 服务端完整数据模型

以下是分域规划，不要求 Phase 2 一次建完：

| 域 | 建议实体 |
|---|---|
| Identity | users、passports、tenants / organizations、memberships、verified domains、SSO connections |
| Auth | login transactions、verification challenges、refresh-token families、account links、deletion receipts |
| Device-link | devices、push registrations、media objects；connection / route / presence / rate limits 在 Redis TTL |
| Model | model catalog snapshots、gateway grants、entitlements、usage ledger；billing 非 MVP |
| OAuth / hooks | encrypted grants、bindings、workspaces、dispatches、idempotency receipts、outbox |
| Plugin / SkillHub | resources、releases、upload transactions、visibility grants、scan results、publisher identities |
| Updates | channels、artifacts、manifests、rollout rules、minimum-version rules、signing events |

业务表默认带 tenant ownership、审计时间和正式 migration。外键、唯一键、删除和 retention 由
contract 决定；不能直接依据本表自动生成生产 schema。

### 3.14 部署计划

#### Docker Compose

提供显式 profile：

```text
local-client   no server
core           proxy + api + relay + worker + postgres + redis + minio
cloud          core + selected optional services
```

生产基线：

- TLS、HSTS、WebSocket upgrade、body / frame limit。
- 数据库不暴露公网，app / migration / backup 使用不同角色。
- migration 是独立 job，不由多个 app instance 并发抢跑。
- PostgreSQL base backup + WAL；对象存储 versioning / lifecycle；key 有离线备份。
- Redis 视为可重建状态，丢失后通过重连恢复。
- readiness 检查 migration 和关键依赖；liveness 不制造重启风暴。
- `endpoint.json` 发布前执行 schema、origin、TLS 和 capability smoke。

#### Kubernetes

在 Compose 契约和 SLO 稳定后实现：

- stateless API、独立 relay Deployment、按 queue 分组的 worker。
- Redis / NATS 做跨 pod connection directory 和 dispatch。
- relay rollout 先摘流量、drain，再终止连接。
- HPA 使用 active sockets、event-loop lag、frame rate、pending invoke、backpressure、queue age，
  不只看 CPU。
- managed PostgreSQL / object storage / secret manager、NetworkPolicy、Pod Security、non-root、
  read-only root、seccomp、egress allowlist 和 image digest pin。

多区域不在本计划范围内。未来若增加，先重新设计 data residency、issuer、device route 和对象复制。

### 3.15 可观测性、安全与运维

#### 指标

- Auth：登录率、challenge 失败 / 限流、refresh reuse、token latency。
- Relay：连接数、握手失败、在线设备、route latency、reject reason、backpressure、reconnect。
- Worker：queue depth / age、retry、dead letter、push response、对象清理积压。
- API / DB：RED、pool saturation、slow query、transaction conflict、migration version。
- Gateway：按 tenant / provider / model 的成功率和 usage，避免高基数身份标签。

#### 日志与 trace

- JSON 日志只记录 request / trace / connection ID、稳定错误分类、大小和延迟。
- user / device ID 使用部署内 keyed hash。
- 不记录 token、email、phone、prompt、消息、文件路径、附件名、URL query 或 presigned URL。
- 客户端 log upload 默认关闭；启用时继续遵守 deny-by-default、续行记录边界、标记代次和原子清除。

#### 安全测试

- JWT algorithm / issuer / audience confusion、JWKS rotation。
- IDOR、跨 tenant route、伪造 src、stale / replay frame。
- oversized frame、连接耗尽、慢消费者、reconnect storm。
- OAuth state / PKCE / redirect、验证码枚举和账号绑定接管。
- presign key 注入、MIME 欺骗、SSRF、公开 bucket 和对象泄漏。
- hook callback 伪造、重复 dispatch、群 / workspace 授权。
- update / plugin / skill 签名、rollback 和供应链。
- admin API、备份、日志和 support export。

上线前增加依赖 / container scan、secret scan、SAST，以及 auth / relay / presign 的独立渗透测试。

### 3.16 数据迁移

独立品牌默认使用新 userData 和 secure-storage namespace。迁移是显式 import，不原地接管：

1. 只读发现旧数据，展示可导入类别。
2. 默认可导入项目、任务、本地偏好、本地 Skill 和 plugin metadata。
3. 导入前创建版本化备份和 manifest，复制到 staging，校验后原子提交。
4. SQLite 通过正式 migration / export-import adapter，不假设文件直接兼容。
5. attachment 校验 size / hash / path，不跟随越界 symlink，不导入 cache / log。
6. 失败时保留旧数据，清理 staging，生成不含敏感正文的诊断。

不导入官方 Cindy access / refresh token、组织 session、model grant、hook binding 和 push
registration。BYOK 默认重新录入；若做 secure-storage 迁移，必须逐项确认且不经过 server。
OAuth token 由新 app identity 重新授权。

官方云数据只有存在合法 export / API 时才迁移。无 export 的账号、余额、账单、市场和 server-side
history 明确标记不可迁移，不抓取私有 API。

### 3.17 测试与兼容矩阵

#### Client

- DistributionProfile schema、官方身份不回归、Self-host 构建失败策略。
- manifest embedded / remote、trust root、cache、offline、invalid schema。
- 每个 endpoint 空值的 capability、UI、IPC 和 background 测试。
- macOS / Windows / Linux packaged Local-first smoke。
- no-egress 静态扫描和透明代理运行测试。
- 独立 userData、keychain、deep link、安装 / 卸载和显式 import。

#### Auth / API

- OpenAPI / fixture、错误码、idempotency、timeout / retry。
- code expiry / replay / rate limit、PKCE、refresh rotation / reuse、logout / revoke。
- tenant isolation、IDOR、JWT confusion、key rotation 和日志脱敏。

#### Device-link

- protocol valid / invalid / unknown fixture。
- same-account routing、跨账号拒绝、remote-control policy。
- reconnect、presence healing、generation、late frame、backpressure 和 `1013`。
- relay restart、Redis loss、跨 pod route、rolling drain。
- presign、object expiry、push revoke。

#### Deployment

- Compose fresh install、幂等升级、失败 migration、服务和主机重启。
- PostgreSQL point-in-time restore、对象 restore、Redis 全丢恢复。
- Kubernetes rollout、connection drain、queue failover 和 node disruption。

#### 版本兼容

每次 server / protocol 发布运行：

```text
old client + old server
old client + new server
new client + old server
new client + new server
```

每格标注完整、降级、隐藏或受控拒绝。新 server 先兼容旧 client，再发新 client，最后在覆盖率和
回滚稳定后停旧路径。breaking change 使用新 major 和迁移窗口。

### 3.18 分阶段交付

#### Phase 0：基线固化

交付：独立品牌决策、DistributionProfile ADR、route / domain registry、capability taxonomy、
protocol pin、threat model、RPO / RTO 和 key ownership。

验收：没有未归属生产网络调用；server MVP 的关键契约没有 C 级未决项。

#### Phase 1：Local-first Desktop

交付：独立品牌、embedded manifest、单 realm、完整 capability gate、关闭官方服务和 updater、
三平台 packaged build、no-egress 和本地数据 import。

验收：断网首启并完成真实 Agent 任务；未部署能力完全不可达；官方请求为 0；新旧发行版并存。

#### Phase 2：Auth + Device-link + Mobile

交付：server auth、device registry、relay、media、push、remote manifest、Compose、Mobile build、
备份 / 恢复、监控和 runbook。

验收：登录 / refresh / logout、同账号多设备、跨账号隔离、重连、push revoke、iOS / Android UAT
和灾难恢复通过；可选云能力仍保持 gate。

#### Phase 3：可选云能力

按独立项目增加 model access、voice、OAuth / hooks、Plugin / SkillHub、updates 和 Kubernetes / HA。
每项单独验收 contract、UI gate、删除、可观测、备份和回滚。

### 3.19 PR 拆分顺序

客户端仓：

1. 本实施计划和 docs index。
2. Contract / domain registry 和 CI guard。
3. DistributionProfile schema 与官方 profile 回归测试。
4. 独立品牌和 Desktop identity。
5. Mobile identity，单独走冷更批准。
6. Desktop embedded / remote bootstrap 与 Self-host trust root。
7. 单 realm auth routing，保留官方双 realm 行为。
8. 扩展 `appCapabilities.ts`，建立 main / preload / Renderer capability snapshot。
9. 按 model、device、voice、hooks、feedback、SkillHub、plugin、update 顺序迁移 gate。
10. 去官方 telemetry、legal / support、community、download 和 update 默认值。
11. Local-first Desktop packaged / no-egress / migration。

服务端仓与跨仓：

12. Server scaffold、contract fixture、Compose 和 migration。
13. Auth core。
14. Device registry 和 relay。
15. Media、push 和 Mobile integration。
16. Model access，可选。
17. Voice、OAuth、hooks，逐项可选。
18. Plugin / SkillHub，可选并走批准门。
19. Updates，可选并先获 owner / 冷更批准。
20. Kubernetes / HA 和运营迁移工具。

每个 PR 只开启已经有 server、测试和运维证据的 capability。推荐发布顺序是：先发布保持隐藏的
server，再发布能识别能力的 client，最后修改 manifest / policy 开启；回滚时反向关闭。

### 3.20 工作量估算

按熟悉 Electron、React Native 和 Node backend 的高级工程师估算，包含实现、测试和文档，
不包含商店 / OAuth provider 审核等待：

| 工作包 | 工程人周 | 主要不确定性 |
|---|---:|---|
| Phase 0 契约、profile、威胁模型 | 3-5 | 隐藏调用和错误语义 |
| Phase 1 profile、品牌、bootstrap、capability | 8-12 | 多平台 identity 和散落入口 |
| Phase 1 no-egress、migration、三平台 UAT | 4-7 | runtime 下载、插件 / updater 隐式网络 |
| Auth core | 10-16 | provider、绑定 / 删除、邮件短信 |
| Device-link、media、push | 14-22 | relay、背压、APNs / FCM |
| Mobile 集成 | 8-12 | 冷更、签名、deep link、商店环境 |
| Compose、监控、备份、安全 | 7-11 | RPO / RTO 和渗透修复 |
| Model access，可选 | 8-14 | gateway、usage / quota |
| Voice，可选 | 4-8 | provider ticket 和隐私 |
| OAuth + 单个 hook，可选 | 8-14 | provider review、权限、幂等 |
| Plugin / SkillHub，可选 | 12-20 | scan、签名、ACL、兼容 |
| Updates，可选 | 8-14 | 多平台签名、rollout、rollback |
| Kubernetes / HA，可选 | 6-10 | relay 路由和运维成熟度 |

Phase 0-2 合计约 54-85 工程人周。3-4 名核心工程师，加兼职 QA、安全和运维，现实日历约
4-7 个月。单人应先稳定交付 Phase 1，Phase 2 按 9-15 个月规划，并砍掉组织 SSO、托管模型、
市场和自动更新。

### 3.21 风险与开工决策

| 风险 | 后果 | 控制方式 |
|---|---|---|
| 把 protocol 仓当 server | auth / state / ops 无法落地 | 从零重建 server，protocol 只作 contract |
| 只替换 endpoint | 隐式官方流量和空入口报错 | profile + capability + no-egress CI |
| 复用 Cindy identity | 商标、签名、数据和 keychain 冲突 | 独立品牌和 namespace，保留归属 |
| 复用 `dev` / region | 产品身份、realm 和更新耦合 | 新 distribution 维度，内部 realm 只作兼容 |
| 由 UI 猜 server 契约 | retry / error / state 不兼容 | A/B/C 置信度和 characterization fixture |
| relay 只做转发 | 跨账号控制、伪造 src、DoS | 双侧权限、server overwrite、限流和独立安全测试 |
| updater / plugin 破坏存量 | 无法启动或要求重装 / 重授权 | 兼容矩阵、owner / 白名单门、自动迁移 |
| Mobile 冷更被低估 | push、link 或升级链失效 | 原生改动独立 PR、审批和真机验证 |
| BYOK 进入 server | 高价值凭证泄漏 | BYOK 本地保存，云端只发短期 grant |
| 过早上微服务 / K8s | 运维成本超过产品价值 | 模块化单体 + 独立 relay，达到 SLO 后再拆 |
| 无官方 export | 云数据不能迁移 | 明确不可迁移项，只用合法 export |

进入运行时代码 PR 前，项目 owner 需要明确：独立品牌和法律主体、Local-only 还是组织部署、
首个登录 provider、是否需要 Mobile push、目标平台、数据 retention / RPO / RTO、是否运营托管
模型、更新模式，以及 JWT / signing / backup key 的持有人。
