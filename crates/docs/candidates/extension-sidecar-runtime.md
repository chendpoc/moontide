# 扩展边界与 Sidecar Runtime（候选设计）

> 状态：候选设计（notes），未实现。背景来自 TypeScript 时代 [`agent-core.md`](../../../docs/archive/spec/agent-core.md) §12 / §15，不构成当前 Rust 契约。

## 背景

MoonTide 扩展 = MCP + sidecar（扩展不进 process，见 `agent-core.md` §12、§15）。本文收敛「sidecar 的通信、隔离、runtime 成本分配」三个决策，作为将来实现的对照。

## 结论（六个决策）

1. 扩展边界 = **sidecar（进程间）**，不是 plugin（进程内）。
2. 隔离 = **OS 进程边界强制**，不是约定——第三方扩展不可信，所以强制而非约定。
3. seam 两层：核心 crate 用 **trait（进程内）**，扩展边界用 **MCP（进程间）**。
4. 通信方案 = 四层可组合取舍，第一版 **stdio + JSON-RPC**。
5. runtime 成本：**共享 runtime 默认，embedded 例外**。
6. 落地：**manifest 声明 + 共享缓存**。

## seam 分层（依赖倒置的两个粒度）

| 层 | 载体 | 声明 | 实现 | 调用方 | 契约强制力 |
|---|---|---|---|---|---|
| 进程内 seam | Rust `trait` | `trait Shell` | `impl LocalShell` | `ShellTool` | 编译期 |
| 进程间 seam | MCP（JSON-RPC 2.0） | 协议 method | MCP server 进程 | 内核 MCP client | 运行时 |

同一思想（声明 / 实现 / 调用方解耦），两个粒度。换 provider = 换 impl，调用方一行不改；把一个 trait 的 impl 换成「转发到外部 MCP server」，就把进程内 seam 变成进程间 seam。

## 通信方案（四层取舍）

```
语义层   JSON-RPC · REST · gRPC · MCP
编码层   JSON · MessagePack · Protobuf
传输层   stdio · Unix socket · TCP · HTTP/SSE
IPC 原语 pipe/FIFO · socket · shm · mq · mmap
```

- 四层自由组合，工程取舍，无唯一答案。
- 第一版 = **stdio + JSON-RPC**（MCP 默认）：隔离最纯、跨语言、零配置。
- **共享内存（shm）会削弱隔离纯度**（共享一段内存 = 部分打破进程隔离），不用。
- 需要长连接 / 并发 / 跨机时，再升级到 Unix socket / HTTP。

## runtime 成本分配（关键决策）

「支持 TS 扩展」零成本（协议语言无关）；「runtime 可用性」才是成本。

| 方案 | 体积 | 隔离 | 版本冲突 | 门槛 |
|---|---|---|---|---|
| 每个扩展打包 runtime（bun/deno compile） | **O(N)** 线性重复 | 完美 | 无（各自锁版本） | 零 |
| **共享 runtime**（下载一次复用） | **O(版本数)** 近乎恒定 | 好 | 有（多版本解析） | 低 |
| 要求用户装 node | 0 | 好 | 依赖用户版本 | 高 |

决策：**共享 runtime 为默认，embedded（打包单文件）为例外**。理由：TS 生态繁荣 → 扩展大概率很多，O(N) 重复体积爆炸；共享一份 O(版本数) 才对。

## 落地形态

扩展 manifest：

```
runtime: "shared"     → 声明依赖 { kind: "bun" | "deno" | "node", version: ">=1.1" }
runtime: "embedded"   → 作者自带单文件（锁版本 / 离线分发场景）
```

产品侧共享缓存：

```
~/.moontide/runtime/bun/1.1.x/bun      ← 下载一次，所有 shared 扩展复用
~/.moontide/runtime/deno/2.x/deno
```

## 待验证 / 后置

1. 下载源 + 镜像（国内网络可达性，见 TODO 14）。
2. 版本管理 + checksum 校验（防篡改）。
3. 离线降级 + 清晰报错。
4. 下载开关 = 总授权（用户允许自动下载），具体 runtime/版本由 manifest 声明，二者分离。
