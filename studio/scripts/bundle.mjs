#!/usr/bin/env node
/**
 * scripts/bundle.mjs —— 把 scripts/\*.ts 打包成同目录同名的 \*.mjs。
 *
 * 为什么有这一步：\*.mjs 是构建产物（rolldown / esbuild 的输出），不入库。
 * clone 或改完 src/ 之后，先跑本脚本再跑任何依赖它的脚本。
 *
 *   npm run bundle                 # 增量打包 scripts/*.ts 的全部入口
 *   npm run bundle -- render-all   # 只打包指定入口（可写多个）
 *   npm run bundle -- --force      # 忽略时间戳，强制重打
 *   npm run bundle -- --check      # 只校验产物是否最新（CI 用），不写盘
 *
 * 约定：scripts/*.ts 一律视为可直接执行的入口文件（用 `node scripts/<name>.mjs` 跑），
 * 因此新增入口只需丢一个 .ts 进来，不需要改本脚本。
 */
import fs from "node:fs";
import path from "node:path";
import { rolldown } from "rolldown";

const root = path.resolve(import.meta.dirname, "..");
const scriptsDir = path.join(root, "scripts");
const srcDir = path.join(root, "src");

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("-")));
const only = argv.filter((a) => !a.startsWith("-"));
const checkOnly = flags.has("--check");
// --check must *measure* freshness, so it never forces a rebuild; only --force does.
const force = flags.has("--force");

if (flags.has("--help") || flags.has("-h")) {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^#![^\n]*\n/, ""));
  process.exit(0);
}

/** 本目录下所有 .ts 入口（排除 .d.ts）。 */
const entries = fs
  .readdirSync(scriptsDir)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
  .map((f) => f.slice(0, -3))
  .filter((name) => only.length === 0 || only.includes(name))
  .sort();

if (entries.length === 0) {
  console.error(only.length ? `未找到匹配的入口：${only.join(", ")}` : "scripts/ 下没有 .ts 入口");
  process.exit(1);
}

/** 所有可能影响产物的输入中最新的修改时间。 */
function newestInputMtime() {
  let newest = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else newest = Math.max(newest, fs.statSync(p).mtimeMs);
    }
  };
  walk(srcDir);
  for (const f of fs.readdirSync(scriptsDir)) {
    if (f.endsWith(".ts")) newest = Math.max(newest, fs.statSync(path.join(scriptsDir, f)).mtimeMs);
  }
  for (const f of ["package.json", "tsconfig.json"]) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) newest = Math.max(newest, fs.statSync(p).mtimeMs);
  }
  return newest;
}

const inputMtime = newestInputMtime();
const stale = [];
for (const name of entries) {
  const out = path.join(scriptsDir, `${name}.mjs`);
  const fresh = fs.existsSync(out) && fs.statSync(out).mtimeMs >= inputMtime;
  if (force || !fresh) stale.push(name);
}

if (checkOnly) {
  if (stale.length) {
    console.error(`✗ 产物缺失或过期（${stale.length}/${entries.length}）：${stale.join(", ")}`);
    console.error("  请先运行：npm run bundle");
    process.exit(1);
  }
  console.log(`✓ 全部 ${entries.length} 个 *.mjs 均为最新`);
  process.exit(0);
}

if (stale.length === 0) {
  console.log(`✓ 全部 ${entries.length} 个 *.mjs 已是最新，跳过（--force 可强制重打）`);
  process.exit(0);
}

// 每个入口单独打一次：产物必须自包含（一次 build 多入口会被拆成共享 chunk）。
const failed = [];
for (const name of stale) {
  const out = path.join(scriptsDir, `${name}.mjs`);
  const bundle = await rolldown({
    input: path.join(scriptsDir, `${name}.ts`),
    platform: "node",
    resolve: { alias: { "@": srcDir } },
    logLevel: "silent",
  });
  try {
    await bundle.write({ file: out, format: "esm", sourcemap: false });
    console.log(`✓ scripts/${name}.mjs  (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
  } catch (e) {
    failed.push(name);
    console.error(`✗ scripts/${name}.ts`);
    console.error(String(e && e.message ? e.message : e).slice(0, 900));
  } finally {
    await bundle.close();
  }
}

if (failed.length) {
  console.error(`\n打包失败：${failed.join(", ")}`);
  process.exit(1);
}
console.log(`\n打包完成：${stale.length} 个入口${stale.length < entries.length ? `（其余 ${entries.length - stale.length} 个已是最新）` : ""}`);
