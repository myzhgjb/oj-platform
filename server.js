/**
 * Coding 在线刷题平台（OJ）— 零依赖 Node 实现
 * 演示：题库、在线编辑器、异步判题队列、沙箱执行（worker_threads + vm，限时限内存）、多语言、结果轮询
 *
 * 判题沙箱说明：
 *  - JavaScript：worker_threads 隔离 + vm 上下文（不暴露 require/fetch/process）+ 超时中断 + 内存上限
 *  - Python：子进程 + 超时 kill（若运行环境无 python 则提示不可用）
 *  真实生产用 Docker / gVisor 做容器级隔离，此处用轻量沙箱等价演示「隔离执行」这一核心点。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const { spawn, spawnSync } = require('child_process');
const os = require('os');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const TIME_LIMIT_MS = 2000;
const MEM_LIMIT_MB = 64;

/* ================================================================== *
 * 1. 题库
 * ================================================================== */
const PROBLEMS = [
  {
    id: 1001, title: 'A + B 问题', difficulty: '入门', tags: ['基础', '输入输出'],
    description: '输入两个整数 a 和 b（用空格分隔），输出它们的和。',
    inputFormat: '一行，两个整数 a、b，以空格分隔。',
    outputFormat: '一个整数，表示 a + b。',
    samples: [{ input: '3 5', output: '8' }],
    tests: [
      { input: '3 5', output: '8' },
      { input: '-10 4', output: '-6' },
      { input: '1000000 2000000', output: '3000000' },
    ],
    starter: {
      javascript: '// 从变量 input 读取输入，用 console.log 输出\nconst [a, b] = input.trim().split(/\\s+/).map(Number);\nconsole.log(a + b);',
      python: 'a, b = map(int, input().split())\nprint(a + b)',
    },
  },
  {
    id: 1002, title: '反转字符串', difficulty: '入门', tags: ['字符串'],
    description: '给定一个字符串 s（不含空格），输出反转后的字符串。',
    inputFormat: '一行，一个字符串 s。',
    outputFormat: '反转后的字符串。',
    samples: [{ input: 'hello', output: 'olleh' }],
    tests: [
      { input: 'hello', output: 'olleh' },
      { input: 'a', output: 'a' },
      { input: 'Suzhou', output: 'uohzuS' },
    ],
    starter: {
      javascript: 'const s = input.trim();\nconsole.log(s.split("").reverse().join(""));',
      python: 's = input().strip()\nprint(s[::-1])',
    },
  },
  {
    id: 1003, title: '最大子数组和', difficulty: '中等', tags: ['动态规划', '数组'],
    description: '给定一个整数数组，找到一个具有最大和的连续子数组，输出其最大和。',
    inputFormat: '第一行一个整数 n，第二行 n 个整数。',
    outputFormat: '一个整数，最大子数组和。',
    samples: [{ input: '9\n-2 1 -3 4 -1 2 1 -5 4', output: '6' }],
    tests: [
      { input: '9\n-2 1 -3 4 -1 2 1 -5 4', output: '6' },
      { input: '1\n-1', output: '-1' },
      { input: '5\n1 2 3 4 5', output: '15' },
    ],
    starter: {
      javascript: 'const lines = input.trim().split("\\n");\nconst n = +lines[0];\nconst nums = lines[1].trim().split(/\\s+/).map(Number);\nlet best = nums[0], cur = nums[0];\nfor (let i = 1; i < n; i++) { cur = Math.max(nums[i], cur + nums[i]); best = Math.max(best, cur); }\nconsole.log(best);',
      python: 'n = int(input())\nnums = list(map(int, input().split()))\nbest = cur = nums[0]\nfor x in nums[1:]:\n    cur = max(x, cur + x)\n    best = max(best, cur)\nprint(best)',
    },
  },
  {
    id: 1004, title: '斐波那契数列', difficulty: '入门', tags: ['递推', '动态规划'],
    description: '求斐波那契数列的第 n 项。定义 F(1)=1, F(2)=1, F(n)=F(n-1)+F(n-2)。',
    inputFormat: '一个整数 n（1 ≤ n ≤ 60）。',
    outputFormat: '第 n 项的值。',
    samples: [{ input: '7', output: '13' }],
    tests: [
      { input: '1', output: '1' },
      { input: '7', output: '13' },
      { input: '10', output: '55' },
    ],
    starter: {
      javascript: 'const n = +input.trim();\nlet a = 1, b = 1;\nfor (let i = 3; i <= n; i++) { const t = a + b; a = b; b = t; }\nconsole.log(n <= 2 ? 1 : b);',
      python: 'n = int(input())\na = b = 1\nfor _ in range(3, n + 1):\n    a, b = b, a + b\nprint(1 if n <= 2 else b)',
    },
  },
  {
    id: 1005, title: '回文数判断', difficulty: '入门', tags: ['字符串', '数学'],
    description: '给定一个整数 x，如果它是回文数则输出 true，否则输出 false。',
    inputFormat: '一个整数 x。',
    outputFormat: 'true 或 false。',
    samples: [{ input: '121', output: 'true' }],
    tests: [
      { input: '121', output: 'true' },
      { input: '-121', output: 'false' },
      { input: '10', output: 'false' },
    ],
    starter: {
      javascript: 'const s = input.trim();\nconsole.log(s === s.split("").reverse().join("") ? "true" : "false");',
      python: 's = input().strip()\nprint("true" if s == s[::-1] else "false")',
    },
  },
  {
    id: 1006, title: '两数之和（下标）', difficulty: '中等', tags: ['哈希表', '数组'],
    description: '给定一个整数数组和一个目标值 target，找出和为目标值的两个数，输出它们的下标（从 0 开始，小的在前）。保证有唯一解。',
    inputFormat: '第一行 n 和 target，第二行 n 个整数。',
    outputFormat: '两个下标，以空格分隔。',
    samples: [{ input: '4 9\n2 7 11 15', output: '0 1' }],
    tests: [
      { input: '4 9\n2 7 11 15', output: '0 1' },
      { input: '3 6\n3 2 4', output: '1 2' },
      { input: '2 6\n3 3', output: '0 1' },
    ],
    starter: {
      javascript: 'const lines = input.trim().split("\\n");\nconst [n, target] = lines[0].trim().split(/\\s+/).map(Number);\nconst nums = lines[1].trim().split(/\\s+/).map(Number);\nconst map = new Map();\nfor (let i = 0; i < n; i++) {\n  const need = target - nums[i];\n  if (map.has(need)) { console.log(map.get(need) + " " + i); break; }\n  map.set(nums[i], i);\n}',
      python: 'parts = input().split()\nn, target = int(parts[0]), int(parts[1])\nnums = list(map(int, input().split()))\nseen = {}\nfor i, x in enumerate(nums):\n    if target - x in seen:\n        print(seen[target - x], i)\n        break\n    seen[x] = i',
    },
  },
];

