#!/usr/bin/env node
/**
 * 开发模式前置清理：为 F5 二次启动扫清残留进程。
 *
 * 背景
 *   `npm run dev` 用 concurrently 同时拉起 Vite 与 Electron。关闭应用窗口后，
 *   Electron 会走 before-quit 的异步清理链（依次关闭 officialAccount / donation /
 *   agentService / autoConfirmation / openXmlHelper，其中 agentService.close()
 *   内部还要清 piRuntimeService 与 OpenAI 代理）。这条链一旦慢或挂住，主进程
 *   就不退出，concurrently 收不到信号也就不会去结束 Vite，于是 5173 被残留进程占住。
 *   Vite 以 --strictPort 启动，端口被占即直接失败 —— 表现为「再按 F5 起不来，
 *   重开 VSCode 才行」。
 *
 *   另一个常见残留是 Electron 自身：GPU 子进程崩溃（exit_code 0xC0000005）会触发
 *   main.cjs 里的 relaunchWithGpuDisabled() 自动重启，若反复崩溃，就会留下若干
 *   electron.exe 僵尸进程。它们未必占 5173，但会干扰下一次启动。
 *
 * 做法（两步，都很保守）
 *   1. 端口清理：找出「确实在监听目标端口」的 PID 并结束其进程树。
 *   2. 残留清理：找出命令行指向本项目的 electron.exe 并结束。
 *   两步都基于精确匹配（端口号 / 项目绝对路径），绝不按进程名批量 kill，
 *   因此不会误伤 VSCode、WorkBuddy 或用户其他 node 程序。
 *
 * 用法
 *   node scripts/dev-clean-port.cjs [port]        # 默认 5173
 *   node scripts/dev-clean-port.cjs --check       # 只探测不清理
 *   node scripts/dev-clean-port.cjs --no-electron # 跳过 electron 残留清理
 *
 * 退出码始终为 0：清理失败不应阻塞开发流程，问题交由 Vite 自己报错暴露。
 */

const { execFileSync } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const DEFAULT_PORT = 5173;
const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const skipElectron = argv.includes('--no-electron');
const portArg = argv.find((a) => /^\d+$/.test(a));
const port = portArg ? Number(portArg) : DEFAULT_PORT;

// 项目 client 目录的绝对路径，用作 electron 进程命令行匹配锚点。
// 脚本位于 <repo>/client/scripts/，故上一级即 client。
const PROJECT_CLIENT_DIR = path.resolve(__dirname, '..');

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`[dev-clean] 端口无效：${portArg}`);
  process.exit(0);
}

function run(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      ...options,
    });
  } catch {
    return '';
  }
}

/**
 * 快速预检：直接尝试连接端口。空闲时立刻返回，免去调用 netstat 的开销
 * （netstat -ano 要扫描全表，通常要 1 秒以上，而这是最常见的情形）。
 */
function isPortInUse(targetPort) {
  return new Promise((resolve) => {
    const socket = net.connect({ port: targetPort, host: '127.0.0.1' });
    const done = (inUse) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(400);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(true)); // 超时视为被占用，交给 netstat 复核
    socket.once('error', () => done(false));  // ECONNREFUSED = 空闲
  });
}

/** 解析 netstat 输出，取出处于 LISTENING 且端口匹配的 PID。 */
function findListeningPids(targetPort) {
  const output = run('netstat', ['-ano', '-p', 'TCP']);
  if (!output) return [];

  const pids = new Set();
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !/LISTENING/i.test(line)) continue;

    // 形如：TCP    127.0.0.1:5173    0.0.0.0:0    LISTENING    18832
    const columns = line.split(/\s+/);
    if (columns.length < 5) continue;

    const localAddress = columns[1];
    const pid = Number(columns[columns.length - 1]);
    if (!Number.isInteger(pid) || pid <= 0) continue;

    // 只比较端口号，兼容 127.0.0.1:5173 / [::1]:5173 / 0.0.0.0:5173
    const lastColon = localAddress.lastIndexOf(':');
    if (lastColon < 0) continue;
    if (Number(localAddress.slice(lastColon + 1)) !== targetPort) continue;

    pids.add(pid);
  }
  return [...pids];
}

