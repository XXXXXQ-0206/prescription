/**
 * 二维码编码交叉验证：studio/src/lib/qr.ts  vs  Python 参考实现（python-qrcode 8.x）
 *
 * 验证层次：
 *   [1] 业务输入逐格比对：先让参考实现自动选版本，再对 mask_pattern=0..7 逐个固定掩码生成矩阵；
 *       本实现用 qrMatrixEx(text, { version, mask }) 生成"同版本 + 同掩码"的矩阵，逐格比对；
 *       最后比双方"自动选掩码"的最终矩阵。
 *       参考实现固定 Byte 模式（QRData(..., mode=MODE_8BIT_BYTE)）与纠错等级 M，避免模式差异。
 *   [2] 版本 1~10 全覆盖逐格比对：每个版本取"刚好塞满"的载荷，同样做 8 种固定掩码 + 自动掩码比对。
 *   [3] 参数表比对：RS 分块方案与每版本数据容量，与参考实现的 rs_blocks / BIT_LIMIT_TABLE 对齐。
 *   [4] 掩码罚分规则交叉验证：逐值比对双方四条罚分规则的得分，并比较两种打分口径的 argmin。
 *   [5] 渲染回读：把矩阵交给 typst 画成 PNG（带 4 模块静默区），再用 OpenCV QRCodeDetector
 *       解码，验证"扫出来的就是原文"。
 *
 * 运行：
 *   npx esbuild scripts/test-qr.ts --bundle --format=esm --platform=node --outfile=scripts/test-qr.mjs '--alias:@=./src'
 *   node scripts/test-qr.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { qrInfo, qrMatrix, qrMatrixEx } from "../src/lib/qr.ts";
import { QR_HELPER, qrBlock } from "../src/templates/kit.ts";

const PYTHON = process.env.PYTHON ?? "python";
const TYPST = path.resolve("resources", process.platform === "win32" ? "typst.exe" : "typst");
const OUT_DIR = path.resolve("out", "qr-verify");

/* ───────────────────────── 测试输入 ───────────────────────── */

interface TestCase {
  kind: string;
  name: string;
  text: string;
  /** 预期超出版本 10 容量：参考实现会选到 11+，本实现必须返回 null */
  expectNull?: boolean;
}

const LONG_CN =
  "黄连9g 黄芩12g 黄柏9g 栀子10g 金银花15g 连翘12g 板蓝根15g " +
  "水煎服，每日一剂，分两次温服。忌辛辣油腻，服药期间多饮温水。";
const OVERFLOW_CN = LONG_CN + "另加：本方适用于风热感冒初起，症见发热、咽痛、咳嗽、口渴等，请遵医嘱服用。";

const CASES: TestCase[] = [
  { kind: "纯数字", name: "手机号", text: "13800138000" },
  { kind: "纯ASCII", name: "短英文", text: "HELLO WORLD 123" },
  { kind: "URL", name: "郑州中心医院缴费链接", text: "https://pay.zzszxyy.com/rx/20260507009159" },
  { kind: "中文", name: "中文处方说明", text: "处方笺：郑州市中心医院 药费 260.90 元 扫码支付" },
  { kind: "中英混排", name: "中英混排处方", text: "Patient 张伟 / 诊断 2型糖尿病 / 药品 二甲双胍缓释片 0.5g×30 / 用法 口服 每日一次" },
  { kind: "emoji", name: "含 emoji 与全角符号", text: "支付成功 ✅ ￥134.65 → 重庆中医院" },
  { kind: "长中文", name: "长中文（触发高版本）", text: LONG_CN },
  { kind: "边界", name: "版本 10 容量边界 213 字节", text: "A".repeat(213) },
  { kind: "超限", name: "214 字节（超出容量，应返回 null）", text: "A".repeat(214), expectNull: true },
  { kind: "超限", name: "超长中文（" + "" + "超出容量，应返回 null）", text: OVERFLOW_CN, expectNull: true },
];

const FITTING_CASES = CASES.filter((c) => !c.expectNull);

/* ───────────────────────── Python 参考实现 ───────────────────────── */