/* ================================================================== *
 * 2. 判题沙箱
 * ================================================================== */
function hasPython() {
  try {
    const r = spawnSync(process.env.PYTHON || 'python3', ['--version'], { timeout: 3000 });
    if (r.status === 0) return process.env.PYTHON || 'python3';
  } catch (e) {}
  try {
    const r = spawnSync('python', ['--version'], { timeout: 3000 });
    if (r.status === 0) return 'python';
  } catch (e) {}
  return null;
}
const PY = hasPython();

function normalize(s) {
  return String(s == null ? '' : s).replace(/\r\n/g, '\n').trim().replace(/[ \t]+$/gm, '');
}

/* --- JavaScript：worker_threads + vm 隔离 --- */
function runJS(code, input) {
  return new Promise((resolve) => {
    const workerSource = `
      const { parentPort, workerData } = require('worker_threads');
      const vm = require('vm');
      let out = '';
      const sandbox = {
        input: workerData.input,
        console: { log: (...a) => { out += a.map(String).join(' ') + '\\n'; } },
        JSON, Math, Array, Object, String, Number, Boolean, parseInt, parseFloat,
        isNaN, Infinity, NaN, Date, RegExp, Map, Set, BigInt, Symbol, Error,
      };
      vm.createContext(sandbox);
      try {
        vm.runInContext(workerData.code, sandbox, { timeout: workerData.timeout, filename: 'solution.js' });
        parentPort.postMessage({ output: out });
      } catch (e) {
        parentPort.postMessage({ error: String((e && e.message) || e), name: e && e.name });
      }
    `;
    let done = false;
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: { code, input, timeout: TIME_LIMIT_MS - 400 },
      resourceLimits: { maxOldGenerationSizeMb: MEM_LIMIT_MB, maxYoungGenerationSizeMb: 16 },
    });
    const kill = setTimeout(() => {
      if (!done) { done = true; worker.terminate(); resolve({ status: 'TLE' }); }
    }, TIME_LIMIT_MS);
    worker.on('message', (m) => {
      if (done) return; done = true; clearTimeout(kill); worker.terminate();
      if (m.error) {
        const text = m.name + ' ' + m.error;
        const isTimeout = /timed out|Script execution timed out|ERR_SCRIPT_EXECUTION_TIMEOUT/i.test(text);
        const isSyntax = /SyntaxError|Unexpected|Invalid or unexpected token|missing \) after/i.test(text);
        resolve({ status: isTimeout ? 'TLE' : isSyntax ? 'CE' : 'RE', error: m.error });
      } else resolve({ output: m.output });
    });
    worker.on('error', (e) => {
      if (done) return; done = true; clearTimeout(kill);
      const oom = /out of memory|ERR_WORKER_OUT_OF_MEMORY/i.test(String(e && e.message));
      resolve({ status: oom ? 'MLE' : 'RE', error: String((e && e.message) || e) });
    });
    worker.on('exit', (code) => {
      if (!done && code !== 0) { done = true; clearTimeout(kill); resolve({ status: 'RE', error: 'worker exited with code ' + code }); }
    });
  });
}

