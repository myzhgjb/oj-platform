# Coding 在线刷题平台（OJ）

面向编程学习与竞赛的在线刷题系统：浏览题目、在线编码、提交判题、查看结果。

> **在线演示**：https://235967fdb5b644bd8e4f5c15a5f58ef7.app.workbuddy.host
> **零依赖**：仅用 Node.js 内置模块，`node server.js` 即可运行，无需数据库 / Redis / Docker。

## 判题流程

```
提交代码
   │
   ▼
异步判题队列（内存队列，模拟 MQ 削峰，前端轮询结果）
   │
   ▼
沙箱执行
   ├─ JavaScript：worker_threads 隔离 + vm 上下文
   │              （不暴露 require / fetch / process）
   │              + vm timeout 中断死循环
   │              + resourceLimits 限制内存（64MB）
   └─ Python：子进程执行 + 超时 SIGKILL（环境无 Python 时提示）
   │
   ▼
输出比对 → Accepted / Wrong Answer / TLE / RE / CE / MLE
```

## 判题状态

| 状态 | 含义 |
| --- | --- |
| `Accepted` | 全部用例通过 |
| `Wrong Answer` | 输出与期望不符 |
| `Time Limit Exceeded` | 超时（限时 2s，vm timeout / 子进程 kill） |
| `Runtime Error` | 运行异常（未捕获异常、非 0 退出） |
| `Compile Error` | 语法错误 |
| `Memory Limit Exceeded` | 超出内存上限（64MB） |

## 安全设计（沙箱）

- **不暴露危险 API**：vm 上下文只注入安全的构造器与 `input`/`console.log`，用户代码拿不到 `require`、`fs`、网络。
- **限时**：同步死循环由 vm `timeout` 中断；整体由主进程定时器兜底 `terminate()`。
- **限内存**：worker `resourceLimits.maxOldGenerationSizeMb = 64`，超限抛 `ERR_WORKER_OUT_OF_MEMORY`。
- **防 fork 炸弹**：worker 线程模型 + 单线程执行，无进程创建能力。

> 注：轻量沙箱用于演示「隔离执行」这一核心点；真实生产系统使用 Docker / gVisor 做容器级隔离（镜像只读、非 root、网络禁用、cgroup 限 CPU/内存）。

## 运行

```bash
node server.js
# 打开 http://localhost:3000
```

监听 `process.env.PORT`（默认 3000），绑定 `0.0.0.0`。

## API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/problems` | 题目列表 |
| GET | `/api/problem?id=1001` | 题目详情（含样例、起始模板、测试用例） |
| POST | `/api/submit` | `{problemId, language, code}` → `{id}` |
| GET | `/api/submission?id=xxx` | 判题结果（前端轮询） |
| GET | `/api/submissions` | 最近提交记录 |
| GET | `/api/stats` | 提交量 / 队列长度 / 状态分布 |
| GET | `/api/health` | 健康检查（含 Python 可用性） |

## 内置题目

A+B、反转字符串、最大子数组和、斐波那契数列、回文数判断、两数之和（下标）——均支持 JavaScript / Python 双语言模板。