const PY_REFERENCE = String.raw`# -*- coding: utf-8 -*-
"""参考实现：python-qrcode 生成逐格矩阵（固定 Byte 模式 + 纠错等级 M）。"""
import json, sys
import qrcode
import qrcode.util
from qrcode import constants
from qrcode.util import QRData, MODE_8BIT_BYTE, BIT_LIMIT_TABLE
from qrcode.base import rs_blocks

EC = constants.ERROR_CORRECT_M
payload_path, out_path = sys.argv[1], sys.argv[2]
with open(payload_path, encoding="utf-8") as fh:
    payload = json.load(fh)


def rows(modules):
    return ["".join("1" if c else "0" for c in row) for row in modules]


def build(version, mask, raw):
    qr = qrcode.QRCode(version=version, error_correction=EC, box_size=1, border=0, mask_pattern=mask)
    qr.add_data(QRData(raw, mode=MODE_8BIT_BYTE, check_data=False))
    qr.make(fit=(version is None))
    return qr


def analyse(case):
    raw = case["text"].encode("utf-8")
    entry = {"name": case["name"], "bytes": len(raw), "masks": {}}
    try:
        auto = build(None, None, raw)
    except Exception as exc:
        entry["overflow"] = "%s: %s" % (type(exc).__name__, exc)
        return entry
    version = auto.version
    chosen = auto.best_mask_pattern()
    entry["version"] = version
    entry["autoMask"] = chosen
    entry["auto"] = rows(build(version, chosen, raw).modules)
    entry["lostPointsFinal"] = []
    entry["lostPoints"] = []
    for mask in range(8):
        qr = build(version, mask, raw)
        entry["lostPointsFinal"].append(qrcode.util.lost_point(qr.modules))
        qr.makeImpl(True, mask)   # 与 best_mask_pattern 相同的打分矩阵（格式信息视为浅色）
        entry["lostPoints"].append(qrcode.util.lost_point(qr.modules))
        entry["masks"][str(mask)] = rows(build(version, mask, raw).modules)
    return entry


out = {"blocksM": {}, "bitLimitM": {}, "cases": [], "coverage": []}
for v in range(1, 11):
    out["blocksM"][str(v)] = [[b.total_count, b.data_count] for b in rs_blocks(v, EC)]
    out["bitLimitM"][str(v)] = BIT_LIMIT_TABLE[EC][v]

for case in payload["cases"]:
    out["cases"].append(analyse(case))
for case in payload["coverage"]:
    out["coverage"].append(analyse(case))

with open(out_path, "w", encoding="utf-8") as fh:
    json.dump(out, fh, ensure_ascii=True)
print("python-qrcode reference: %d business cases + %d version-coverage cases" % (len(out["cases"]), len(out["coverage"])))
`;

const PY_DECODE = String.raw`# -*- coding: utf-8 -*-
"""用 OpenCV 的二维码检测器解码渲染出的 PNG，验证矩阵真的能被扫出来。"""
import json, sys
import numpy as np
import cv2

payload = json.load(open(sys.argv[1], encoding="utf-8"))
results = []
det = cv2.QRCodeDetector()
for item in payload["images"]:
    raw = open(item["png"], "rb").read()
    img = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    decoded, ok, how = None, False, "decode-failed"
    if img is not None:
        how = "not-detected"
        for scale in (1, 2, 3):
            cur = img if scale == 1 else cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
            data, points, _ = det.detectAndDecode(cur)
            if points is not None and data:
                decoded, ok, how = data, True, "scale=%d" % scale
                break
            if points is not None:
                how = "detected-but-empty@scale=%d" % scale
    if ok and item.get("crop") and points is not None:
        pts = points.reshape(-1, 2)
        x0 = int(max(0, pts[:, 0].min() - 16))
        y0 = int(max(0, pts[:, 1].min() - 16))
        x1 = int(min(img.shape[1], pts[:, 0].max() + 16))
        y1 = int(min(img.shape[0], pts[:, 1].max() + 16))
        crop = cv2.resize(img[y0:y1, x0:x1], None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
        wrote, buf = cv2.imencode(".png", crop)
        if wrote:
            open(item["crop"], "wb").write(buf.tobytes())
    results.append({"name": item["name"], "ok": ok, "decoded": decoded, "how": how})
json.dump(results, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=True)
`;

/* ───────────────────────── 类型 ───────────────────────── */

interface RefCase {
  name: string;
  bytes: number;
  version?: number;
  autoMask?: number;
  auto?: string[];
  masks?: Record<string, string[]>;
  lostPoints?: number[];
  lostPointsFinal?: number[];
  overflow?: string;
}
interface RefData {
  blocksM: Record<string, number[][]>;
  bitLimitM: Record<string, number>;
  cases: RefCase[];
  coverage: RefCase[];
}

/* ───────────────────────── 工具 ───────────────────────── */

/** 超出本实现支持范围（版本 10 上限）：参考实现可能选到 11+ 版本，本实现必须返回 null */
const outOfRange = (rc: RefCase) => rc.overflow !== undefined || (rc.version ?? 0) > 10;

/** 逐格比对 */
function diff(mine: boolean[][] | null, ref: string[]): { cells: number; bad: number; first?: string } {
  if (!mine) return { cells: 0, bad: Number.POSITIVE_INFINITY, first: "本实现返回 null" };
  const n = ref.length;
  if (mine.length !== n || mine.some((r) => r.length !== n)) {
    return {
      cells: 0,
      bad: Number.POSITIVE_INFINITY,
      first: "尺寸不同：本实现 " + mine.length + "x" + (mine[0] ? mine[0].length : 0) + "，参考 " + n + "x" + n,
    };
  }
  let bad = 0;
  let first: string | undefined;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (mine[r][c] !== (ref[r][c] === "1")) {
        bad++;
        if (!first) first = "(row=" + r + ", col=" + c + ") 本实现=" + (mine[r][c] ? 1 : 0) + " 参考=" + ref[r][c];
      }
    }
  }
  return { cells: n * n, bad, first };
}

/**
 * 与参考实现同口径的四条罚分规则（ISO/IEC 18004 7.8.3.1）。
 * 这里重写一遍是为了逐值核对 qr.ts 内部罚分实现的正确性。
 */