/* --- Python：子进程 + 超时 kill --- */
function runPython(code, input) {
  return new Promise((resolve) => {
    if (!PY) return resolve({ status: 'UNSUPPORTED', error: '当前运行环境未安装 Python，请切换到 JavaScript 提交' });
    const id = crypto.randomBytes(6).toString('hex');
    const tmp = path.join(os.tmpdir(), 'oj_' + id + '.py');
    fs.writeFileSync(tmp, code, 'utf8');
    let out = '', err = '', done = false;
    const child = spawn(PY, [tmp], { timeout: TIME_LIMIT_MS });
    const kill = setTimeout(() => { if (!done) { done = true; try { child.kill('SIGKILL'); } catch (e) {} resolve({ status: 'TLE' }); } }, TIME_LIMIT_MS + 300);
    child.stdin.write(input);
    child.stdin.end();
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('close', (code) => {
      try { fs.unlinkSync(tmp); } catch (e) {}
      if (done) return; done = true; clearTimeout(kill);
      if (code === null) return resolve({ status: 'TLE' });
      if (/SyntaxError|IndentationError/i.test(err)) return resolve({ status: 'CE', error: err.trim() });
      if (code !== 0) return resolve({ status: 'RE', error: err.trim() || 'exit code ' + code });
      resolve({ output: out });
    });
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(kill); resolve({ status: 'RE', error: String(e.message) }); } });
  });
}

async function judge(problem, language, code) {
  const results = [];
  let status = 'Accepted';
  for (let i = 0; i < problem.tests.length; i++) {
    const t = problem.tests[i];
    let r;
    if (language === 'python') r = await runPython(code, t.input);
    else r = await runJS(code, t.input);

    if (r.status && r.status !== 'Accepted') {
      results.push({ index: i + 1, status: r.status, input: t.input, expected: t.output, got: r.output ?? '', message: r.error });
      status = r.status; break;
    }
    const got = normalize(r.output);
    const ok = got === normalize(t.output);
    results.push({ index: i + 1, status: ok ? 'Accepted' : 'Wrong Answer', input: t.input, expected: t.output, got });
    if (!ok) { status = 'Wrong Answer'; break; }
  }
  return { status, passed: results.filter(r => r.status === 'Accepted').length, total: problem.tests.length, results };
}

