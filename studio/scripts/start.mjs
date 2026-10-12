/**
 * 启动脚本：以 Electron 方式拉起桌面程序。
 * 注意：本机环境里可能带着 ELECTRON_RUN_AS_NODE=1（父进程是 Electron 时会继承），
 * 那样 electron.exe 会退化成纯 Node，这里显式清掉再 spawn。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const bin = path.join(root, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
if (!fs.existsSync(bin)) {
  console.error("未找到 Electron：请先 npm install");
  process.exit(1);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const args = [root, ...process.argv.slice(2)];
const child = spawn(bin, args, { stdio: "inherit", env });
child.on("close", (code) => process.exit(code ?? 0));