function lostPoint(grid: boolean[][]): number {
  const n = grid.length;
  let lost = 0;

  for (let i = 0; i < n; i++) {
    let runRow = 1;
    let runCol = 1;
    for (let j = 1; j < n; j++) {
      if (grid[i][j] === grid[i][j - 1]) runRow++;
      else {
        if (runRow >= 5) lost += runRow - 2;
        runRow = 1;
      }
      if (grid[j][i] === grid[j - 1][i]) runCol++;
      else {
        if (runCol >= 5) lost += runCol - 2;
        runCol = 1;
      }
    }
    if (runRow >= 5) lost += runRow - 2;
    if (runCol >= 5) lost += runCol - 2;
  }

  for (let r = 0; r + 1 < n; r++) {
    for (let c = 0; c + 1 < n; c++) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) lost += 3;
    }
  }

  const PAT_A = [true, false, true, true, true, false, true, false, false, false, false];
  const PAT_B = [false, false, false, false, true, false, true, true, true, false, true];
  const hit = (get: (k: number) => boolean, s: number) => {
    let a = true;
    let b = true;
    for (let k = 0; k < 11; k++) {
      const v = get(s + k);
      if (v !== PAT_A[k]) a = false;
      if (v !== PAT_B[k]) b = false;
      if (!a && !b) return false;
    }
    return true;
  };
  for (let r = 0; r < n; r++) for (let c = 0; c + 10 < n; c++) if (hit((k) => grid[r][k], c)) lost += 40;
  for (let c = 0; c < n; c++) for (let r = 0; r + 10 < n; r++) if (hit((k) => grid[k][c], r)) lost += 40;

  let dark = 0;
  for (const row of grid) for (const v of row) if (v) dark++;
  const percent = dark / (n * n);
  lost += Math.trunc(Math.abs(percent * 100 - 50) / 5) * 10;
  return lost;
}

/**
 * 参考实现打分时用的矩阵：格式信息位、暗模块、版本信息位全部当作浅色
 * （python-qrcode 的 makeImpl(test=True) 就是这么做的）。
 */
function refStyleGrid(mat: boolean[][], version: number): boolean[][] {
  const n = mat.length;
  const g = mat.map((row) => row.slice());
  const blank = (r: number, c: number) => {
    g[r][c] = false;
  };
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      blank(i, 8);
      blank(8, i);
    }
  }
  for (let i = n - 8; i < n; i++) {
    blank(i, 8);
    blank(8, i);
  }
  if (version >= 7) {
    for (let r = 0; r < 6; r++) {
      for (let c = n - 11; c <= n - 9; c++) {
        blank(r, c);
        blank(c, r);
      }
    }
  }
  return g;
}

const isWide = (ch: string) =>
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(ch);
const dispWidth = (s: string) => Array.from(s).reduce((w, ch) => w + (isWide(ch) ? 2 : 1), 0);
const pad = (s: string, width: number) => s + " ".repeat(Math.max(0, width - dispWidth(s)));

function asciiQr(mat: boolean[][]): string {
  return mat.map((row) => row.map((v) => (v ? "██" : "  ")).join("")).join("\n");
}