/* ================================================================== *
 * 3. 异步判题队列（模拟 MQ 削峰）
 * ================================================================== */
const submissions = new Map();
const queue = [];
let processing = false;
const stats = { total: 0, byStatus: {} };

function enqueue(sub) {
  submissions.set(sub.id, sub);
  queue.push(sub);
  if (!processing) processQueue();
}
async function processQueue() {
  processing = true;
  while (queue.length) {
    const sub = queue.shift();
    sub.status = 'Judging';
    sub.queueLen = queue.length;
    const problem = PROBLEMS.find(p => p.id === sub.problemId);
    const t0 = Date.now();
    try {
      const r = await judge(problem, sub.language, sub.code);
      Object.assign(sub, r, { finishedAt: Date.now(), timeMs: Date.now() - t0, status: r.status });
    } catch (e) {
      sub.status = 'System Error'; sub.message = String(e.message || e);
    }
    stats.byStatus[sub.status] = (stats.byStatus[sub.status] || 0) + 1;
  }
  processing = false;
}

/* ================================================================== *
 * 4. HTTP 服务
 * ================================================================== */
function sendJson(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
  res.end(buf);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 2e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (u.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, problems: PROBLEMS.length, python: PY || null, queue: queue.length });
    }
    if (u.pathname === '/api/problems') {
      return sendJson(res, 200, { problems: PROBLEMS.map(p => ({ id: p.id, title: p.title, difficulty: p.difficulty, tags: p.tags })) });
    }
    if (u.pathname === '/api/problem') {
      const id = Number(u.searchParams.get('id'));
      const p = PROBLEMS.find(x => x.id === id);
      return p ? sendJson(res, 200, p) : sendJson(res, 404, { error: '题目不存在' });
    }
    if (u.pathname === '/api/stats') {
      return sendJson(res, 200, { total: stats.total, byStatus: stats.byStatus, queue: queue.length, processing });
    }
    if (u.pathname === '/api/submissions') {
      const list = [...submissions.values()].slice(-20).reverse().map(s => ({
        id: s.id, problemId: s.problemId, language: s.language, status: s.status,
        passed: s.passed, total: s.total, timeMs: s.timeMs, at: s.at,
      }));
      return sendJson(res, 200, { submissions: list });
    }
    if (u.pathname === '/api/submission') {
      const id = u.searchParams.get('id');
      const s = submissions.get(id);
      if (!s) return sendJson(res, 404, { error: '提交不存在' });
      return sendJson(res, 200, {
        id: s.id, problemId: s.problemId, language: s.language, status: s.status,
        passed: s.passed, total: s.total, timeMs: s.timeMs, results: s.results, message: s.message,
        queueLen: s.queueLen,
      });
    }
    if (req.method === 'POST' && u.pathname === '/api/submit') {
      const body = await readBody(req);
      const problemId = Number(body.problemId);
      const language = body.language === 'python' ? 'python' : 'javascript';
      const code = String(body.code || '');
      const problem = PROBLEMS.find(p => p.id === problemId);
      if (!problem) return sendJson(res, 400, { error: '题目不存在' });
      if (!code.trim()) return sendJson(res, 400, { error: '代码不能为空' });
      if (code.length > 20000) return sendJson(res, 400, { error: '代码过长（上限 20KB）' });
      const id = crypto.randomBytes(8).toString('hex');
      stats.total++;
      const sub = { id, problemId, language, code, status: 'Pending', at: Date.now() };
      enqueue(sub);
      return sendJson(res, 200, { id, status: 'Pending', queuePosition: queue.length });
    }

    let p = decodeURIComponent(u.pathname);
    if (p === '/') p = '/index.html';
    const fp = path.join(PUBLIC_DIR, p);
    if (!fp.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
    fs.readFile(fp, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404 Not Found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      res.end(buf);
    });
  } catch (e) {
    sendJson(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[oj-platform] listening on http://${HOST}:${PORT}  python=${PY || 'none'}`);
});
