import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
//#region src/lib/doc.ts
const emptyExtra = () => ({
	rxNo: "",
	feeCategory: "",
	medicalId: "",
	caseNo: "",
	idType: "",
	ssn: "",
	orgCode: "",
	unitName: "",
	visitNo: "",
	visitDate: "",
	weight: "",
	phone: "",
	pharmacy: "",
	note: "",
	amount: "",
	pageInfo: "第1页 共1页",
	printTime: "",
	qrText: ""
});
let seq = 0;
const newId = () => `d${Date.now().toString(36)}${(seq++).toString(36)}`;
const totalOf = (drugs) => drugs.reduce((sum, d) => sum + (Number(d.price) || 0) * (Number(d.qty) || 0), 0);
function defaultDoc() {
	return {
		templateId: "bj6",
		docType: "非医保处方",
		hospital: "北京大学第六医院",
		patientName: "张伟",
		gender: "男",
		age: "21",
		dept: "精神科",
		cardNo: "0000000000",
		serial: "000000",
		diagnoses: [
			"心境[情感]障碍",
			"抑郁状态",
			"偏执性反应"
		],
		drugs: [{
			id: newId(),
			name: "氢溴酸伏硫西汀片",
			brand: "石药",
			spec: "10mg x 14片/盒",
			price: 9.87,
			qty: 2,
			usage: "每日1次 每次1片 口服"
		}],
		doctor: "陈明",
		feeKey: "丙",
		printDate: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
		validDays: 1,
		options: {
			showBarcode: true,
			showCardNo: true,
			showPrintDate: true,
			showSerial: true,
			showFeeLine: true,
			showFeeMark: true,
			showTips: true,
			showSign: true,
			showUsage: false,
			showMoney: false,
			selfPayLabel: "个人自付",
			tips: [
				"(1)请遵医嘱服药",
				"(2)请在窗口点清药品",
				"(3)处方当日有效"
			]
		},
		extra: emptyExtra(),
		extraByTemplate: {}
	};
}
//#endregion
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
//#endregion
//#region src/templates/kit.ts
/** Typst 字符串转义 */
const esc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
/** 金额：两位小数 */
const money = (v) => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2);
/** 去掉小数末尾多余的 0：12.40 -> 12.4，6.00 -> 6 */
const trim = (v) => {
	const s = typeof v === "number" ? String(v) : String(v ?? "");
	return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};