function runPython(script: string, args: string[], label: string): void {
  // Unique, private directory per invocation: never write to a predictable name in os.tmpdir().
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-qr-verify-"));
  const file = path.join(dir, "verify.py");
  let res: ReturnType<typeof spawnSync>;
  try {
    fs.writeFileSync(file, script, "utf8");
    res = spawnSync(PYTHON, [file, ...args], { stdio: ["ignore", "inherit", "inherit"] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (res.error) {
    console.error("");
    console.error("无法执行 " + PYTHON + "：" + res.error.message);
    console.error("请确认已安装 python 与 qrcode（python -m pip install qrcode）；也可用 PYTHON 环境变量指定解释器。");
    process.exit(2);
  }
  if (res.status !== 0) {
    console.error("");
    console.error(label + " 失败，退出码 " + res.status);
    process.exit(2);
  }
}

/* ───────────────────────── 比对核心 ───────────────────────── */

interface Report {
  cells: number;
  fixedCells: number;
  autoCells: number;
  bad: number;
  maskMatrices: number;
  maskBad: number;
  autoBad: number;
  autoMaskSame: boolean;
  versionOk: boolean;
  maskMarks: string[];
  failures: string[];
}

function compareCase(tc: TestCase, rc: RefCase): Report {
  const failures: string[] = [];
  const info = qrInfo(tc.text);
  const mineAuto = qrMatrix(tc.text);
  let cells = 0;
  let autoCells = 0;
  let bad = 0;
  let maskBad = 0;
  let maskMatrices = 0;
  const maskMarks: string[] = [];

  if (outOfRange(rc)) {
    const explicitNull = qrMatrixEx(tc.text, { version: 10 }) === null;
    const nullOk = info === null && mineAuto === null && explicitNull;
    if (!nullOk) failures.push(tc.name + "：超出支持范围时应返回 null");
    if (tc.expectNull !== true) failures.push(tc.name + "：容量预期与实际不符（参考实现版本 " + (rc.version ?? ">10") + "）");
    return {
      cells: 0, fixedCells: 0, autoCells: 0, bad: 0, maskMatrices: 0, maskBad: 0, autoBad: 0,
      autoMaskSame: false, versionOk: nullOk, maskMarks, failures,
    };
  }

  const versionOk = info !== null && info.version === rc.version;
  if (!versionOk) failures.push(tc.name + "：版本选择不一致（本实现 " + (info ? info.version : "null") + "，参考 " + rc.version + "）");

  for (let mask = 0; mask < 8; mask++) {
    const d = diff(qrMatrixEx(tc.text, { version: rc.version, mask }), rc.masks![String(mask)]);
    maskMatrices++;
    cells += d.cells;
    bad += d.bad;
    maskBad += d.bad;
    maskMarks.push(d.bad === 0 ? "✓" : "✗");
    if (d.bad !== 0) failures.push(tc.name + " mask=" + mask + "：" + d.first);
  }

  const fixedCells = cells;
  const autoDiff = diff(mineAuto, rc.auto!);
  cells += autoDiff.cells;
  autoCells = autoDiff.cells;
  // 注意：autoDiff.bad 不并入 bad —— 自动掩码不同源于双方的打分口径差异（见【4】），
  // 单独统计，并由【4】证明"自动矩阵不同的输入集合"与"两种口径 argmin 不同的集合"完全一致。
  const autoMaskSame = info !== null && info.mask === rc.autoMask;

  // 自洽性：自动结果必须等于"同版本 + 同掩码"的显式结果（说明格式信息与所选掩码匹配）
  if (info) {
    const explicit = diff(qrMatrixEx(tc.text, { version: info.version, mask: info.mask }), rc.masks![String(info.mask)]);
    if (explicit.bad !== 0) failures.push(tc.name + "：自动结果与显式指定版本/掩码不一致");
  }

  return { cells, fixedCells, autoCells, bad, maskMatrices, maskBad, autoBad: autoDiff.bad, autoMaskSame, versionOk, maskMarks, failures };
}

/* ───────────────────────── 主流程 ───────────────────────── */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qr-verify-"));
const payloadPath = path.join(tmp, "payload.json");
const refPath = path.join(tmp, "reference.json");

// 版本全覆盖载荷：每个版本装"刚好塞满"的字节数（由本实现的数据容量算出，参考实现再独立验证版本号）
const coverage: Array<{ name: string; text: string }> = [];
for (let v = 1; v <= 10; v++) {
  const probe = qrInfo("A", { version: v })!;
  const ccBits = v < 10 ? 8 : 16;
  const maxBytes = Math.floor((probe.dataCodewords * 8 - 4 - ccBits) / 8);
  coverage.push({ name: "版本 " + v + " 满载 " + maxBytes + " 字节", text: "A".repeat(maxBytes) });
}

fs.writeFileSync(
  payloadPath,
  JSON.stringify({ cases: CASES.map((c) => ({ name: c.name, text: c.text })), coverage }),
  "utf8",
);
runPython(PY_REFERENCE, [payloadPath, refPath], "reference");
const ref = JSON.parse(fs.readFileSync(refPath, "utf8")) as RefData;

console.log("");
console.log("══ 二维码编码交叉验证：src/lib/qr.ts  vs  python-qrcode ══");
console.log("");

const failures: string[] = [];
let tplDecodeGlobal = 0;
let tplDecodeTotal = 0;
let totalCells = 0;
let fixedCellsAll = 0;
let autoCellsAll = 0;
let totalBad = 0;
let maskMatricesAll = 0;
let maskBadAll = 0;
let autoMatrices = 0;
let autoMatchCount = 0;
let autoMaskSameCount = 0;
const conventionCases: string[] = [];

/* [1] 业务输入 ─────────────────────────────────────────── */
console.log("【1】业务输入逐格比对（同版本 + 同掩码，mask 0~7 各固定一次，另比自动掩码结果）");
console.log("");
console.log("  #  类别      输入                            字节  版本 我/参考  掩码 我/参考  mask0..7  自动矩阵");
console.log("  " + "─".repeat(104));

CASES.forEach((tc, i) => {
  const rc = ref.cases[i];
  const r = compareCase(tc, rc);
  const info = qrInfo(tc.text);
  failures.push(...r.failures);
  totalCells += r.cells;
  fixedCellsAll += r.fixedCells;
  autoCellsAll += r.autoCells;
  totalBad += r.bad;
  maskMatricesAll += r.maskMatrices;
  maskBadAll += r.maskBad;
  if (!outOfRange(rc)) {
    autoMatrices++;
    if (r.autoBad === 0) autoMatchCount++;
    else conventionCases.push(tc.name);
    if (r.autoMaskSame) autoMaskSameCount++;
  }
  const label = "  " + String(i + 1).padStart(2) + "  " + pad(tc.kind, 8) + "  " + pad(tc.name, 30) + "  ";
  if (outOfRange(rc)) {
    const refNote = rc.overflow ? "参考实现：" + rc.overflow.split(":")[0].trim() : "参考实现选用 v" + rc.version;
    console.log(
      label + String(rc.bytes).padStart(4) + "  超出版本 10 支持范围 → qrMatrix()=null " +
        (r.versionOk ? "✓" : "✗") + "（" + refNote + "，本实现上限 v10）",
    );
    return;
  }
  console.log(
    label +
      String(rc.bytes).padStart(4) + "  " +
      String(info!.version) + "/" + rc.version + (r.versionOk ? " ✓" : " ✗") + "        " +
      String(info!.mask) + "/" + rc.autoMask + (r.autoMaskSame ? " ✓" : " ≠") + "          " +
      r.maskMarks.join("") + "   " + (r.autoBad === 0 ? "✓" : "≠（掩码口径不同）"),
  );
});

console.log("");
console.log("  业务输入小计：固定掩码矩阵 " + maskMatricesAll + " 个 / 不一致 " + maskBadAll + " 格；自动掩码矩阵 " + autoMatchCount + "/" + autoMatrices + " 逐格一致");

/* [2] 版本全覆盖 ───────────────────────────────────────── */
console.log("");
console.log("【2】版本 1~10 全覆盖逐格比对（每版取刚好塞满的载荷）");
console.log("");
console.log("  版本  字节  矩阵   参考自动掩码  本实现掩码  8 种固定掩码逐格  自动矩阵");
console.log("  " + "─".repeat(84));
let covMatrices = 0;
let covBad = 0;
coverage.forEach((cov, i) => {
  const rc = ref.coverage[i];
  const r = compareCase({ kind: "覆盖", name: cov.name, text: cov.text }, rc);
  failures.push(...r.failures);
  totalCells += r.cells;
  fixedCellsAll += r.fixedCells;
  autoCellsAll += r.autoCells;
  totalBad += r.bad;
  maskMatricesAll += r.maskMatrices;
  maskBadAll += r.maskBad;
  covMatrices += r.maskMatrices;
  covBad += r.maskBad;
  const info = qrInfo(cov.text)!;
  autoMatrices++;
  if (r.autoBad === 0) autoMatchCount++;
  else conventionCases.push(cov.name);
  if (r.autoMaskSame) autoMaskSameCount++;
  console.log(
    "  v" + String(rc.version).padStart(2) + "    " + String(rc.bytes).padStart(4) + "  " + String(info.size).padStart(2) + "x" + String(info.size).padEnd(2) +
      "  " + String(rc.autoMask).padStart(2) + "            " + String(info.mask).padStart(2) + "          " +
      (r.maskBad === 0 ? "✓ x8" : "✗") + "                 " + (r.autoBad === 0 ? "✓" : "mask " + info.mask + " vs " + rc.autoMask),
  );
});
console.log("");
console.log("  版本覆盖小计：" + coverage.length + " 个版本，" + covMatrices + " 个固定掩码矩阵 / 不一致 " + covBad + " 格");

/* [3] 参数表 ───────────────────────────────────────────── */
console.log("");
console.log("【3】参数表比对（纠错等级 M，版本 1~10）");
console.log("");
let tableOk = 0;
for (let v = 1; v <= 10; v++) {
  const reference = ref.blocksM[String(v)];
  const info = qrInfo("A", { version: v });
  const mineBlocks = info ? info.blockDataCodewords.map((d) => [d + info.ecCodewordsPerBlock, d]) : [];
  const blocksOk =
    mineBlocks.length === reference.length && mineBlocks.every((b, k) => b[0] === reference[k][0] && b[1] === reference[k][1]);
  const capacityOk = info !== null && info.dataCodewords * 8 === ref.bitLimitM[String(v)];
  const remain = info ? info.dataModules - info.totalCodewords * 8 : -1;
  const modulesOk = info !== null && remain >= 0 && remain < 8 && remain === info.dataModules % 8;
  const versionOk = info !== null && info.version === v && info.size === 4 * v + 17;
  const ok = blocksOk && capacityOk && modulesOk && versionOk;
  if (ok) tableOk++;
  console.log(
    "  v" + String(v).padStart(2) + "  " + String(info ? info.blockDataCodewords.length : 0) + " 块（数据 " + String(info ? info.blockDataCodewords[0] : 0) +
      " + 纠错 " + String(info ? info.ecCodewordsPerBlock : 0) + "）/块  容量 " + String(info ? info.dataCodewords : 0) + " 码字 = " +
      String(info ? info.dataCodewords * 8 : 0) + " bit  数据模块 " + String(info ? info.dataModules : 0) + "（剩余 " + remain + " bit）  " + (ok ? "✓" : "✗"),
  );
  if (!ok) failures.push("v" + v + " 分块/容量/数据模块自检失败");
}
console.log("");
console.log("  参数表：" + tableOk + "/10 版本与参考实现 rs_blocks / BIT_LIMIT_TABLE 完全一致");

/* [4] 掩码罚分规则交叉验证 ─────────────────────────────── */
console.log("");
console.log("【4】掩码罚分规则交叉验证（逐值比对双方四条规则的得分）");
console.log("");
let lpFinalChecked = 0;
let lpFinalBad = 0;
let lpTestChecked = 0;
let lpTestBad = 0;
let refArgminSame = 0;
let isoArgminSame = 0;
let argminChecked = 0;
let autoExplainChecked = 0;
let autoExplainBad = 0;
const conventionDiff: string[] = [];

const scoringCases = [
  ...CASES.filter((c) => !c.expectNull).map((c, i) => ({ name: c.name, text: c.text, rc: ref.cases[idxOfCase(c.name)] })),
  ...coverage.map((c, i) => ({ name: c.name, text: c.text, rc: ref.coverage[i] })),
];

function idxOfCase(name: string): number {
  return CASES.findIndex((c) => c.name === name);
}

for (const sc of scoringCases) {
  const rc = sc.rc;
  if (!rc.version || !rc.lostPoints || !rc.lostPointsFinal) continue;
  const finalLost: number[] = [];
  const testLost: number[] = [];
  for (let mask = 0; mask < 8; mask++) {
    const mat = qrMatrixEx(sc.text, { version: rc.version, mask });
    if (!mat) {
      failures.push(sc.name + " 罚分核对：矩阵为 null");
      continue;
    }
    finalLost.push(lostPoint(mat));
    testLost.push(lostPoint(refStyleGrid(mat, rc.version)));
  }
  rc.lostPointsFinal.forEach((want, m) => {
    lpFinalChecked++;
    if (finalLost[m] !== want) {
      lpFinalBad++;
      failures.push(sc.name + " mask=" + m + " 最终矩阵罚分：本实现 " + finalLost[m] + " vs 参考 " + want);
    }
  });
  rc.lostPoints.forEach((want, m) => {
    lpTestChecked++;
    if (testLost[m] !== want) {
      lpTestBad++;
      failures.push(sc.name + " mask=" + m + " 打分矩阵罚分：本实现 " + testLost[m] + " vs 参考 " + want);
    }
  });
  argminChecked++;
  const refArg = testLost.indexOf(Math.min(...testLost));
  const isoArg = finalLost.indexOf(Math.min(...finalLost));
  if (refArg === rc.autoMask) refArgminSame++;
  else failures.push(sc.name + "：参考口径 argmin " + refArg + " != 参考自动掩码 " + rc.autoMask);
  const mineMask = qrInfo(sc.text)!.mask;
  if (isoArg === mineMask) isoArgminSame++;
  else failures.push(sc.name + "：本实现口径 argmin " + isoArg + " != 本实现自动掩码 " + mineMask);
  const autoDiffers = diff(qrMatrix(sc.text), rc.auto!).bad !== 0;
  autoExplainChecked++;
  if (autoDiffers !== (refArg !== isoArg)) {
    autoExplainBad++;
    failures.push(sc.name + "：自动掩码矩阵差异无法用打分口径解释（autoDiffers=" + autoDiffers + "，口径不同=" + (refArg !== isoArg) + "）");
  }
  if (refArg !== isoArg) conventionDiff.push(sc.name + "（参考口径→" + refArg + "，含格式信息口径→" + isoArg + "）");
}

console.log("  · 参考实现打分矩阵（格式信息/暗模块/版本信息视为浅色）罚分逐值核对：" + (lpTestChecked - lpTestBad) + "/" + lpTestChecked + " 相同");
console.log("  · 参考实现最终矩阵（含格式信息）罚分逐值核对：" + (lpFinalChecked - lpFinalBad) + "/" + lpFinalChecked + " 相同");
console.log("  · 按参考口径取 argmin == 参考实现的自动掩码：" + refArgminSame + "/" + argminChecked);
console.log("  · 按本实现口径（ISO：格式信息计入罚分）取 argmin == 本实现的自动掩码：" + isoArgminSame + "/" + argminChecked);
console.log("  · 自动矩阵差异与口径差异一一对应：" + (autoExplainChecked - autoExplainBad) + "/" + autoExplainChecked + "（自动掩码不同 ⇔ 两种口径 argmin 不同）");
console.log("  · 两种口径选出不同掩码的输入 " + conventionDiff.length + " 组：" + (conventionDiff.join("；") || "无"));

/* [5] 渲染回读 ─────────────────────────────────────────── */
console.log("");
console.log("【5】渲染回读（typst 画矩阵 → PNG → OpenCV 解码）");
console.log("");
fs.mkdirSync(OUT_DIR, { recursive: true });
const images: Array<{ name: string; text: string; png: string }> = [];
let renderFail = 0;
CASES.forEach((tc, i) => {
  const mat = qrMatrix(tc.text);
  if (!mat) return;
  const n = mat.length;
  const unit = 3;
  const page = (n + 8) * unit;
  const body = mat.map((row) => "(" + row.map((v) => (v ? "true" : "false")).join(",") + ")").join(",");
  const typ = [
    "#set page(width: " + page + "pt, height: " + page + "pt, margin: 0pt, fill: white)",
    "#let mat = (" + body + ")",
    "#let u = " + unit + "pt",
    "#box(width: " + page + "pt, height: " + page + "pt, {",
    "  for (y, row) in mat.enumerate() {",
    "    for (x, on) in row.enumerate() {",
    "      if on { place(dx: (x + 4) * u, dy: (y + 4) * u, rect(width: u, height: u, fill: black)) }",
    "    }",
    "  }",
    "})",
    "",
  ].join("\n");
  const slug = "case-" + String(i + 1).padStart(2, "0") + "-v" + (n - 17) / 4;
  const typPath = path.join(OUT_DIR, slug + ".typ");
  const pngPath = path.join(OUT_DIR, slug + ".png");
  fs.writeFileSync(typPath, typ, "utf8");
  const res = spawnSync(TYPST, ["compile", typPath, pngPath, "--ppi", "300"], { stdio: ["ignore", "ignore", "pipe"] });
  if (res.status === 0 && fs.existsSync(pngPath)) {
    images.push({ name: tc.name, text: tc.text, png: pngPath });
  } else {
    renderFail++;
    const msg = res.stderr ? res.stderr.toString().slice(0, 200) : res.error ? res.error.message : "退出码 " + res.status;
    console.log("  ✗ " + tc.name + " 渲染失败：" + msg);
    failures.push(tc.name + " 渲染失败");
  }
});
console.log("  typst 渲染：" + images.length + " 张成功" + (renderFail ? "，" + renderFail + " 张失败" : "") + " → out/qr-verify/*.png");

let decodeOk = 0;
if (images.length) {
  const decPayload = path.join(tmp, "decode-in.json");
  const decOut = path.join(tmp, "decode-out.json");
  fs.writeFileSync(decPayload, JSON.stringify({ images: images.map((im) => ({ name: im.name, png: im.png })) }), "utf8");
  runPython(PY_DECODE, [decPayload, decOut], "decode");
  const decoded = JSON.parse(fs.readFileSync(decOut, "utf8")) as Array<{ name: string; ok: boolean; decoded: string | null; how: string }>;
  console.log("");
  decoded.forEach((d, i) => {
    const expect = images[i].text;
    let verdict: string;
    if (d.ok && d.decoded === expect) {
      verdict = "✓ 解码回读与原文完全一致（" + d.how + "）";
      decodeOk++;
    } else if (d.ok && d.decoded !== null && Buffer.from(d.decoded, "latin1").equals(Buffer.from(expect, "utf8"))) {
      verdict = "✓ 解码字节一致（OpenCV 按 latin-1 解释文本，" + d.how + "）";
      decodeOk++;
    } else {
      verdict = "✗ 回读不一致：" + (d.decoded === null ? "null" : d.decoded.slice(0, 40)) + "（" + d.how + "）";
      failures.push(d.name + " 解码回读失败");
    }
    console.log("  " + pad(images[i].name, 26) + path.basename(images[i].png).padEnd(18) + " " + verdict);
  });
  console.log("");
  console.log("  解码回读：" + decodeOk + "/" + decoded.length + " 张成功");
}

/* [6] 模板渲染件里的二维码 ─────────────────────────────── */
console.log("");
console.log("【6】端到端：模板渲染出的 PNG 里的二维码能否被独立解码器扫出原文");
console.log("");
const tplDecode: Array<{ name: string; expect: string | null; decoded: string | null; ok: boolean; how: string }> = [];
const tplJobs: Array<{ name: string; png: string; crop: string }> = [];
const tplSkipped: string[] = [];
for (const id of ["zz", "cq", "zy", "bj3", "bj6"]) {
  const png = path.resolve("out", "tpl-" + id + ".png");
  const src = path.resolve("src", "templates", id + ".ts");
  if (!fs.existsSync(png)) continue;
  const code = fs.existsSync(src) ? fs.readFileSync(src, "utf8") : "";
  if (!/qrBlock\s*\(/.test(code)) {
    tplSkipped.push("tpl-" + id);
    continue; // 模板源码还没接 qrBlock，渲染件里本来就没有二维码
  }
  tplJobs.push({ name: "tpl-" + id, png, crop: path.join(OUT_DIR, "tpl-" + id + "-qr.png") });
}
if (tplJobs.length) {
  const srcOf = (id: string) => path.resolve("src", "templates", id.replace(/^tpl-/, "") + ".ts");
  const dPayload = path.join(tmp, "tpl-decode-in.json");
  const dOut = path.join(tmp, "tpl-decode-out.json");
  fs.writeFileSync(dPayload, JSON.stringify({ images: tplJobs }), "utf8");
  runPython(PY_DECODE, [dPayload, dOut], "tpl-decode");
  const tplRes = JSON.parse(fs.readFileSync(dOut, "utf8")) as Array<{ name: string; ok: boolean; decoded: string | null; how: string }>;
  tplRes.forEach((d, i) => {
    const file = srcOf(tplJobs[i].name);
    let expect: string | null = null;
    if (fs.existsSync(file)) {
      const m = fs.readFileSync(file, "utf8").match(/qrText:\s*"([^"]*)"/);
      if (m) expect = m[1];
    }
    const match = d.ok && expect !== null && d.decoded === expect;
    tplDecode.push({ name: tplJobs[i].name, expect, decoded: d.decoded, ok: d.ok, how: d.how });
    console.log(
      "  " + tplJobs[i].name.padEnd(9) + path.basename(tplJobs[i].png) + "  " +
        (match ? "✓ 扫出模板默认内容：" : d.ok ? "△ 扫出内容与源码默认值不同：" : "✗ 未扫出：") + (d.decoded ?? "") +
        (d.ok && expect !== null && !match ? "（源码默认 " + expect + "）" : ""),
    );
    if (!d.ok) failures.push(tplJobs[i].name + " 渲染件里的二维码无法被解码");
  });
  console.log("");
  console.log("  渲染件二维码解码：" + tplDecode.filter((t) => t.ok).length + "/" + tplDecode.length + " 张成功；裁剪图见 out/qr-verify/tpl-*-qr.png");
} else {
  console.log("  out/tpl-*.png 里没有可解的二维码（需先运行 render-all）");
}
console.log("  模板接线情况：" + (tplSkipped.length
  ? tplSkipped.join("、") + " 的模板源码尚未调用 qrBlock()，渲染件中不含二维码 → 跳过（模板侧待接线，与编码器无关）"
  : "所有模板均已调用 qrBlock()"));
tplDecodeGlobal = tplDecode.filter((t) => t.ok).length;
tplDecodeTotal = tplDecode.length;

/* [7] qrBlock 集成链路 ─────────────────────────────────── */
console.log("");
console.log("【7】qrBlock() 集成渲染验证（走 kit.ts 的真实调用链，144dpi 与模板渲染一致）");
console.log("");
const integText = "https://pay.zzszxyy.com/rx/20260507009159";
let integOk = false;
{
  const integTyp = [
    "#set page(width: 130pt, height: 130pt, margin: 0pt, fill: white)",
    "#set align(center + horizon)",
    QR_HELPER,
    qrBlock(integText, 60),
    "",
  ].join("\n");
  const integTypPath = path.join(OUT_DIR, "kit-qrblock-144dpi.typ");
  const integPng = path.join(OUT_DIR, "kit-qrblock-144dpi.png");
  fs.writeFileSync(integTypPath, integTyp, "utf8");
  const integRes = spawnSync(TYPST, ["compile", integTypPath, integPng, "--ppi", "144"], { stdio: ["ignore", "ignore", "pipe"] });
  if (integRes.status !== 0 || !fs.existsSync(integPng)) {
    console.log("  ✗ kit.qrBlock 渲染失败：" + (integRes.stderr ? integRes.stderr.toString().slice(0, 200) : "退出码 " + integRes.status));
    failures.push("kit.qrBlock 集成渲染失败");
  } else {
    const i2 = path.join(tmp, "integ-in.json");
    const o2 = path.join(tmp, "integ-out.json");
    fs.writeFileSync(i2, JSON.stringify({ images: [{ name: "kit-qrblock", png: integPng, crop: path.join(OUT_DIR, "kit-qrblock-144dpi-crop.png") }] }), "utf8");
    runPython(PY_DECODE, [i2, o2], "integ");
    const rr = JSON.parse(fs.readFileSync(o2, "utf8")) as Array<{ name: string; ok: boolean; decoded: string | null; how: string }>;
    integOk = rr[0].ok && rr[0].decoded === integText;
    console.log("  " + qrBlock(integText, 60).slice(0, 3) + "...（" + qrInfo(integText)!.size + "x" + qrInfo(integText)!.size + " 矩阵）→ typst 144dpi PNG → OpenCV 解码");
    console.log("  " + (integOk ? "✓ 解码内容与入参完全一致：" : "✗ 解码失败：") + (rr[0].decoded ?? "null") + "（" + rr[0].how + "）");
    if (!integOk) failures.push("kit.qrBlock 集成渲染的二维码解码不一致");
  }
}

/* 汇总 ─────────────────────────────────────────────────── */
console.log("");
console.log("══ 结论 ══");
console.log("  ① 固定掩码逐格比对：" + maskMatricesAll + " 个矩阵（业务输入 " + FITTING_CASES.length + " 组 + 版本 1~10 全覆盖 x8 掩码），共 " + fixedCellsAll + " 个模块，不一致 " + totalBad + " 处");
console.log("  ② 自动掩码逐格比对：" + autoMatrices + " 个矩阵，共 " + autoCellsAll + " 个模块；与参考完全相同 " + autoMatchCount + " 个，" +
  (autoMatrices - autoMatchCount) + " 个因打分口径不同选了另一个合法掩码（【4】已验证可完全解释）");
console.log("  ③ 参数表：" + tableOk + "/10 版本与参考一致；罚分值逐值核对：" + (lpTestChecked - lpTestBad + lpFinalChecked - lpFinalBad) + "/" + (lpTestChecked + lpFinalChecked) + " 相同");
console.log("  ④ 渲染回读（typst → PNG → OpenCV）：" + decodeOk + "/" + images.length + " 张解出原文，与输入完全一致");
console.log("  ⑤ 模板渲染件（out/tpl-*.png）：" + (tplDecodeTotal ? tplDecodeGlobal + "/" + tplDecodeTotal + " 张能扫出内容" : "当前无模板调用 qrBlock（模板侧待接线），无可解码对象") +
  "；kit.qrBlock() 集成链路（144dpi）：" + (integOk ? "✓ 渲染出的二维码可解出原文" : "✗"));
console.log("");
console.log("  口径说明：本实现按 ISO/IEC 18004 把格式信息计入掩码罚分（与 ZXing 同口径）；python-qrcode 打分时把格式信息视为浅色。");
console.log("            这只影响自动挑哪一个合法掩码（格式信息始终与实际所用掩码匹配），任何一种掩码下的矩阵本身 100% 一致。");
console.log("");
if (totalBad === 0 && failures.length === 0) {
  console.log("PASS：编码实现与 python-qrcode 在 " + maskMatricesAll + " 个固定掩码矩阵上逐格 100% 一致（" + fixedCellsAll + " 个模块 0 处不同）；" +
    "版本选择、RS 分块、数据容量、罚分函数全部对齐；渲染出的二维码 " + decodeOk + "/" + images.length + " 可被独立解码器扫回原文。");
} else {
  console.log("FAIL：" + failures.length + " 项问题");
  for (const f of failures.slice(0, 20)) console.log("  - " + f);
}
console.log("");
console.log("样例矩阵（手机号 13800138000）：");
console.log(asciiQr(qrMatrix("13800138000")!));

process.exit(totalBad === 0 && failures.length === 0 ? 0 : 1);
