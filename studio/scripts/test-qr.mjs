import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
//#region src/lib/qr.ts
/** 索引即版本号（索引 0 占位不用）。数据来自 ISO/IEC 18004 表 9（纠错等级 M）。 */
const RS_PLANS_M = [
	{
		ec: 0,
		groups: []
	},
	{
		ec: 10,
		groups: [[1, 16]]
	},
	{
		ec: 16,
		groups: [[1, 28]]
	},
	{
		ec: 26,
		groups: [[1, 44]]
	},
	{
		ec: 18,
		groups: [[2, 32]]
	},
	{
		ec: 24,
		groups: [[2, 43]]
	},
	{
		ec: 16,
		groups: [[4, 27]]
	},
	{
		ec: 18,
		groups: [[4, 31]]
	},
	{
		ec: 22,
		groups: [[2, 38], [2, 39]]
	},
	{
		ec: 22,
		groups: [[3, 36], [2, 37]]
	},
	{
		ec: 26,
		groups: [[4, 43], [1, 44]]
	}
];
/** 校正图形中心坐标（索引即版本号，索引 0 占位不用） */
const ALIGN_CENTERS = [
	[],
	[],
	[6, 18],
	[6, 22],
	[6, 26],
	[6, 30],
	[6, 34],
	[
		6,
		22,
		38
	],
	[
		6,
		24,
		42
	],
	[
		6,
		26,
		46
	],
	[
		6,
		28,
		50
	]
];
/** Byte 模式指示符 0100 */
const MODE_BYTE = 4;
const VERSION_MIN = 1;
const VERSION_MAX = 10;
const GF_EXP = /* @__PURE__ */ new Uint8Array(512);
const GF_LOG = /* @__PURE__ */ new Uint8Array(256);
{
	let x = 1;
	for (let i = 0; i < 255; i++) {
		GF_EXP[i] = x;
		GF_LOG[x] = i;
		x <<= 1;
		if (x & 256) x ^= 285;
	}
	for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}
function gfMul(a, b) {
	if (a === 0 || b === 0) return 0;
	return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}