/**
 * 通过 PowerShell 取 electron.exe 的 PID + 命令行。
 * 用 CIM 而非 tasklist，因为只有 CIM 能拿到 CommandLine（判断是否属于本项目）。
 * 输出格式：每行 `PID<TAB>CommandLine`
 */
function findProjectElectronPids() {
  if (process.platform !== 'win32') return [];

  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$procs = Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\"",
    'if ($procs) {',
    '  foreach ($p in $procs) {',
    '    $cl = $p.CommandLine; if ($null -eq $cl) { $cl = "" }',
    '    Write-Output ("{0}`t{1}" -f $p.ProcessId, $cl)',
    '  }',
    '}',
  ].join('; ');

  const output = run('powershell', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ]);
  if (!output) return [];

  const found = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const tabIndex = line.indexOf('\t');
    if (tabIndex <= 0) continue;

    const pid = Number(line.slice(0, tabIndex));
    const cmdline = line.slice(tabIndex + 1).trim();
    if (!Number.isInteger(pid) || pid <= 0) continue;

    // 精确锚点匹配：命令行必须包含本项目 client 目录的绝对路径
    if (!cmdline) continue;
    if (!cmdline.toLowerCase().includes(PROJECT_CLIENT_DIR.toLowerCase())) continue;

    found.push({ pid, cmdline });
  }
  return found;
}

function killTree(pid) {
  if (process.platform === 'win32') {
    // /T 连同子进程，/F 强制
    run('taskkill', ['/F', '/T', '/PID', String(pid)]);
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* 进程可能已自行退出 */
  }
}

const sleepSync = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

async function cleanPort() {
  // 第一步：直接探端口。空闲是最常见情形，这里立刻结束，不付 netstat 的代价。
  if (!(await isPortInUse(port))) {
    console.log(`[dev-clean] 端口 ${port} 空闲，无需清理`);
    return;
  }

  // 第二步：确实被占用，再拿 netstat 精确定位 PID
  const pids = findListeningPids(port);
  if (pids.length === 0) {
    console.log(`[dev-clean] 端口 ${port} 探测到占用但未取得 PID，跳过清理`);
    return;
  }

  console.log(`[dev-clean] 端口 ${port} 被占用，PID: ${pids.join(', ')}`);

  if (checkOnly) {
    console.log('[dev-clean] --check 模式，仅探测不清理');
    return;
  }

  for (const pid of pids) {
    killTree(pid);
    console.log(`[dev-clean] 已结束进程树 PID=${pid}`);
  }

  // taskkill 是同步的，进程通常已随之消失；最多轮询 3 次（约 300ms）确认
  let released = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!(await isPortInUse(port))) {
      released = true;
      break;
    }
    sleepSync(100);
  }

  if (released) {
    console.log(`[dev-clean] 端口 ${port} 已释放`);
  } else {
    console.warn(`[dev-clean] 警告：端口 ${port} 仍被占用，Vite 可能仍会启动失败`);
  }
}

/**
 * 清理属于本项目的 electron.exe 残留。
 * 只按命令行里的项目绝对路径匹配，不碰任何其他 Electron 应用。
 */
function cleanProjectElectron() {
  if (process.platform !== 'win32') return;

  const found = findProjectElectronPids();
  if (found.length === 0) {
    console.log('[dev-clean] 无本项目 Electron 残留进程');
    return;
  }

  console.log(`[dev-clean] 发现 ${found.length} 个本项目 Electron 残留：`);
  for (const { pid, cmdline } of found) {
    const short = cmdline.length > 120 ? `${cmdline.slice(0, 120)}...` : cmdline;
    console.log(`[dev-clean]   PID=${pid}  ${short}`);
  }

  if (checkOnly) {
    console.log('[dev-clean] --check 模式，仅探测不清理');
    return;
  }

  for (const { pid } of found) {
    killTree(pid);
    console.log(`[dev-clean] 已结束进程树 PID=${pid}`);
  }
}

async function main() {
  console.log(`[dev-clean] 项目目录：${PROJECT_CLIENT_DIR}`);
  await cleanPort();
  if (!skipElectron) cleanProjectElectron();
  console.log('[dev-clean] 清理完成');
}

main()
  .catch(() => {
    /* 清理失败不应阻塞开发流程 */
  })
  .finally(() => process.exit(0));
