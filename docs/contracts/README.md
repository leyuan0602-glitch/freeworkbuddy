# 网络契约与外部域名台账

> FreeWorkBuddy self-hosting 改造**工作流 A**（蓝图
> [`../self-hosting-implementation-blueprint.md`](../self-hosting-implementation-blueprint.md) §3.2）的
> 交付物。Phase 0 的核心资产：服务端重建、capability gate 与 no-egress 验收都以这里为准。

## 文件

| 文件 | 内容 | 门禁 |
|---|---|---|
| [`network-contract-registry.json`](./network-contract-registry.json) | 本仓全部**自建 server** HTTP/WS 契约（route、auth、schema、错误、置信度） | `pnpm check:network-contract` |
| [`external-domain-inventory.json`](./external-domain-inventory.json) | 生产代码出现的**全部外部域名**台账 + no-egress allowlist | `pnpm check:self-host-egress` |
| `scripts/check-network-contract-registry.mjs` | registry 双向覆盖校验（源码 ↔ registry） | CI（client-ci → verify-checks） |
| `scripts/check-self-host-egress.mjs` | 域名台账双向校验（源码 ↔ inventory） | CI（client-ci → verify-checks） |

## 置信度合同

| 级别 | 语义 | server 重建门槛 |
|---|---|---|
| A | 有 runtime parser（zod / protocol package）和测试 | 可直接实现 |
| B | 有 typed consumer，无严格 runtime parser | 实现前先补 characterization fixture |
| C | 只从 UI / 错误处理推断 | 不得作为 server 实现依据 |

当前 C 级仅 `telemetry.tapdb`（官方发行版专属，self-host 关闭）。B 级条目按蓝图要求在
server MVP 对应能力开工前升级。

## 扫描语义（check 脚本）

两道门禁**刻意采用不同提取策略**：

- **registry（/api/ 路径）用字符串字面量提取**：小型词法状态机剥离注释、跳过正则
  字面量、归一化模板插值（`${...}` → `:param`）。注释里的示例路径不算调用。
  归一化规则：query（`?` 起）截断；尾部紧贴段尾的 `:param`（`${qs}` 型拼接）截断；
  `/x/:param` 型末段插值保留。
- **inventory（域名）用全文正则（含注释）**：宁可多登记也不漏掉一个 egress 面，
  注释里的官方/第三方域名同样是 self-host 改造（工作流 C）的移除清单。

### registry 匹配与豁免

- 源码扫描 path 与 registry `path` 逐段匹配（`:param` 段互配）。
- `pathValidation: 'source-literal'`：非 `/api/` 前缀或跨字面量拼接的 route（如
  `${CREDENTIALS_PATH}/rotate`、`/heartbeat`），用 `sourceLiteral` 在字面量原文中锚定。
- `pathValidation: 'none'`：URL 完全由响应给出（presigned URL / artifact file），
  不参与双向校验，靠 `callsites` + 测试锚定。
- `registryCoverage.pathExemptions`（精确）与 `pathPrefixExemptions`（按段边界前缀）：
  登记非调用的路径字面量（logLabel、错误分类字符串）与第三方直连 API 固定路径。
- `registryCoverage.scanExcludes`：整目录范围排除（第三方 client 包、recipe 数据、
  vendor bundle、provider catalog 数据）。

### inventory 匹配

- host 精确命中，或落在 `allowSubdomains: true` 条目之下（如 `example.com` 家族、
  RFC 2606 保留 TLD `invalid`）。
- **official-cindy 母域（cindy.com.cn / cindy.app）`allowSubdomains: false`**：
  官方域名下新增子域必须逐个登记，防止悄悄增加官方 egress 面。
- 仅存在于代码扩展名之外（README 等文档）的域名标 `manualEntry: true`。
- `disposition: 'needs-triage'` 的条目会被门禁拒绝——自动发现的新域名必须先分类。

## 何时改这里

| 场景 | 动作 |
|---|---|
| 新增生产网络调用（自建 server） | registry 加 route； Callsites 指到函数；置信度按合同标 |
| 新增第三方集成 / provider 直连 | inventory 加域名（category + disposition）；固定路径进 `pathPrefixExemptions` |
| 删除调用 / 域名 | 同步删条目（正反向校验都会抓腐化） |
| Self-host 发行版（工作流 C/D） | official-runtime 域名请求为 0 是运行时测试目标；inventory 条目在代码移除后同步删除 |
| server MVP 开工 | 逐域把 B 级升级为 A（补 characterization fixture），清空 knownGaps |

本目录不承载机密（endpoint 值仍在 `config/endpoint*.json`）也不承载服务端实现
（服务端在 `freeworkbuddy-server` 独立仓，按本 registry 重建契约）。