const GEN_POLY_CACHE = /* @__PURE__ */ new Map();
/** 生成多项式 (x-α^0)(x-α^1)…(x-α^(ecLen-1))，系数按次数从高到低 */
function rsGeneratorPoly(ecLen) {
	const cached = GEN_POLY_CACHE.get(ecLen);
	if (cached) return cached;
	let poly = new Uint8Array([1]);
	for (let i = 0; i < ecLen; i++) {
		const next = new Uint8Array(poly.length + 1);
		for (let j = 0; j < poly.length; j++) {
			next[j] ^= poly[j];
			next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
		}
		poly = next;
	}
	GEN_POLY_CACHE.set(ecLen, poly);
	return poly;
}
/** Reed-Solomon 纠错码字（GF(256) 上的多项式取余） */
function rsEncode(data, ecLen) {
	const gen = rsGeneratorPoly(ecLen);
	const rem = new Uint8Array(ecLen);
	for (let i = 0; i < data.length; i++) {
		const factor = data[i] ^ rem[0];
		rem.copyWithin(0, 1);
		rem[ecLen - 1] = 0;
		if (factor !== 0) for (let j = 0; j < ecLen; j++) rem[j] ^= gfMul(gen[j + 1], factor);
	}
	return rem;
}
function bitLength(value) {
	let n = 0;
	while (value !== 0) {
		value >>>= 1;
		n++;
	}
	return n;
}
const G15 = 1335;
const G15_MASK = 21522;
const G18 = 7973;
/** 15 bit 格式信息：5 bit 数据 + 10 bit BCH 校验，最后异或 0x5412 */
function bchFormatInfo(data5) {
	let d = data5 << 10;
	while (bitLength(d) - bitLength(G15) >= 0) d ^= G15 << bitLength(d) - bitLength(G15);
	return (data5 << 10 | d) ^ G15_MASK;
}
/** 18 bit 版本信息：6 bit 版本号 + 12 bit BCH 校验（版本 ≥ 7 才有） */
function bchVersionInfo(version) {
	let d = version << 12;
	while (bitLength(d) - bitLength(G18) >= 0) d ^= G18 << bitLength(d) - bitLength(G18);
	return version << 12 | d;
}
/** 8 种掩码条件（row = 行，col = 列），依据 ISO/IEC 18004 表 10 */
function maskAt(mask, row, col) {
	switch (mask) {
		case 0: return (row + col) % 2 === 0;
		case 1: return row % 2 === 0;
		case 2: return col % 3 === 0;
		case 3: return (row + col) % 3 === 0;
		case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
		case 5: return row * col % 2 + row * col % 3 === 0;
		case 6: return (row * col % 2 + row * col % 3) % 2 === 0;
		case 7: return (row * col % 3 + (row + col) % 2) % 2 === 0;
		default: return false;
	}
}
function createSkeleton(version) {
	const n = version * 4 + 17;
	const modules = new Uint8Array(n * n);
	const reserved = new Uint8Array(n * n);
	const put = (row, col, dark) => {
		modules[row * n + col] = dark ? 1 : 0;
		reserved[row * n + col] = 1;
	};
	const finder = (row, col) => {
		for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
			const y = row + r;
			const x = col + c;
			if (y < 0 || y >= n || x < 0 || x >= n) continue;
			put(y, x, r >= 0 && r <= 6 && (c === 0 || c === 6) || c >= 0 && c <= 6 && (r === 0 || r === 6) || r >= 2 && r <= 4 && c >= 2 && c <= 4);
		}
	};
	finder(0, 0);
	finder(n - 7, 0);
	finder(0, n - 7);
	const centers = ALIGN_CENTERS[version];
	for (const row of centers) for (const col of centers) {
		if (reserved[row * n + col]) continue;
		for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
			const dark = r === -2 || r === 2 || c === -2 || c === 2 || r === 0 && c === 0;
			put(row + r, col + c, dark);
		}
	}
	for (let i = 8; i <= n - 9; i++) {
		if (!reserved[6 * n + i]) put(6, i, i % 2 === 0);
		if (!reserved[i * n + 6]) put(i, 6, i % 2 === 0);
	}
	for (let i = 0; i <= 8; i++) {
		if (!reserved[i * n + 8]) put(i, 8, false);
		if (!reserved[8 * n + i]) put(8, i, false);
	}
	for (let i = n - 8; i < n; i++) {
		if (!reserved[i * n + 8]) put(i, 8, false);
		if (!reserved[8 * n + i]) put(8, i, false);
	}
	if (version >= 7) for (let r = 0; r < 6; r++) for (let c = n - 11; c <= n - 9; c++) {
		put(r, c, false);
		put(c, r, false);
	}
	put(n - 8, 8, true);
	return {
		size: n,
		modules,
		reserved
	};
}
/** 把格式信息写入矩阵（不参与掩码） */
function placeFormatInfo(m, n, mask) {
	const bits = bchFormatInfo(0 | mask);
	for (let i = 0; i < 15; i++) {
		const dark = (bits >> i & 1) === 1;
		if (i < 6) m[i * n + 8] = dark ? 1 : 0;
		else if (i < 8) m[(i + 1) * n + 8] = dark ? 1 : 0;
		else m[(n - 15 + i) * n + 8] = dark ? 1 : 0;
		if (i < 8) m[8 * n + (n - i - 1)] = dark ? 1 : 0;
		else if (i < 9) m[8 * n + (15 - i)] = dark ? 1 : 0;
		else m[8 * n + (14 - i)] = dark ? 1 : 0;
	}
	m[(n - 8) * n + 8] = 1;
}
/** 把版本信息写入矩阵（版本 ≥ 7，不参与掩码） */
function placeVersionInfo(m, n, version) {
	const bits = bchVersionInfo(version);
	for (let i = 0; i < 18; i++) {
		const dark = (bits >> i & 1) === 1 ? 1 : 0;
		const r = Math.floor(i / 3);
		const c = n - 11 + i % 3;
		m[r * n + c] = dark;
		m[c * n + r] = dark;
	}
}
/** 按标准之字形顺序填充数据并就地施加掩码 */
function placeData(skeleton, codewords, mask) {
	const { size: n, modules: m, reserved: fn } = skeleton;
	let row = n - 1;
	let inc = -1;
	let bitIndex = 7;
	let byteIndex = 0;
	for (let col = n - 1; col > 0; col -= 2) {
		const right = col <= 6 ? col - 1 : col;
		const pair = [right, right - 1];
		for (;;) {
			for (const c of pair) {
				const idx = row * n + c;
				if (fn[idx]) continue;
				let dark = 0;
				if (byteIndex < codewords.length) dark = codewords[byteIndex] >> bitIndex & 1;
				if (maskAt(mask, row, c)) dark ^= 1;
				m[idx] = dark;
				fn[idx] = 1;
				bitIndex--;
				if (bitIndex < 0) {
					byteIndex++;
					bitIndex = 7;
				}
			}
			row += inc;
			if (row < 0 || row >= n) {
				row -= inc;
				inc = -inc;
				break;
			}
		}
	}
}
/** 用指定掩码生成完整矩阵（不含静默区） */
function buildMatrix(version, codewords, mask) {
	const skeleton = createSkeleton(version);
	placeData(skeleton, codewords, mask);
	placeFormatInfo(skeleton.modules, skeleton.size, mask);
	if (version >= 7) placeVersionInfo(skeleton.modules, skeleton.size, version);
	return skeleton.modules;
}
/**
* 四条罚分规则（与参考实现 python-qrcode 的 util.lost_point 一致）：
*   1. 行/列上连续同色 ≥5：每个连续段罚 (长度 - 2)；
*   2. 2×2 同色块：每块罚 3；
*   3. 出现 1:1:3:1:1 定位图形相似形态（10111010000 / 00001011101）：每次罚 40；
*   4. 黑色模块比例偏离 50%：每偏离 5% 罚 10。
*/
function maskPenalty(m, n) {
	let penalty = 0;
	for (let i = 0; i < n; i++) {
		let runRow = 1;
		let runCol = 1;
		for (let j = 1; j < n; j++) {
			if (m[i * n + j] === m[i * n + j - 1]) runRow++;
			else {
				if (runRow >= 5) penalty += runRow - 2;
				runRow = 1;
			}
			if (m[j * n + i] === m[(j - 1) * n + i]) runCol++;
			else {
				if (runCol >= 5) penalty += runCol - 2;
				runCol = 1;
			}
		}
		if (runRow >= 5) penalty += runRow - 2;
		if (runCol >= 5) penalty += runCol - 2;
	}
	for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
		const v = m[r * n + c];
		if (v === m[r * n + c + 1] && v === m[(r + 1) * n + c] && v === m[(r + 1) * n + c + 1]) penalty += 3;
	}
	const PAT_A = [
		1,
		0,
		1,
		1,
		1,
		0,
		1,
		0,
		0,
		0,
		0
	];
	const PAT_B = [
		0,
		0,
		0,
		0,
		1,
		0,
		1,
		1,
		1,
		0,
		1
	];
	const matches = (get, start) => {
		let okA = true;
		let okB = true;
		for (let k = 0; k < 11; k++) {
			const v = get(start + k);
			if (v !== PAT_A[k]) okA = false;
			if (v !== PAT_B[k]) okB = false;
			if (!okA && !okB) return false;
		}
		return true;
	};
	for (let r = 0; r < n; r++) for (let c = 0; c + 10 < n; c++) if (matches((k) => m[r * n + k], c)) penalty += 40;
	for (let c = 0; c < n; c++) for (let r = 0; r + 10 < n; r++) if (matches((k) => m[k * n + c], r)) penalty += 40;
	let dark = 0;
	for (let i = 0; i < m.length; i++) dark += m[i];
	const percent = dark / (n * n);
	penalty += Math.trunc(Math.abs(percent * 100 - 50) / 5) * 10;
	return penalty;
}
/** 在 8 种掩码中选罚分最低者（同分取编号更小者） */
function chooseMask(version, codewords) {
	let best = 0;
	let bestPenalty = Number.POSITIVE_INFINITY;
	for (let mask = 0; mask < 8; mask++) {
		const p = maskPenalty(buildMatrix(version, codewords, mask), version * 4 + 17);
		if (p < bestPenalty) {
			bestPenalty = p;
			best = mask;
		}
	}
	return best;
}
function totalDataCodewords(plan) {
	let sum = 0;
	for (const [count, dataPerBlock] of plan.groups) sum += count * dataPerBlock;
	return sum;
}
/** Byte 模式位数：模式指示符 + 字符计数（版本 1~9 用 8 bit，10~26 用 16 bit） */
function requiredBits(byteLength, version) {
	return 4 + (version < 10 ? 8 : 16) + byteLength * 8;
}
/** 选能装下内容的最小版本；超出版本 10 返回 null */
function pickVersion(byteLength) {
	for (let v = VERSION_MIN; v <= VERSION_MAX; v++) if (requiredBits(byteLength, v) <= totalDataCodewords(RS_PLANS_M[v]) * 8) return v;
	return null;
}
function utf8Bytes(text) {
	if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
	const out = [];
	for (const ch of text) {
		const cp = ch.codePointAt(0);
		if (cp < 128) out.push(cp);
		else if (cp < 2048) out.push(192 | cp >> 6, 128 | cp & 63);
		else if (cp < 65536) out.push(224 | cp >> 12, 128 | cp >> 6 & 63, 128 | cp & 63);
		else out.push(240 | cp >> 18, 128 | cp >> 12 & 63, 128 | cp >> 6 & 63, 128 | cp & 63);
	}
	return Uint8Array.from(out);
}
/** 数据段 + 填充 + 纠错 + 交织，得到最终的码字序列 */
function buildCodewords(bytes, version) {
	const plan = RS_PLANS_M[version];
	const dataCodewords = totalDataCodewords(plan);
	const bits = [];
	const put = (value, length) => {
		for (let i = length - 1; i >= 0; i--) bits.push(value >> i & 1);
	};
	put(MODE_BYTE, 4);
	put(bytes.length, version < 10 ? 8 : 16);
	for (let i = 0; i < bytes.length; i++) put(bytes[i], 8);
	for (let i = 0; i < Math.min(4, dataCodewords * 8 - bits.length); i++) bits.push(0);
	while (bits.length % 8 !== 0) bits.push(0);
	const data = new Uint8Array(dataCodewords);
	for (let i = 0; i < bits.length; i += 8) {
		let v = 0;
		for (let j = 0; j < 8; j++) v = v << 1 | bits[i + j];
		data[i / 8] = v;
	}
	for (let i = bits.length / 8, k = 0; i < dataCodewords; i++, k++) data[i] = k % 2 === 0 ? 236 : 17;
	const blocks = [];
	let offset = 0;
	for (const [count, dataPerBlock] of plan.groups) for (let b = 0; b < count; b++) {
		const chunk = data.subarray(offset, offset + dataPerBlock);
		offset += dataPerBlock;
		blocks.push({
			data: chunk,
			ec: rsEncode(chunk, plan.ec)
		});
	}
	const maxData = Math.max(...blocks.map((b) => b.data.length));
	const out = new Uint8Array(blocks.reduce((s, b) => s + b.data.length + b.ec.length, 0));
	let p = 0;
	for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) out[p++] = b.data[i];
	for (let i = 0; i < plan.ec; i++) for (const b of blocks) out[p++] = b.ec[i];
	return out;
}
function encode(text, options) {
	if (typeof text !== "string") return null;
	const bytes = utf8Bytes(text);
	let version;
	if (options && options.version !== void 0) {
		version = options.version;
		if (!Number.isInteger(version) || version < VERSION_MIN || version > VERSION_MAX) return null;
		if (requiredBits(bytes.length, version) > totalDataCodewords(RS_PLANS_M[version]) * 8) return null;
	} else {
		const picked = pickVersion(bytes.length);
		if (picked === null) return null;
		version = picked;
	}
	let mask;
	if (options && options.mask !== void 0) {
		mask = options.mask;
		if (!Number.isInteger(mask) || mask < 0 || mask > 7) return null;
	} else mask = 0;
	const codewords = buildCodewords(bytes, version);
	if (options?.mask === void 0) mask = chooseMask(version, codewords);
	return {
		version,
		mask,
		bytes,
		codewords
	};
}
function toRows(flat, size) {
	const rows = [];
	for (let r = 0; r < size; r++) {
		const row = new Array(size);
		for (let c = 0; c < size; c++) row[c] = flat[r * size + c] === 1;
		rows.push(row);
	}
	return rows;
}
/**
* 生成二维码矩阵：N×N 布尔矩阵，true = 黑块；失败返回 null。
* 默认：Byte（UTF-8）模式、纠错等级 M、版本 1~10 自动、8 种掩码自动择优。
*/
function qrMatrix(text) {
	return qrMatrixEx(text);
}
/** 同 qrMatrix，但可指定版本 / 掩码（用于交叉验证与排查） */
function qrMatrixEx(text, options) {
	try {
		const enc = encode(text, options);
		if (!enc) return null;
		return toRows(buildMatrix(enc.version, enc.codewords, enc.mask), enc.version * 4 + 17);
	} catch {
		return null;
	}
}
/** 返回版本 / 掩码 / 码字分块等元信息；编码不出来返回 null */
function qrInfo(text, options) {
	try {
		const enc = encode(text, options);
		if (!enc) return null;
		const plan = RS_PLANS_M[enc.version];
		const size = enc.version * 4 + 17;
		const skeleton = createSkeleton(enc.version);
		let dataModules = 0;
		for (let i = 0; i < skeleton.reserved.length; i++) if (!skeleton.reserved[i]) dataModules++;
		const blockDataCodewords = [];
		for (const [count, dataPerBlock] of plan.groups) for (let b = 0; b < count; b++) blockDataCodewords.push(dataPerBlock);
		return {
			version: enc.version,
			size,
			mask: enc.mask,
			byteLength: enc.bytes.length,
			dataCodewords: totalDataCodewords(plan),
			ecCodewordsPerBlock: plan.ec,
			blockDataCodewords,
			totalCodewords: enc.codewords.length,
			dataModules
		};
	} catch {
		return null;
	}
}
//#endregion
//#region src/templates/kit.ts
/** 二维码 helper：把 bool 矩阵画成方块阵（qr.ts 生成矩阵） */
const QR_HELPER = `#let qrcode(mat, side) = {
  let n = mat.len()
  let u = side / n
  box(width: side, height: side, {
    for (y, row) in mat.enumerate() {
      for (x, on) in row.enumerate() {
        if on { place(dx: x * u, dy: y * u, rect(width: u, height: u, fill: black)) }
      }
    }
  })
}`;
/**
* 二维码块：优先用 qr.ts 的真实矩阵；若编码不可用，退化为带说明的空框
* （绝不画"看起来像二维码"的假图案）。
*/
function qrBlock(text, sidePt) {
	let mat = null;
	try {
		mat = qrMatrix(text);
	} catch {
		mat = null;
	}
	if (!mat) return `#box(width: ${sidePt}pt, height: ${sidePt}pt, stroke: 0.4pt)[#align(center + horizon)[#text(size: 6pt)[扫码支付]]]`;
	return `#qrcode((${mat.map((row) => "(" + row.map((v) => v ? "true" : "false").join(", ") + ")").join(", ")}), ${sidePt}pt)`;
}
//#endregion
//#region scripts/test-qr.ts
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
const PYTHON = process.env.PYTHON ?? "python";
const TYPST = path.resolve("resources", process.platform === "win32" ? "typst.exe" : "typst");
const OUT_DIR = path.resolve("out", "qr-verify");
const LONG_CN = "黄连9g 黄芩12g 黄柏9g 栀子10g 金银花15g 连翘12g 板蓝根15g 水煎服，每日一剂，分两次温服。忌辛辣油腻，服药期间多饮温水。";
const OVERFLOW_CN = LONG_CN + "另加：本方适用于风热感冒初起，症见发热、咽痛、咳嗽、口渴等，请遵医嘱服用。";
const CASES = [
	{
		kind: "纯数字",
		name: "手机号",
		text: "13800138000"
	},
	{
		kind: "纯ASCII",
		name: "短英文",
		text: "HELLO WORLD 123"
	},
	{
		kind: "URL",
		name: "郑州中心医院缴费链接",
		text: "https://pay.zzszxyy.com/rx/20260507009159"
	},
	{
		kind: "中文",
		name: "中文处方说明",
		text: "处方笺：郑州市中心医院 药费 260.90 元 扫码支付"
	},
	{
		kind: "中英混排",
		name: "中英混排处方",
		text: "Patient 张伟 / 诊断 2型糖尿病 / 药品 二甲双胍缓释片 0.5g×30 / 用法 口服 每日一次"
	},
	{
		kind: "emoji",
		name: "含 emoji 与全角符号",
		text: "支付成功 ✅ ￥134.65 → 重庆中医院"
	},
	{
		kind: "长中文",
		name: "长中文（触发高版本）",
		text: LONG_CN
	},
	{
		kind: "边界",
		name: "版本 10 容量边界 213 字节",
		text: "A".repeat(213)
	},
	{
		kind: "超限",
		name: "214 字节（超出容量，应返回 null）",
		text: "A".repeat(214),
		expectNull: true
	},
	{
		kind: "超限",
		name: "超长中文（超出容量，应返回 null）",
		text: OVERFLOW_CN,
		expectNull: true
	}
];
const FITTING_CASES = CASES.filter((c) => !c.expectNull);
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
/** 超出本实现支持范围（版本 10 上限）：参考实现可能选到 11+ 版本，本实现必须返回 null */
const outOfRange = (rc) => rc.overflow !== void 0 || (rc.version ?? 0) > 10;
/** 逐格比对 */
function diff(mine, ref) {
	if (!mine) return {
		cells: 0,
		bad: Number.POSITIVE_INFINITY,
		first: "本实现返回 null"
	};
	const n = ref.length;
	if (mine.length !== n || mine.some((r) => r.length !== n)) return {
		cells: 0,
		bad: Number.POSITIVE_INFINITY,
		first: "尺寸不同：本实现 " + mine.length + "x" + (mine[0] ? mine[0].length : 0) + "，参考 " + n + "x" + n
	};
	let bad = 0;
	let first;
	for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (mine[r][c] !== (ref[r][c] === "1")) {
		bad++;
		if (!first) first = "(row=" + r + ", col=" + c + ") 本实现=" + (mine[r][c] ? 1 : 0) + " 参考=" + ref[r][c];
	}
	return {
		cells: n * n,
		bad,
		first
	};
}
/**
* 与参考实现同口径的四条罚分规则（ISO/IEC 18004 7.8.3.1）。
* 这里重写一遍是为了逐值核对 qr.ts 内部罚分实现的正确性。
*/
function lostPoint(grid) {
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
	for (let r = 0; r + 1 < n; r++) for (let c = 0; c + 1 < n; c++) {
		const v = grid[r][c];
		if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) lost += 3;
	}
	const PAT_A = [
		true,
		false,
		true,
		true,
		true,
		false,
		true,
		false,
		false,
		false,
		false
	];
	const PAT_B = [
		false,
		false,
		false,
		false,
		true,
		false,
		true,
		true,
		true,
		false,
		true
	];
	const hit = (get, s) => {
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
function refStyleGrid(mat, version) {
	const n = mat.length;
	const g = mat.map((row) => row.slice());
	const blank = (r, c) => {
		g[r][c] = false;
	};
	for (let i = 0; i <= 8; i++) if (i !== 6) {
		blank(i, 8);
		blank(8, i);
	}
	for (let i = n - 8; i < n; i++) {
		blank(i, 8);
		blank(8, i);
	}
	if (version >= 7) for (let r = 0; r < 6; r++) for (let c = n - 11; c <= n - 9; c++) {
		blank(r, c);
		blank(c, r);
	}
	return g;
}
const isWide = (ch) => /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(ch);
const dispWidth = (s) => Array.from(s).reduce((w, ch) => w + (isWide(ch) ? 2 : 1), 0);
const pad = (s, width) => s + " ".repeat(Math.max(0, width - dispWidth(s)));
function asciiQr(mat) {
	return mat.map((row) => row.map((v) => v ? "██" : "  ").join("")).join("\n");
}
function runPython(script, args, label) {
	const file = path.join(os.tmpdir(), "qr-verify-" + label + "-" + process.pid + ".py");
	fs.writeFileSync(file, script, "utf8");
	const res = spawnSync(PYTHON, [file, ...args], { stdio: [
		"ignore",
		"inherit",
		"inherit"
	] });
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
function compareCase(tc, rc) {
	const failures = [];
	const info = qrInfo(tc.text);
	const mineAuto = qrMatrix(tc.text);
	let cells = 0;
	let autoCells = 0;
	let bad = 0;
	let maskBad = 0;
	let maskMatrices = 0;
	const maskMarks = [];
	if (outOfRange(rc)) {
		const explicitNull = qrMatrixEx(tc.text, { version: 10 }) === null;
		const nullOk = info === null && mineAuto === null && explicitNull;
		if (!nullOk) failures.push(tc.name + "：超出支持范围时应返回 null");
		if (tc.expectNull !== true) failures.push(tc.name + "：容量预期与实际不符（参考实现版本 " + (rc.version ?? ">10") + "）");
		return {
			cells: 0,
			fixedCells: 0,
			autoCells: 0,
			bad: 0,
			maskMatrices: 0,
			maskBad: 0,
			autoBad: 0,
			autoMaskSame: false,
			versionOk: nullOk,
			maskMarks,
			failures
		};
	}
	const versionOk = info !== null && info.version === rc.version;
	if (!versionOk) failures.push(tc.name + "：版本选择不一致（本实现 " + (info ? info.version : "null") + "，参考 " + rc.version + "）");
	for (let mask = 0; mask < 8; mask++) {
		const d = diff(qrMatrixEx(tc.text, {
			version: rc.version,
			mask
		}), rc.masks[String(mask)]);
		maskMatrices++;
		cells += d.cells;
		bad += d.bad;
		maskBad += d.bad;
		maskMarks.push(d.bad === 0 ? "✓" : "✗");
		if (d.bad !== 0) failures.push(tc.name + " mask=" + mask + "：" + d.first);
	}
	const fixedCells = cells;
	const autoDiff = diff(mineAuto, rc.auto);
	cells += autoDiff.cells;
	autoCells = autoDiff.cells;
	const autoMaskSame = info !== null && info.mask === rc.autoMask;
	if (info) {
		if (diff(qrMatrixEx(tc.text, {
			version: info.version,
			mask: info.mask
		}), rc.masks[String(info.mask)]).bad !== 0) failures.push(tc.name + "：自动结果与显式指定版本/掩码不一致");
	}
	return {
		cells,
		fixedCells,
		autoCells,
		bad,
		maskMatrices,
		maskBad,
		autoBad: autoDiff.bad,
		autoMaskSame,
		versionOk,
		maskMarks,
		failures
	};
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qr-verify-"));
const payloadPath = path.join(tmp, "payload.json");
const refPath = path.join(tmp, "reference.json");
const coverage = [];
for (let v = 1; v <= 10; v++) {
	const probe = qrInfo("A", { version: v });
	const ccBits = v < 10 ? 8 : 16;
	const maxBytes = Math.floor((probe.dataCodewords * 8 - 4 - ccBits) / 8);
	coverage.push({
		name: "版本 " + v + " 满载 " + maxBytes + " 字节",
		text: "A".repeat(maxBytes)
	});
}
fs.writeFileSync(payloadPath, JSON.stringify({
	cases: CASES.map((c) => ({
		name: c.name,
		text: c.text
	})),
	coverage
}), "utf8");
runPython(PY_REFERENCE, [payloadPath, refPath], "reference");
const ref = JSON.parse(fs.readFileSync(refPath, "utf8"));
console.log("");
console.log("══ 二维码编码交叉验证：src/lib/qr.ts  vs  python-qrcode ══");
console.log("");
const failures = [];
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
const conventionCases = [];
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
		console.log(label + String(rc.bytes).padStart(4) + "  超出版本 10 支持范围 → qrMatrix()=null " + (r.versionOk ? "✓" : "✗") + "（" + refNote + "，本实现上限 v10）");
		return;
	}
	console.log(label + String(rc.bytes).padStart(4) + "  " + String(info.version) + "/" + rc.version + (r.versionOk ? " ✓" : " ✗") + "        " + String(info.mask) + "/" + rc.autoMask + (r.autoMaskSame ? " ✓" : " ≠") + "          " + r.maskMarks.join("") + "   " + (r.autoBad === 0 ? "✓" : "≠（掩码口径不同）"));
});
console.log("");
console.log("  业务输入小计：固定掩码矩阵 " + maskMatricesAll + " 个 / 不一致 " + maskBadAll + " 格；自动掩码矩阵 " + autoMatchCount + "/" + autoMatrices + " 逐格一致");
console.log("");
console.log("【2】版本 1~10 全覆盖逐格比对（每版取刚好塞满的载荷）");
console.log("");
console.log("  版本  字节  矩阵   参考自动掩码  本实现掩码  8 种固定掩码逐格  自动矩阵");
console.log("  " + "─".repeat(84));
let covMatrices = 0;
let covBad = 0;
coverage.forEach((cov, i) => {
	const rc = ref.coverage[i];
	const r = compareCase({
		kind: "覆盖",
		name: cov.name,
		text: cov.text
	}, rc);
	failures.push(...r.failures);
	totalCells += r.cells;
	fixedCellsAll += r.fixedCells;
	autoCellsAll += r.autoCells;
	totalBad += r.bad;
	maskMatricesAll += r.maskMatrices;
	maskBadAll += r.maskBad;
	covMatrices += r.maskMatrices;
	covBad += r.maskBad;
	const info = qrInfo(cov.text);
	autoMatrices++;
	if (r.autoBad === 0) autoMatchCount++;
	else conventionCases.push(cov.name);
	if (r.autoMaskSame) autoMaskSameCount++;
	console.log("  v" + String(rc.version).padStart(2) + "    " + String(rc.bytes).padStart(4) + "  " + String(info.size).padStart(2) + "x" + String(info.size).padEnd(2) + "  " + String(rc.autoMask).padStart(2) + "            " + String(info.mask).padStart(2) + "          " + (r.maskBad === 0 ? "✓ x8" : "✗") + "                 " + (r.autoBad === 0 ? "✓" : "mask " + info.mask + " vs " + rc.autoMask));
});
console.log("");
console.log("  版本覆盖小计：" + coverage.length + " 个版本，" + covMatrices + " 个固定掩码矩阵 / 不一致 " + covBad + " 格");
console.log("");
console.log("【3】参数表比对（纠错等级 M，版本 1~10）");
console.log("");
let tableOk = 0;
for (let v = 1; v <= 10; v++) {
	const reference = ref.blocksM[String(v)];
	const info = qrInfo("A", { version: v });
	const mineBlocks = info ? info.blockDataCodewords.map((d) => [d + info.ecCodewordsPerBlock, d]) : [];
	const blocksOk = mineBlocks.length === reference.length && mineBlocks.every((b, k) => b[0] === reference[k][0] && b[1] === reference[k][1]);
	const capacityOk = info !== null && info.dataCodewords * 8 === ref.bitLimitM[String(v)];
	const remain = info ? info.dataModules - info.totalCodewords * 8 : -1;
	const modulesOk = info !== null && remain >= 0 && remain < 8 && remain === info.dataModules % 8;
	const versionOk = info !== null && info.version === v && info.size === 4 * v + 17;
	const ok = blocksOk && capacityOk && modulesOk && versionOk;
	if (ok) tableOk++;
	console.log("  v" + String(v).padStart(2) + "  " + String(info ? info.blockDataCodewords.length : 0) + " 块（数据 " + String(info ? info.blockDataCodewords[0] : 0) + " + 纠错 " + String(info ? info.ecCodewordsPerBlock : 0) + "）/块  容量 " + String(info ? info.dataCodewords : 0) + " 码字 = " + String(info ? info.dataCodewords * 8 : 0) + " bit  数据模块 " + String(info ? info.dataModules : 0) + "（剩余 " + remain + " bit）  " + (ok ? "✓" : "✗"));
	if (!ok) failures.push("v" + v + " 分块/容量/数据模块自检失败");
}
console.log("");
console.log("  参数表：" + tableOk + "/10 版本与参考实现 rs_blocks / BIT_LIMIT_TABLE 完全一致");
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
const conventionDiff = [];
const scoringCases = [...CASES.filter((c) => !c.expectNull).map((c, i) => ({
	name: c.name,
	text: c.text,
	rc: ref.cases[idxOfCase(c.name)]
})), ...coverage.map((c, i) => ({
	name: c.name,
	text: c.text,
	rc: ref.coverage[i]
}))];
function idxOfCase(name) {
	return CASES.findIndex((c) => c.name === name);
}
for (const sc of scoringCases) {
	const rc = sc.rc;
	if (!rc.version || !rc.lostPoints || !rc.lostPointsFinal) continue;
	const finalLost = [];
	const testLost = [];
	for (let mask = 0; mask < 8; mask++) {
		const mat = qrMatrixEx(sc.text, {
			version: rc.version,
			mask
		});
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
	const mineMask = qrInfo(sc.text).mask;
	if (isoArg === mineMask) isoArgminSame++;
	else failures.push(sc.name + "：本实现口径 argmin " + isoArg + " != 本实现自动掩码 " + mineMask);
	const autoDiffers = diff(qrMatrix(sc.text), rc.auto).bad !== 0;
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
console.log("");
console.log("【5】渲染回读（typst 画矩阵 → PNG → OpenCV 解码）");
console.log("");
fs.mkdirSync(OUT_DIR, { recursive: true });
const images = [];
let renderFail = 0;
CASES.forEach((tc, i) => {
	const mat = qrMatrix(tc.text);
	if (!mat) return;
	const n = mat.length;
	const page = (n + 8) * 3;
	const body = mat.map((row) => "(" + row.map((v) => v ? "true" : "false").join(",") + ")").join(",");
	const typ = [
		"#set page(width: " + page + "pt, height: " + page + "pt, margin: 0pt, fill: white)",
		"#let mat = (" + body + ")",
		"#let u = 3pt",
		"#box(width: " + page + "pt, height: " + page + "pt, {",
		"  for (y, row) in mat.enumerate() {",
		"    for (x, on) in row.enumerate() {",
		"      if on { place(dx: (x + 4) * u, dy: (y + 4) * u, rect(width: u, height: u, fill: black)) }",
		"    }",
		"  }",
		"})",
		""
	].join("\n");
	const slug = "case-" + String(i + 1).padStart(2, "0") + "-v" + (n - 17) / 4;
	const typPath = path.join(OUT_DIR, slug + ".typ");
	const pngPath = path.join(OUT_DIR, slug + ".png");
	fs.writeFileSync(typPath, typ, "utf8");
	const res = spawnSync(TYPST, [
		"compile",
		typPath,
		pngPath,
		"--ppi",
		"300"
	], { stdio: [
		"ignore",
		"ignore",
		"pipe"
	] });
	if (res.status === 0 && fs.existsSync(pngPath)) images.push({
		name: tc.name,
		text: tc.text,
		png: pngPath
	});
	else {
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
	fs.writeFileSync(decPayload, JSON.stringify({ images: images.map((im) => ({
		name: im.name,
		png: im.png
	})) }), "utf8");
	runPython(PY_DECODE, [decPayload, decOut], "decode");
	const decoded = JSON.parse(fs.readFileSync(decOut, "utf8"));
	console.log("");
	decoded.forEach((d, i) => {
		const expect = images[i].text;
		let verdict;
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
console.log("");
console.log("【6】端到端：模板渲染出的 PNG 里的二维码能否被独立解码器扫出原文");
console.log("");
const tplDecode = [];
const tplJobs = [];
const tplSkipped = [];
for (const id of [
	"zz",
	"cq",
	"zy",
	"bj3",
	"bj6"
]) {
	const png = path.resolve("out", "tpl-" + id + ".png");
	const src = path.resolve("src", "templates", id + ".ts");
	if (!fs.existsSync(png)) continue;
	const code = fs.existsSync(src) ? fs.readFileSync(src, "utf8") : "";
	if (!/qrBlock\s*\(/.test(code)) {
		tplSkipped.push("tpl-" + id);
		continue;
	}
	tplJobs.push({
		name: "tpl-" + id,
		png,
		crop: path.join(OUT_DIR, "tpl-" + id + "-qr.png")
	});
}
if (tplJobs.length) {
	const srcOf = (id) => path.resolve("src", "templates", id.replace(/^tpl-/, "") + ".ts");
	const dPayload = path.join(tmp, "tpl-decode-in.json");
	const dOut = path.join(tmp, "tpl-decode-out.json");
	fs.writeFileSync(dPayload, JSON.stringify({ images: tplJobs }), "utf8");
	runPython(PY_DECODE, [dPayload, dOut], "tpl-decode");
	JSON.parse(fs.readFileSync(dOut, "utf8")).forEach((d, i) => {
		const file = srcOf(tplJobs[i].name);
		let expect = null;
		if (fs.existsSync(file)) {
			const m = fs.readFileSync(file, "utf8").match(/qrText:\s*"([^"]*)"/);
			if (m) expect = m[1];
		}
		const match = d.ok && expect !== null && d.decoded === expect;
		tplDecode.push({
			name: tplJobs[i].name,
			expect,
			decoded: d.decoded,
			ok: d.ok,
			how: d.how
		});
		console.log("  " + tplJobs[i].name.padEnd(9) + path.basename(tplJobs[i].png) + "  " + (match ? "✓ 扫出模板默认内容：" : d.ok ? "△ 扫出内容与源码默认值不同：" : "✗ 未扫出：") + (d.decoded ?? "") + (d.ok && expect !== null && !match ? "（源码默认 " + expect + "）" : ""));
		if (!d.ok) failures.push(tplJobs[i].name + " 渲染件里的二维码无法被解码");
	});
	console.log("");
	console.log("  渲染件二维码解码：" + tplDecode.filter((t) => t.ok).length + "/" + tplDecode.length + " 张成功；裁剪图见 out/qr-verify/tpl-*-qr.png");
} else console.log("  out/tpl-*.png 里没有可解的二维码（需先运行 render-all）");
console.log("  模板接线情况：" + (tplSkipped.length ? tplSkipped.join("、") + " 的模板源码尚未调用 qrBlock()，渲染件中不含二维码 → 跳过（模板侧待接线，与编码器无关）" : "所有模板均已调用 qrBlock()"));
tplDecodeGlobal = tplDecode.filter((t) => t.ok).length;
tplDecodeTotal = tplDecode.length;
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
		""
	].join("\n");
	const integTypPath = path.join(OUT_DIR, "kit-qrblock-144dpi.typ");
	const integPng = path.join(OUT_DIR, "kit-qrblock-144dpi.png");
	fs.writeFileSync(integTypPath, integTyp, "utf8");
	const integRes = spawnSync(TYPST, [
		"compile",
		integTypPath,
		integPng,
		"--ppi",
		"144"
	], { stdio: [
		"ignore",
		"ignore",
		"pipe"
	] });
	if (integRes.status !== 0 || !fs.existsSync(integPng)) {
		console.log("  ✗ kit.qrBlock 渲染失败：" + (integRes.stderr ? integRes.stderr.toString().slice(0, 200) : "退出码 " + integRes.status));
		failures.push("kit.qrBlock 集成渲染失败");
	} else {
		const i2 = path.join(tmp, "integ-in.json");
		const o2 = path.join(tmp, "integ-out.json");
		fs.writeFileSync(i2, JSON.stringify({ images: [{
			name: "kit-qrblock",
			png: integPng,
			crop: path.join(OUT_DIR, "kit-qrblock-144dpi-crop.png")
		}] }), "utf8");
		runPython(PY_DECODE, [i2, o2], "integ");
		const rr = JSON.parse(fs.readFileSync(o2, "utf8"));
		integOk = rr[0].ok && rr[0].decoded === integText;
		console.log("  " + qrBlock(integText, 60).slice(0, 3) + "...（" + qrInfo(integText).size + "x" + qrInfo(integText).size + " 矩阵）→ typst 144dpi PNG → OpenCV 解码");
		console.log("  " + (integOk ? "✓ 解码内容与入参完全一致：" : "✗ 解码失败：") + (rr[0].decoded ?? "null") + "（" + rr[0].how + "）");
		if (!integOk) failures.push("kit.qrBlock 集成渲染的二维码解码不一致");
	}
}
console.log("");
console.log("══ 结论 ══");
console.log("  ① 固定掩码逐格比对：" + maskMatricesAll + " 个矩阵（业务输入 " + FITTING_CASES.length + " 组 + 版本 1~10 全覆盖 x8 掩码），共 " + fixedCellsAll + " 个模块，不一致 " + totalBad + " 处");
console.log("  ② 自动掩码逐格比对：" + autoMatrices + " 个矩阵，共 " + autoCellsAll + " 个模块；与参考完全相同 " + autoMatchCount + " 个，" + (autoMatrices - autoMatchCount) + " 个因打分口径不同选了另一个合法掩码（【4】已验证可完全解释）");
console.log("  ③ 参数表：" + tableOk + "/10 版本与参考一致；罚分值逐值核对：" + (lpTestChecked - lpTestBad + lpFinalChecked - lpFinalBad) + "/" + (lpTestChecked + lpFinalChecked) + " 相同");
console.log("  ④ 渲染回读（typst → PNG → OpenCV）：" + decodeOk + "/" + images.length + " 张解出原文，与输入完全一致");
console.log("  ⑤ 模板渲染件（out/tpl-*.png）：" + (tplDecodeTotal ? tplDecodeGlobal + "/" + tplDecodeTotal + " 张能扫出内容" : "当前无模板调用 qrBlock（模板侧待接线），无可解码对象") + "；kit.qrBlock() 集成链路（144dpi）：" + (integOk ? "✓ 渲染出的二维码可解出原文" : "✗"));
console.log("");
console.log("  口径说明：本实现按 ISO/IEC 18004 把格式信息计入掩码罚分（与 ZXing 同口径）；python-qrcode 打分时把格式信息视为浅色。");
console.log("            这只影响自动挑哪一个合法掩码（格式信息始终与实际所用掩码匹配），任何一种掩码下的矩阵本身 100% 一致。");
console.log("");
if (totalBad === 0 && failures.length === 0) console.log("PASS：编码实现与 python-qrcode 在 " + maskMatricesAll + " 个固定掩码矩阵上逐格 100% 一致（" + fixedCellsAll + " 个模块 0 处不同）；版本选择、RS 分块、数据容量、罚分函数全部对齐；渲染出的二维码 " + decodeOk + "/" + images.length + " 可被独立解码器扫回原文。");
else {
	console.log("FAIL：" + failures.length + " 项问题");
	for (const f of failures.slice(0, 20)) console.log("  - " + f);
}
console.log("");
console.log("样例矩阵（手机号 13800138000）：");
console.log(asciiQr(qrMatrix("13800138000")));
process.exit(totalBad === 0 && failures.length === 0 ? 0 : 1);
//#endregion