/** 页面与全局设置。页边距默认 0，模板自己排版。 */
function preamble(widthPt, heightPt, opts) {
	const { margin = "0pt", baseSize = 9 } = opts ?? {};
	const parts = margin.trim().split(/\s+/);
	return [
		`#set page(width: ${widthPt}pt, height: ${heightPt}pt, margin: ${parts.length === 1 ? parts[0] : `(y: ${parts[0]}, x: ${parts[1]})`}, fill: white)`,
		"#set text(font: (\"SimSun\", \"Times New Roman\"), lang: \"zh\", fill: black, size: " + baseSize + "pt)",
		"#set par(leading: 0.62em)",
		"#let px = 0.5pt"
	].join("\n");
}
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
//#region src/templates/zz.ts
/**
* 印刷日期的紧凑形态：2026-10-11 → 20261011。
* 模板里「编号内嵌年月日」的字段（如处方号 20260507009159 的前 8 位）统一用它派生，
* 使编号里的日期跟随 doc.printDate；表单里印刷日期是普通文本框，5 月 7 日可能写成 2026-5-7，
* 故按年/月/日分别补零，拆不出三段时退回「取有效数字的前 8 位」（已是 20261011 这类紧凑写法）。
*/
const ymd = (d) => {
	const p = String(d || "").split(/\D+/).filter(Boolean);
	return p.length >= 3 ? p[0].padStart(4, "0") + p[1].padStart(2, "0") + p[2].padStart(2, "0") : String(d || "").replace(/\D/g, "").slice(0, 8);
};
const PAGE_W = 419.5;
const PAGE_H = 595.3;
const L = 40;
const R = 377;
const BODY = 9.5;
const TITLE = 13.5;
const BOX_FONT = 9.5;
const RP_FONT = 12.5;
const FOOT_SMALL = 7.5;
const Y = {
	boxTop: 23.4,
	boxBot: 46.8,
	boxMid: 32.7,
	title: 33.7,
	scan: 36.3,
	row1: 69.7,
	row2: 91.5,
	row3: 113.7,
	rule1: 122,
	diag: 132.4,
	rule2: 142.2,
	rp: 152,
	drug: 172.7,
	blank: 284.5,
	fRule: 535,
	fRow1: 543,
	fRow2: 561,
	fRow3: 579
};
const X = {
	boxL: 298.6,
	boxR: 362.5,
	boxMid: 661.1 / 2,
	scan: 48.7,
	qr: 42,
	qrTop: 42.4,
	qrSide: 66,
	rxR: R,
	fee: 114,
	name: 114,
	sex: 196,
	age: 262,
	visit: 149.8,
	diag: 90,
	idx: 36,
	drug: 67,
	specR: 322,
	qtyR: 368,
	usage: 58,
	sig: 208,
	check: 208,
	page: 136,
	print: 232
};
const PITCH = 18.1;
const NOTE_PITCH = 18.1;
const GAP = 33.7;
const DIAG_PITCH = 15;
const n = (v) => {
	return v.toFixed(2).replace(/\.?0+$/, "") || "0";
};
/** Typst 定位 helper：maxw>0 且实测超宽时按比例缩字号，保证不越界 */
const HELPERS = [
	`#let G(x, y, size, body, font: "SimSun", weight: "regular", mode: "l", maxw: 0pt) = context {`,
	`  let mk(s) = text(font: font, size: s, weight: weight, body)`,
	`  let t0 = mk(size)`,
	`  let w0 = measure(t0).width`,
	`  let s = if maxw > 0pt and w0 > maxw { size * (maxw / w0) } else { size }`,
	`  let t = if s == size { t0 } else { mk(s) }`,
	`  let w = if s == size { w0 } else { measure(t).width }`,
	`  let dx = if mode == "c" { x - w / 2 } else if mode == "r" { x - w } else { x }`,
	`  place(dx: dx, dy: y, t)`,
	`}`,
	`#let T(x, y, size, body, font: "SimSun", weight: "regular", maxw: 0pt) = G(x, y, size, body, font: font, weight: weight, mode: "l", maxw: maxw)`,
	`#let TC(x, y, size, body, font: "SimSun", weight: "regular", maxw: 0pt) = G(x, y, size, body, font: font, weight: weight, mode: "c", maxw: maxw)`,
	`#let TR(x, y, size, body, font: "SimSun", weight: "regular", maxw: 0pt) = G(x, y, size, body, font: font, weight: weight, mode: "r", maxw: maxw)`
].join("\n");
function buildZz(doc) {
	const runs = [];
	const add = (r) => {
		if (String(r.text ?? "").trim() !== "") runs.push(r);
	};
	/**
	* 以「文字墨迹中心 y」写字（参考照片量到的就是墨迹中心）。
	* Typst place 的 dy 是 em 盒顶；SimSun 的 CJK 墨迹中心约在 em 顶下方 0.305em，
	* 故 dy = cy - 0.195em，渲染出来的墨迹中心正好落在 cy。
	*/
	const addC = (x, cy, size, text, o = {}) => add({
		x,
		y: cy - size * .195,
		size,
		text,
		...o
	});
	const e = doc.extra;
	const amount = e.amount?.trim() || money(totalOf(doc.drugs));
	const hospital = doc.hospital?.trim() || "郑州市中心医院";
	const rxNo = (e.rxNo || "").trim() || ymd(doc.printDate) + "009159";
	const boxText1 = doc.docType?.trim() || "普通处方";
	const boxText2 = Number(doc.validDays) <= 1 ? "处方当日有效" : `处方` + doc.validDays + `日内有效`;
	addC(X.boxMid, (Y.boxTop + Y.boxMid) / 2, BOX_FONT, boxText1, {
		anchor: "c",
		maxw: X.boxR - X.boxL - 6
	});
	addC(X.boxMid, (Y.boxMid + Y.boxBot) / 2, BOX_FONT, boxText2, {
		anchor: "c",
		maxw: X.boxR - X.boxL - 6
	});
	addC(185.5, Y.title, TITLE, hospital + `处方笺`, {
		anchor: "c",
		weight: "bold",
		maxw: 2 * (X.boxL - 185.5 - 4)
	});
	addC(X.scan, Y.scan, BODY, "扫码支付");
	addC(X.rxR, Y.row1, BODY, `处方号：` + rxNo, {
		anchor: "r",
		maxw: 190
	});
	addC(X.fee, Y.row1, BODY, `费别：` + e.feeCategory, { maxw: X.age - X.fee - 6 });
	addC(X.name, Y.row2, BODY, `姓名：` + doc.patientName, { maxw: X.sex - X.name - 6 });
	addC(X.sex, Y.row2, BODY, `性别：` + doc.gender, { maxw: X.age - X.sex - 6 });
	addC(X.age, Y.row2, BODY, `年龄：` + doc.age + `岁`, { maxw: R - X.age });
	addC(L, Y.row3, BODY, `科别：` + doc.dept, { maxw: X.visit - L - 6 });
	addC(X.visit, Y.row3, BODY, `住院（门诊）号 ` + e.visitNo, { maxw: 108 });
	addC(R, Y.row3, BODY, `日期：` + e.visitDate, {
		anchor: "r",
		maxw: 110
	});
	const diags = doc.diagnoses.map((d) => String(d ?? "").trim()).filter(Boolean).slice(0, 8);
	const diagShift = Math.max(0, diags.length - 1) * DIAG_PITCH;
	addC(L, Y.diag, BODY, "临床诊断：");
	diags.forEach((d, i) => addC(X.diag, Y.diag + i * DIAG_PITCH, BODY, d, { maxw: R - X.diag }));
	addC(38, Y.rp + diagShift, RP_FONT, "Rp:", {
		weight: "bold",
		font: ["Arial", "SimSun"]
	});
	const drugs = doc.drugs.slice(0, 6);
	const drugTop = Y.drug + diagShift;
	const drugBottom = Y.fRule - 46;
	const noteCount = drugs.filter((d) => String(d.note ?? "").trim()).length;
	const need = drugs.length * PITCH + Math.max(0, drugs.length - 1) * GAP + noteCount * NOTE_PITCH;
	const k = need > drugBottom - drugTop ? Math.max(.5, (drugBottom - drugTop) / need) : 1;
	const pitch = PITCH * k;
	const gap = GAP * k;
	const notePitch = NOTE_PITCH * k;
	let cy = drugTop;
	let lastLine = drugTop;
	drugs.forEach((d, i) => {
		const nameLine = (d.prefix ?? "") + d.name + (d.brand ? `(` + d.brand + `)` : "");
		const spec = d.spec ? String(d.spec) : "";
		const qty = trim(d.qty) + (d.unit || "");
		const usage = d.usage || [
			d.dose,
			d.route,
			d.freq,
			d.days ? `×` + d.days + `天` : ""
		].filter(Boolean).join(" ");
		const note = String(d.note ?? "").trim();
		addC(X.idx, cy, BODY, i + 1 + ".");
		addC(X.drug, cy, BODY, nameLine, { maxw: 160 });
		if (spec) addC(X.specR, cy, BODY, spec, {
			anchor: "r",
			maxw: 90
		});
		if (qty) addC(X.qtyR, cy, BODY, qty, {
			anchor: "r",
			maxw: 46
		});
		lastLine = cy;
		if (usage) {
			cy += pitch;
			addC(X.usage, cy, BODY, `用法：` + usage, { maxw: 250 });
			lastLine = cy;
		}
		if (note) {
			cy += notePitch;
			addC(X.usage, cy, BODY, `备注：` + note, { maxw: 250 });
			lastLine = cy;
		}
		cy += gap;
	});
	addC(L, Math.max(Y.blank, lastLine + 13), BODY, "以下处方空白");
	addC(L, Y.fRow1, BODY, "药费：");
	addC(74, Y.fRow1, BODY, amount);
	addC(124, Y.fRow1, BODY, "元");
	addC(X.sig, Y.fRow1, BODY, `医师签名：` + doc.doctor, { maxw: R - X.sig });
	addC(L, Y.fRow2, BODY, "审核、调配：");
	addC(X.check, Y.fRow2, BODY, "核对、发药：");
	addC(X.page, Y.fRow3, FOOT_SMALL, e.pageInfo || "第1页 共1页");
	addC(X.print, Y.fRow3, FOOT_SMALL, `打印时间 ` + e.printTime);
	const qrText = e.qrText || "https://pay.zzszxyy.com/rx/" + rxNo;
	const qr = qrBlock(qrText, X.qrSide);
	const out = [];
	out.push(`// ` + hospital + " 处方笺 —— 由「Prescription Master」生成，页面 419.5pt × 595.3pt，纯矢量输出");
	out.push(preamble(PAGE_W, PAGE_H, {
		margin: "0pt",
		baseSize: BODY
	}));
	out.push(QR_HELPER);
	out.push(HELPERS);
	out.push("");
	out.push("// ── 右上角「普通处方 / 处方当日有效」方框 ──");
	out.push(`#place(dx: ` + n(X.boxL) + `pt, dy: ` + n(Y.boxTop) + `pt, rect(width: ` + n(X.boxR - X.boxL) + `pt, height: ` + n(Y.boxBot - Y.boxTop) + `pt, stroke: 0.7pt))`);
	out.push(`#place(dx: ` + n(X.boxL) + `pt, dy: ` + n(Y.boxMid) + `pt, line(start: (0pt, 0pt), end: (` + n(X.boxR - X.boxL) + `pt, 0pt), stroke: 0.7pt))`);
	out.push("");
	out.push("// ── 横线：表头下细线 / 诊断下粗线 / 页脚横线 ──");
	out.push("#place(dx: 40pt, dy: " + Y.rule1 + "pt, line(start: (0pt, 0pt), end: (337pt, 0pt), stroke: 0.55pt))");
	out.push("#place(dx: 40pt, dy: " + n(Y.rule2 + diagShift) + "pt, line(start: (0pt, 0pt), end: (337pt, 0pt), stroke: 0.9pt))");
	out.push("#place(dx: 40pt, dy: " + Y.fRule + "pt, line(start: (0pt, 0pt), end: (337pt, 0pt), stroke: 0.8pt))");
	out.push("");
	out.push(`// ── 二维码（扫码支付）：` + qrText + ` ──`);
	out.push(`#place(dx: ` + X.qr + `pt, dy: ` + X.qrTop + `pt)[` + qr + `]`);
	out.push("");
	out.push("// ── 文字 ──");
	for (const r of runs) {
		const fn = r.anchor === "c" ? "TC" : r.anchor === "r" ? "TR" : "T";
		const args = [
			n(r.x) + "pt",
			n(r.y) + "pt",
			n(r.size) + "pt",
			`"` + esc(r.text) + `"`
		];
		const opt = [];
		if (r.font) opt.push(`font: (` + r.font.map((f) => `"` + f + `"`).join(", ") + `)`);
		if (r.weight && r.weight !== "regular") opt.push(`weight: "` + r.weight + `"`);
		if (r.maxw) opt.push(`maxw: ` + n(r.maxw) + `pt`);
		out.push(`#` + fn + "(" + args.join(", ") + (opt.length ? ", " + opt.join(", ") : "") + ")");
	}
	out.push("");
	return out.join("\n");
}
const zz = {
	id: "zz",
	name: "郑州市中心医院处方笺",
	hospital: "郑州市中心医院",
	desc: "门诊处方笺复刻：左侧扫码支付二维码、右上角普通处方/处方当日有效方框、费别/姓名/科别三行表头、临床诊断下粗横线、Rp 药品（规格与数量右对齐）、以下处方空白、页脚药费/医师签名/页码/打印时间",
	group: "门诊电子处方",
	page: {
		widthPt: PAGE_W,
		heightPt: PAGE_H
	},
	limits: {
		maxDiag: 12,
		maxDrugs: 20
	},
	sections: {
		patient: true,
		identity: true,
		visit: true,
		diagnosis: true,
		drugs: true,
		drugTable: true,
		tcm: false,
		footer: true
	},
	extraKeys: [
		{
			key: "rxNo",
			label: "处方号"
		},
		{
			key: "feeCategory",
			label: "费别"
		},
		{
			key: "visitNo",
			label: "住院(门诊)号"
		},
		{
			key: "visitDate",
			label: "日期"
		},
		{
			key: "amount",
			label: "药费"
		},
		{
			key: "pageInfo",
			label: "页码"
		},
		{
			key: "printTime",
			label: "打印时间"
		},
		{
			key: "qrText",
			label: "二维码内容"
		}
	],
	defaults: {
		hospital: "郑州市中心医院",
		docType: "普通处方",
		patientName: "孙磊",
		gender: "女",
		age: "31",
		dept: "皮肤科门诊",
		diagnoses: ["酒渣鼻(玫瑰痤疮 疗程用药)"],
		drugs: [{
			id: "zz1",
			name: "润燥止痒胶囊",
			brand: "",
			spec: "0.5g*48粒/盒",
			price: 52.18,
			qty: 5,
			usage: "2g口服 每天三次",
			prefix: "(基)",
			unit: "盒",
			freq: "每天三次",
			dose: "2g",
			route: "口服"
		}, {
			id: "zz2",
			name: "盐酸米诺环素胶囊",
			brand: "",
			spec: "50mg*20粒/盒",
			price: 60,
			qty: 2,
			usage: "50mg口服 每天二次",
			prefix: "(基)",
			unit: "盒",
			freq: "每天二次",
			dose: "50mg",
			route: "口服",
			note: "饭后立即吃"
		}],
		doctor: "吴静怡",
		validDays: 1,
		extra: {
			rxNo: "",
			feeCategory: "国家医保",
			visitNo: "0000000000",
			visitDate: "2026-05-07",
			amount: "260.90",
			pageInfo: "第1页 共1页",
			printTime: "2026/05/07 14:06:4",
			qrText: ""
		}
	},
	build: buildZz
};
//#endregion
//#region scripts/__zz_test.ts
const base = (() => {
	const d = zz.defaults ?? {};
	const b = defaultDoc();
	return {
		...b,
		...d,
		templateId: zz.id,
		options: {
			...b.options,
			...d.options ?? {}
		},
		extra: {
			...emptyExtra(),
			...d.extra ?? {}
		}
	};
})();
const mk = (over) => ({
	...base,
	...over
});
const drug = (i, note) => ({
	id: "d" + i,
	name: "复方多粘菌素B软膏" + i,
	spec: "10g/支",
	price: 26.4,
	qty: 1,
	usage: "外用 每天二次",
	prefix: "(基)",
	unit: "支",
	note
});
const variants = [
	["v1-single", mk({
		diagnoses: ["湿疹"],
		patientName: "王小明",
		drugs: [{
			id: "a",
			name: "氯雷他定片",
			spec: "10mg*6片/盒",
			price: 12,
			qty: 1,
			usage: "10mg口服 每天一次",
			unit: "盒"
		}]
	})],
	["v2-max", mk({
		diagnoses: [
			"酒渣鼻(玫瑰痤疮 疗程用药)",
			"高血压病2级(中危)",
			"2型糖尿病伴血糖控制不佳",
			"慢性胃炎",
			"高脂血症",
			"焦虑状态"
		],
		patientName: "欧阳娜娜娜娜娜",
		dept: "皮肤科门诊(专家门诊)",
		drugs: [
			1,
			2,
			3,
			4,
			5,
			6
		].map((i) => drug(i, "备注文字" + i))
	})],
	["v3-five", mk({
		diagnoses: [
			"痤疮",
			"脂溢性皮炎",
			"毛囊炎"
		],
		drugs: [
			1,
			2,
			3,
			4,
			5
		].map((i) => drug(i, i % 2 ? void 0 : "点涂"))
	})]
];
const out = path.resolve("out");
const typst = path.resolve("resources", process.platform === "win32" ? "typst.exe" : "typst");
for (const [name, doc] of variants) {
	const typ = path.join(out, `__zz_${name}.typ`), png = path.join(out, `__zz_${name}.png`);
	fs.writeFileSync(typ, zz.build(doc), "utf8");
	try {
		execFileSync(typst, [
			"compile",
			typ,
			png,
			"--ppi",
			"144"
		], { stdio: "pipe" });
		console.log("ok", name);
	} catch (e) {
		console.log("FAIL", name, String(e.stderr ?? e).slice(0, 400));
	}
}
//#endregion
