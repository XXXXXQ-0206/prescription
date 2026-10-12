import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
//#region src/lib/barcode.ts
/**
* Code 128 条码编码（纯前端实现，无依赖）。
* 输出为「按模块数表示的条/空宽度」序列，首元素必为条（bar），
* 调用方按目标宽度换算成像素即可直接画矩形。
*/
/** Code 128 的 107 个符号图形：每位数字表示一个条或空的模块数（条空相间） */
const PATTERNS = [
	"212222",
	"222122",
	"222221",
	"121223",
	"121322",
	"131222",
	"122213",
	"122312",
	"132212",
	"221213",
	"221312",
	"231212",
	"112232",
	"122132",
	"122231",
	"113222",
	"123122",
	"123221",
	"223211",
	"221132",
	"221231",
	"213212",
	"223112",
	"312131",
	"311222",
	"321122",
	"321221",
	"312212",
	"322112",
	"322211",
	"212123",
	"212321",
	"232121",
	"111323",
	"131123",
	"131321",
	"112313",
	"132113",
	"132311",
	"211313",
	"231113",
	"231311",
	"112133",
	"112331",
	"132131",
	"113123",
	"113321",
	"133121",
	"313121",
	"211331",
	"231131",
	"213113",
	"213311",
	"213131",
	"311123",
	"311321",
	"331121",
	"312113",
	"312311",
	"332111",
	"314111",
	"221411",
	"431111",
	"111224",
	"111422",
	"121124",
	"121421",
	"141122",
	"141221",
	"112214",
	"112412",
	"122114",
	"122411",
	"142112",
	"142211",
	"241211",
	"221114",
	"413111",
	"241112",
	"134111",
	"111242",
	"121142",
	"121241",
	"114212",
	"124112",
	"124211",
	"411212",
	"421112",
	"421211",
	"212141",
	"214121",
	"412121",
	"111143",
	"111341",
	"131141",
	"114113",
	"114311",
	"411113",
	"411311",
	"113141",
	"114131",
	"311141",
	"411131",
	"211412",
	"211214",
	"211232",
	"2331112"
];
const START_B = 104;
const START_C = 105;
const STOP = 106;
/** 生成 Code 128 条码；纯数字且偶数长度时用 Code C（更短更宽），否则用 Code B */
function encodeCode128(raw) {
	const text = (raw || "").replace(/\s+/g, "");
	const useC = /^\d{2,}$/.test(text) && text.length % 2 === 0;
	const values = [];
	let codeSet;
	if (useC) {
		codeSet = "C";
		values.push(START_C);
		for (let i = 0; i < text.length; i += 2) values.push(Number.parseInt(text.slice(i, i + 2), 10));
	} else {
		codeSet = "B";
		values.push(START_B);
		for (const ch of text) {
			const code = ch.charCodeAt(0);
			values.push(code >= 32 && code <= 126 ? code - 32 : 0);
		}
	}
	let sum = values[0];
	for (let i = 1; i < values.length; i++) sum += i * values[i];
	values.push(sum % 103);
	values.push(STOP);
	const widths = [];
	for (const v of values) {
		const pat = PATTERNS[v] ?? PATTERNS[0];
		for (const d of pat) widths.push(Number(d));
	}
	return {
		widths,
		modules: widths.reduce((a, b) => a + b, 0),
		codeSet,
		text
	};
}
/** 把条码展开成绝对像素坐标的条（x0,x1），落在 [left,left+width] 区间内 */
function barsToRects(bc, left, width) {
	const unit = width / bc.modules;
	const rects = [];
	let x = left;
	for (let i = 0; i < bc.widths.length; i++) {
		const w = bc.widths[i] * unit;
		if (i % 2 === 0) rects.push([x, x + w]);
		x += w;
	}
	return rects;
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
//#region src/templates/kit.ts
/**
* 模板工具箱：所有模板共用的 Typst 片段与工具函数。
* 新模板只需 import 这里的东西，再写自己的版面即可。
*/
/** Typst 字符串转义 */
const esc$2 = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
/** 金额：两位小数 */
const money$1 = (v) => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2);
/** 去掉小数末尾多余的 0：12.40 -> 12.4，6.00 -> 6 */
const trim = (v) => {
	const s = typeof v === "number" ? String(v) : String(v ?? "");
	return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};
/** 中文按 1em、ASCII 按 0.5em 估算像素宽度（用于生成期预警） */
const tw = (text) => {
	let w = 0;
	for (const ch of String(text ?? "")) w += ch.charCodeAt(0) > 11904 ? 1 : .5;
	return w;
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
/** 表格线/分隔线 */
function ruleLine(x1, y1, x2, y2, w = .6) {
	return `#place(dx: ${x1}pt, dy: ${y1}pt, line(start: (0pt, 0pt), end: (${x2 - x1}pt, ${y2 - y1}pt), stroke: ${w}pt))`;
}
/**
* 条码块：在当前位置生成一个 `w × h`（pt）的 Code 128 条码，可放在任意流式布局里。
* bars 为模块宽度序列（由 encodeCode128 得到）。
*/
function barcodeBlock(text, wPt, hPt) {
	return [`#let __bars = (${encodeCode128(text ?? "").widths.join(", ")})`, `#barcode(__bars, ${wPt}pt, ${hPt}pt)`].join("\n");
}
/** 条形码 helper 的 Typst 定义（放在 preamble 之后） */
const BARCODE_HELPER = `#let barcode(bars, w, h) = {
  let unit = w / bars.sum()
  let pos = 0pt
  box(width: w, height: h, {
    for (i, m) in bars.enumerate() {
      if calc.even(i) {
        place(dx: pos, dy: 0pt, rect(width: m * unit, height: h, fill: black))
      }
      pos += m * unit
    }
  })
}`;
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
/** 合计金额 */
const total = (doc) => totalOf(doc.drugs);
//#endregion
//#region src/templates/bj3.ts
/**
* 北京大学第三医院处方（医保）门诊
* 版面按 refs/bj3_beiyi.png 逐项测量复刻（横向 A4 842 × 595.3pt）：
*
*   ① 页眉     左上 Code128 条码 + ID号；居中大标题「北京大学第三医院处方」+ 小字「（医保）」，右侧「门诊」
*   ② 患者栏   三行三列：ID号 · 姓名 · 单位 | 身份 · 性别 · 年龄 | 社保号 · 定点医疗机构编码 · 证件号
*   ③ 就诊栏   就诊科室 / 就诊次 / 就诊日期（三家分列），下接一条通栏横线
*   ④ 诊断栏
*   ⑤ 药品区   RP + 五列表头（药品名称/规格 | 数量 | 频率 | 用量 | 给药途径）；每条药品占两行：
*              第 1 行 = 带圈序号 + 名称（厂牌），第 2 行 = （规格）（单价 元）+ 超限原因
*   ⑥ 页脚     横线 → 审核/发药 · 取药药房 · 医师 → 提示（三条须知）→ 合计金额/打印时间
*              → 费用类别 → 就诊次/证件号 → 底部说明
*
* 坐标定义：以「照片纸边」为基准换算到页面 pt。参考照片整页 = 1400px 宽，
* 纸左边缘 x≈22.8px、右边缘 x≈1370px，故 1px ≈ 0.6143pt，页面左边距取 22.8pt，右边距取 21pt。
* 纵向容差已按照片行基线逐条校准（水平方向留白以竖线/横线为准）。
*
* 可变内容适配：药品 1~6 条、诊断 1~6 条、姓名/科室长短不一；
* 所有单行文本都带 maxw，超宽由 Typst 端按比例缩字号，保证不溢出、不串栏；
* 药品条数超过 4 条时页脚整体下移，避免压到药表。
*/
const PAGE_W$1 = 842;
const PAGE_H$1 = 595.3;
const X_L = 22.8;
const X_R = 820.5;
const X_C = 429.5;
const P_X1 = 22.8;
const P_X2 = 274.7;
const P_X3 = 507.4;
const D_NO = 377;
const D_DATE = 587.2;
const F_MID = 425;
const F_RIGHT = 767;
/** 药品表格列（绝对坐标 pt；x 为起笔点或居中点，w 为可用宽度） */
const COLS = {
	name: {
		x: 22.1,
		center: 0,
		w: 400
	},
	spec: {
		x: 34.2,
		center: 0,
		w: 400
	},
	qty: {
		x: 536.4,
		center: 1,
		w: 70
	},
	freq: {
		x: 601.3,
		center: 1,
		w: 70
	},
	dose: {
		x: 660.6,
		center: 1,
		w: 70
	},
	route: {
		x: 727.2,
		center: 1,
		w: 80
	}
};
const Y$1 = {
	barcodeY: 9.8,
	barcodeW: 202,
	barcodeH: 49,
	barcodeText: 60.5,
	head: 24.6,
	p1: 86.6,
	pStep: 19.2,
	dept: 152,
	diag: 166.5,
	rule: 180.8,
	rp: 196.4,
	drugHead: 200.4,
	drugTop: 220.8,
	drugRow: 36.3,
	offName: 0,
	offSpec: 17
};
const F$1 = {
	rule: 437,
	base: 445,
	rowGap: 17.6,
	tips: 463,
	tipsGap: 17,
	fee: 514,
	note: 531
};
const S = {
	title: 19,
	titleSub: 10,
	clinic: 14,
	body: 12,
	tiny: 10,
	rp: 15,
	drugHead: 11,
	drugName: 11.5,
	drugSpec: 11,
	drugVal: 11.5,
	foot: 12,
	small: 11.5,
	tips: 11.5,
	tipsHead: 11.5
};
/** 最多打印几条药品 */
const MAX_DRUGS_PRINT = 6;
/** Typst 字符串转义：反斜杠、引号、内容块方括号、引用符 @ */
const esc$1 = (s) => esc$2(s).replace(/\[/g, "\\[").replace(/\]/g, "\\]").replace(/(^|[^\w])@/g, "$1\\@");
/** 数值：两位小数去掉无意义尾零（51.64 → 51.64，1.00 → 1） */
const num = (v, d = 2) => {
	return (Math.round((Number(v) || 0) * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d).replace(/\.?0+$/, "") || "0";
};
/**
* Typst 文本排版 helper：按绝对坐标摆一行文字，超宽自动等比缩字号。
* 注意：参数名不能用 body / text / size（会遮蔽 Typst 内置），缩放比例要先算成无量纲数。
*/
const T_HELPER = [
	"// T(x, y, size, s, weight, align, maxw, track)：绝对坐标排版一行文字",
	"#let T(x, y, size, s, weight: \"regular\", align: \"left\", maxw: 0pt, track: 0pt, minSize: 0pt) = context {",
	"  let mk(z) = text(size: z, weight: weight, tracking: track, s)",
	"  let t0 = mk(size)",
	"  let w0 = measure(t0).width",
	"  let ratio = float(maxw / w0)",
	"  let floor = if minSize > 0pt { minSize } else { 6pt }",
	"  let sc = if maxw > 0pt and ratio < 1 { calc.max(size * ratio, floor) } else { size }",
	"  let t = if sc == size { t0 } else { mk(sc) }",
	"  let w = if sc == size { w0 } else { measure(t).width }",
	"  let dx = if align == \"center\" { x - w / 2 } else if align == \"right\" { x - w } else { x }",
	"  place(dx: dx, dy: y, t)",
	"}"
].join("\n");
/** 生成一条排版指令（空文本直接跳过） */
function t(r) {
	if (!r.text) return "";
	const a = [
		num(r.x, 1) + "pt",
		num(r.y, 1) + "pt",
		num(r.size, 1) + "pt",
		"\"" + esc$1(r.text) + "\""
	];
	if (r.weight) a.push("weight: \"" + r.weight + "\"");
	if (r.track) a.push("track: " + num(r.track, 1) + "pt");
	if (r.align && r.align !== "left") a.push("align: \"" + r.align + "\"");
	if (r.maxw) a.push("maxw: " + num(r.maxw, 1) + "pt");
	if (r.minSize) a.push("minSize: " + num(r.minSize, 1) + "pt");
	return "#T(" + a.join(", ") + ")";
}
/**
* 药品拆成两行文本（与照片一致）：
*   第 1 行：②布地奈德鼻喷雾剂（雷诺考特）
*   第 2 行：（120喷 64UG/喷雾）（51.64元）   超限原因:慢性病患者
*/
function drugLines(d) {
	const brand = d.brand ? "（" + d.brand + "）" : "";
	const name = (d.prefix || "") + d.name + brand;
	const parts = [];
	if (d.spec) parts.push("（" + d.spec + "）");
	if (d.price) parts.push("（" + money$1(Number(d.price)) + "元）");
	const note = d.note ? "   " + d.note : "";
	const usage = !d.freq && !d.dose && !d.route && d.usage ? "   " + d.usage : "";
	return {
		name,
		spec: parts.join("") + note + usage
	};
}
/** 默认三条须知（照片原文），表单里填了提示就优先用表单的 */
const TIPS_REF = [
	"此处方有效期为三天（含当日）。为了您与其他患者的用药安全，药品发出后不予退换",
	"(2)注意合理用药，多科就诊可能造成重复用药",
	"(3)如有任何用药问题请拨打临床药师咨询电话：82264130"
];
/** 默认选项：提示默认关闭（空值时用样张原文） */
const OPTIONS_REF = {
	showTips: false,
	tips: [],
	showBarcode: true,
	showPrintDate: true,
	showSerial: true,
	showFeeLine: true,
	showFeeMark: true,
	showSign: true,
	showUsage: false,
	showMoney: false
};
function buildBj3(doc) {
	const L = [];
	const push = (...xs) => xs.forEach((s) => {
		if (s) L.push(s);
	});
	/** 排版一行文字（= t() 的别名，便于阅读） */
	const mk = t;
	L.push(preamble(PAGE_W$1, PAGE_H$1, {
		margin: "0pt",
		baseSize: 10
	}));
	L.push(BARCODE_HELPER);
	L.push(T_HELPER);
	L.push("");
	const bcText = doc.extra.medicalId || doc.cardNo;
	const idNo = doc.extra.caseNo && doc.extra.caseNo.trim() ? bcText + "_" + doc.extra.caseNo.trim() : bcText;
	const drugs = doc.drugs.slice(0, MAX_DRUGS_PRINT);
	const amount = doc.extra.amount && doc.extra.amount.trim() ? doc.extra.amount.trim() : money$1(total(doc));
	const tipList = (doc.options.tips.filter((s) => s.trim()).length ? doc.options.tips : TIPS_REF).map((s) => s.replace("82264130", doc.extra.phone || "82264130")).slice(0, 3);
	if (bcText) {
		const bc = barcodeBlock(bcText, Y$1.barcodeW, Y$1.barcodeH).split("\n").join("\n  ");
		L.push("#place(dx: " + num(X_L, 1) + "pt, dy: " + num(Y$1.barcodeY, 1) + "pt)[\n  " + bc + "\n]");
	}
	push(mk({
		x: X_L,
		y: Y$1.barcodeText,
		size: S.tiny,
		text: idNo,
		maxw: 160
	}));
	push(mk({
		x: X_C,
		y: Y$1.head,
		size: S.title,
		text: doc.hospital + "处方",
		weight: "bold",
		align: "center",
		maxw: 340
	}));
	push(mk({
		x: 659.5,
		y: Y$1.head + 3.5,
		size: S.titleSub,
		text: "（" + (doc.docType || "医保") + "）",
		maxw: 70
	}));
	push(mk({
		x: 730.5,
		y: Y$1.head + 3,
		size: S.clinic,
		text: "门诊",
		align: "center",
		maxw: 70
	}));
	const rowY = (row) => Y$1.p1 + row * Y$1.pStep;
	const px = [
		P_X1,
		P_X2,
		P_X3
	];
	[
		[
			"ID号： " + bcText,
			"身份： " + doc.extra.idType,
			"社保号： " + doc.extra.ssn
		],
		[
			"姓名： " + doc.patientName,
			"性别： " + doc.gender,
			"定点医疗机构编码： " + doc.extra.orgCode
		],
		[
			"单位：" + (doc.extra.unitName ? " " + doc.extra.unitName : ""),
			"",
			"证件号："
		]
	].forEach((row, ri) => {
		row.forEach((txt, ci) => {
			push(mk({
				x: px[ci],
				y: rowY(ri),
				size: S.body,
				text: txt,
				maxw: 236.7
			}));
		});
	});
	push(mk({
		x: 112.8,
		y: rowY(1),
		size: S.body,
		text: "年龄：",
		maxw: 44
	}));
	push(mk({
		x: 156.8,
		y: rowY(1),
		size: S.body,
		text: doc.age ? doc.age + "岁" : "",
		maxw: 70
	}));
	push(mk({
		x: X_L,
		y: Y$1.dept,
		size: S.body,
		text: "就诊科室：   " + doc.dept,
		maxw: 296
	}));
	push(mk({
		x: D_NO,
		y: Y$1.dept,
		size: S.body,
		text: "就诊次：" + (doc.extra.visitNo || ""),
		maxw: 150
	}));
	push(mk({
		x: D_DATE,
		y: Y$1.dept,
		size: S.body,
		text: "就诊日期： " + (doc.extra.visitDate || doc.printDate),
		maxw: 230
	}));
	const DIAG_FLOOR = 7;
	const diagMaxEm = 797.7 / DIAG_FLOOR;
	const diagRaw = doc.diagnoses.filter(Boolean).join("；");
	const diag = (() => {
		if (tw("诊断： ") + tw(diagRaw) <= diagMaxEm) return diagRaw;
		let w = tw("诊断： ") + 1;
		let acc = "";
		for (const ch of diagRaw) {
			const cw = ch.charCodeAt(0) > 11904 ? 1 : .5;
			if (w + cw > diagMaxEm) break;
			w += cw;
			acc += ch;
		}
		return acc + (acc.length < diagRaw.length ? "…" : "");
	})();
	push(mk({
		x: X_L,
		y: Y$1.diag,
		size: S.body,
		text: diag ? "诊断： " + diag : " 诊断：",
		maxw: 797.7,
		minSize: DIAG_FLOOR
	}));
	push(ruleLine(X_L, Y$1.rule, X_R, Y$1.rule, .7));
	push(mk({
		x: X_L,
		y: Y$1.rp,
		size: S.rp,
		text: "RP",
		weight: "bold"
	}));
	push(mk({
		x: 42.4,
		y: Y$1.drugHead,
		size: S.drugHead,
		text: "药品名称/规格",
		maxw: 200
	}));
	push(mk({
		x: COLS.qty.x,
		y: Y$1.drugHead,
		size: S.drugHead,
		text: "数量",
		align: "center",
		maxw: COLS.qty.w
	}));
	push(mk({
		x: COLS.freq.x,
		y: Y$1.drugHead,
		size: S.drugHead,
		text: "频率",
		align: "center",
		maxw: COLS.freq.w
	}));
	push(mk({
		x: COLS.dose.x,
		y: Y$1.drugHead,
		size: S.drugHead,
		text: "用量",
		align: "center",
		maxw: COLS.dose.w
	}));
	push(mk({
		x: COLS.route.x,
		y: Y$1.drugHead,
		size: S.drugHead,
		text: "给药途径",
		align: "center",
		maxw: COLS.route.w
	}));
	drugs.forEach((d, i) => {
		const top = Y$1.drugTop + i * Y$1.drugRow;
		const dl = drugLines(d);
		push(mk({
			x: COLS.name.x,
			y: top + Y$1.offName,
			size: S.drugName,
			text: dl.name,
			maxw: COLS.name.w
		}));
		push(mk({
			x: COLS.spec.x,
			y: top + Y$1.offSpec,
			size: S.drugSpec,
			text: dl.spec,
			maxw: COLS.spec.w
		}));
		push(mk({
			x: COLS.qty.x,
			y: top + Y$1.offName,
			size: S.drugVal,
			text: d.qty ? num(d.qty) + (d.unit || "") : "",
			align: "center",
			maxw: COLS.qty.w
		}));
		push(mk({
			x: COLS.freq.x,
			y: top + Y$1.offName,
			size: S.drugVal,
			text: d.freq || "",
			align: "center",
			maxw: COLS.freq.w
		}));
		push(mk({
			x: COLS.dose.x,
			y: top + Y$1.offName,
			size: S.drugVal,
			text: d.dose || "",
			align: "center",
			maxw: COLS.dose.w
		}));
		push(mk({
			x: COLS.route.x,
			y: top + Y$1.offName,
			size: S.drugVal,
			text: d.route || "",
			align: "center",
			maxw: COLS.route.w
		}));
	});
	const drugEnd = Y$1.drugTop + drugs.length * Y$1.drugRow + 6;
	const shift = Math.max(0, Math.min(22, drugEnd - F$1.rule));
	const fy = (v) => v + shift;
	push(ruleLine(X_L, fy(F$1.rule), X_R, fy(F$1.rule), .7));
	push(mk({
		x: X_L,
		y: fy(F$1.base),
		size: S.foot,
		text: "审核：",
		maxw: 60
	}));
	push(mk({
		x: 376.4,
		y: fy(F$1.base + 6.7),
		size: S.foot,
		text: "发药：",
		maxw: 60
	}));
	tipList.forEach((s, i) => {
		push(mk({
			x: 52.8,
			y: fy(F$1.tips + i * F$1.tipsGap),
			size: S.tips,
			text: (i === 0 ? "提示：" : "") + s,
			maxw: 470,
			minSize: 9
		}));
	});
	push(mk({
		x: X_L,
		y: fy(F$1.fee),
		size: S.small,
		text: "费用类别：   ①公费  ②部分自费  ③自费 ⑦儿童 ⑧ 工伤  ⑨生育",
		maxw: 500
	}));
	push(mk({
		x: 56.8,
		y: fy(F$1.note),
		size: S.small,
		text: doc.extra.note || "",
		maxw: 300
	}));
	push(mk({
		x: F_MID,
		y: fy(F$1.base),
		size: S.foot,
		text: "取药药房： " + (doc.extra.pharmacy || ""),
		maxw: 224
	}));
	push(mk({
		x: F_RIGHT,
		y: fy(F$1.base),
		size: S.foot,
		text: "医师：",
		maxw: 60
	}));
	push(mk({
		x: X_R,
		y: fy(F$1.base + F$1.rowGap - 4),
		size: S.small,
		text: doc.doctor,
		track: 5,
		align: "right",
		maxw: 84
	}));
	push(mk({
		x: 600,
		y: fy(F$1.base + 2 * F$1.rowGap),
		size: S.small,
		text: "合计金额： " + amount + "元",
		maxw: 200
	}));
	push(mk({
		x: 600,
		y: fy(F$1.base + 3 * F$1.rowGap),
		size: S.small,
		text: "打印时间： " + (doc.extra.printTime || ""),
		maxw: 200
	}));
	L.push("");
	return L.join("\n");
}
const bj3 = {
	id: "bj3",
	name: "北京大学第三医院处方（医保）门诊",
	hospital: "北京大学第三医院",
	desc: "按参考样张复刻：左上条码 + ID号/病案号、姓名/身份/社保号、单位/性别/年龄/定点编码、就诊科室/就诊次/就诊日期、诊断；药品为五列表格（药品名称/规格 | 数量 | 频率 | 用量 | 给药途径），每条两行；页脚取药药房/医师/审核/发药 + 提示 + 费用类别 + 合计金额 + 打印时间",
	group: "门诊电子处方",
	page: {
		widthPt: PAGE_W$1,
		heightPt: PAGE_H$1
	},
	limits: {
		maxDiag: 6,
		maxDrugs: MAX_DRUGS_PRINT
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
			key: "medicalId",
			label: "ID号"
		},
		{
			key: "caseNo",
			label: "病案号"
		},
		{
			key: "idType",
			label: "身份"
		},
		{
			key: "ssn",
			label: "社保号"
		},
		{
			key: "orgCode",
			label: "定点医疗机构编码"
		},
		{
			key: "unitName",
			label: "单位"
		},
		{
			key: "visitNo",
			label: "就诊次"
		},
		{
			key: "visitDate",
			label: "就诊日期"
		},
		{
			key: "pharmacy",
			label: "取药药房"
		},
		{
			key: "amount",
			label: "合计金额"
		},
		{
			key: "printTime",
			label: "打印时间"
		},
		{
			key: "note",
			label: "页脚说明"
		}
	],
	defaults: {
		hospital: "北京大学第三医院",
		docType: "医保处方",
		patientName: "李娜",
		gender: "女",
		age: "31",
		dept: "北方院区耳鼻喉科门诊",
		diagnoses: [
			"咽喉炎",
			"鼻后滴漏",
			"鼻炎"
		],
		drugs: [
			{
				id: "b1",
				name: "布地奈德鼻喷雾剂",
				brand: "雷诺考特",
				spec: "120喷 64UG/喷雾",
				price: 51.64,
				qty: 1,
				usage: "",
				prefix: "②",
				unit: "支",
				freq: "二次/日",
				dose: "2喷/次",
				route: "喷鼻"
			},
			{
				id: "b2",
				name: "桉柠蒎肠溶胶囊",
				brand: "切诺",
				spec: "0.3g x18粒/盒",
				price: 23.77,
				qty: 3,
				usage: "",
				prefix: "②",
				unit: "盒",
				freq: "3次/日",
				dose: "0.3g/次",
				route: "口服<饭前>",
				note: "超限原因:慢性病患者"
			},
			{
				id: "b3",
				name: "氯雷他定片",
				brand: "开瑞坦片",
				spec: "10mg x6片/盒",
				price: 14.98,
				qty: 3,
				usage: "",
				prefix: "①",
				unit: "盒",
				freq: "1次/每晚",
				dose: "10mg/次",
				route: "口服",
				note: "超限原因:慢性病患者"
			},
			{
				id: "b4",
				name: "金噪散结胶囊",
				brand: "",
				spec: "0.4g x36粒/盒",
				price: 67.14,
				qty: 4,
				usage: "",
				prefix: "②",
				unit: "盒",
				freq: "二次/日",
				dose: "1.6g/次",
				route: "口服",
				note: "超限原因:慢性病患者"
			}
		],
		options: { ...OPTIONS_REF },
		doctor: "周文博",
		extra: {
			medicalId: "000000000000",
			caseNo: "",
			idType: "异地医保患者",
			ssn: "F00000000000",
			orgCode: "08110010",
			unitName: "",
			visitNo: "2",
			visitDate: "2026-05-29",
			pharmacy: "北方医院门诊药房",
			amount: "436.45",
			printTime: "2026-05-29 13:07:57",
			note: "此处方仅作报销用",
			qrText: "https://rx.puh3.net.cn/000000000000"
		}
	},
	build: buildBj3
};
//#endregion
//#region src/templates/bj6-impl.ts
/**
* Typst 单据生成器：把表单数据渲染成与样张同一版式的 .typ 源码。
* 所有坐标均为「原图像素」（1px = 0.5pt），来自样张的逐像素测量，
* 因此生成结果与 studio 的预览、导出 PDF 完全一致。
*
* 例外：左上角「扫码支付」二维码不是样张上的内容（样张此处为空白），
* 是按明确需求新增的版面元素，样式与坐标对齐 zz 模板左上角的同款二维码，
* 详见下面 QR 常量处的说明。
*/
/** 纸张边缘阴影的变暗比例（实测） */
const A_TOP = [
	.018,
	.018,
	.018,
	.018,
	.018,
	.018,
	.029,
	.055,
	.117,
	.178,
	.093,
	.018,
	.018,
	.018,
	.018
];
const A_RIGHT = [
	0,
	0,
	.053,
	.312,
	.399,
	.363,
	.296,
	.21,
	.141,
	.093,
	.06,
	.039,
	.028,
	.028,
	.028,
	.028,
	.028,
	.028,
	.028,
	.028,
	.028,
	.028
];
const A_LEFT = [...A_RIGHT].reverse();
const A_BOTTOM = [
	0,
	0,
	0,
	0,
	0,
	0,
	.033,
	.095,
	.036,
	.016,
	.016,
	.016,
	.016,
	.016
];
const F = {
	xl: 20,
	xr: 1657,
	yt: 17,
	yb: 925,
	ruleTopY: 262.09,
	ruleTopX0: 106,
	ruleTopX1: 1539,
	ruleMidY: 679.12,
	ruleMidX0: 363.7,
	ruleMidX1: 1537,
	ruleV1X: 363.7,
	ruleV1Y1: 873,
	ruleV2X: 616.46,
	bcX0: 134,
	bcX1: 317,
	bcY0: 331,
	bcY1: 393
};
/**
* ── 左上角「扫码支付」二维码【新增元素】 ─────────────────────────────
* 样张（origin_pic.png）此处是空白；按需求照搬 zz 模板（郑州市中心医院处方笺）
* 左上角那枚扫码支付二维码的样式与边距，填补 x∈[0,294pt]、y∈[0,131pt] 的空白区。
*
* zz 实测（渲染 out/tpl-zz.png 逐像素量得，1pt = 2px）：
*   二维码 66pt 见方；左边缘 42pt、上边缘 42.5pt（≈ 内容左边界 + 2pt）；
*   上方「扫码支付」9.5pt 小字，字墨迹下沿距二维码上边缘 2px（1pt），
*   字墨迹左沿在二维码左边缘右侧 15px（7.5pt）。
*
* bj6 对齐方式（坐标仍为原图像素，1px = 0.5pt）：
*   · 尺寸：132px = 66pt 见方 —— 与 zz 完全相同；
*   · 左边缘 106px = 53pt —— 与表格顶横线左端（F.ruleTopX0）即左栏内容左边界齐平，
*     对应 zz「二维码贴内容左边界」的对齐方式；
*   · 上边缘 92px = 46pt —— 与 zz 的 42.5pt 同量级，下方距表格顶横线（262.09px）还有 37~38px（约 18.5pt）；
*   · 「扫码支付」19px = 9.5pt（同 zz 的 BODY 字号），字盒顶 76px，
*     字墨迹下沿落在二维码上边缘上方 1px（zz 实测 2px），字左沿缩进二维码左边缘 14px（zz 15px）。
* 该区域上方是纸张边缘阴影（y ≤ 23px），右侧最近文字是居中标题（左沿 587px），均无重叠。
*/
const QR = {
	side: 132,
	x: 106,
	y: 92,
	label: "扫码支付",
	labelSize: 19,
	labelX: 119,
	labelY: 76
};
const n$1 = (v, d = 2) => {
	return v.toFixed(d).replace(/\.?0+$/, "") || "0";
};
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
const money = (v) => (Math.round(v * 100) / 100).toFixed(2);
const circled = (i) => i >= 1 && i <= 20 ? String.fromCharCode(9311 + i) : `(${i})`;
function buildTypst(doc) {
	const o = doc.options;
	const runs = [];
	const total = totalOf(doc.drugs);
	const add = (r) => runs.push(r);
	add({
		x: 718,
		y: 60.12,
		size: 54,
		text: doc.docType || "处方",
		anchor: "center",
		maxw: 700
	});
	add({
		x: 1541,
		y: 67.04,
		size: 31,
		text: doc.hospital,
		anchor: "right",
		maxw: 430
	});
	add({
		x: 699,
		y: 162.82,
		size: 25.5,
		text: "姓名："
	});
	add({
		x: 780.58,
		y: 162.91,
		size: 25.5,
		text: doc.patientName,
		maxw: 250
	});
	add({
		x: 1049.74,
		y: 163.2,
		size: 25.5,
		text: "性别："
	});
	add({
		x: 1128.63,
		y: 163.33,
		size: 25.5,
		text: doc.gender,
		maxw: 100
	});
	add({
		x: 699.03,
		y: 216.4,
		size: 25.5,
		text: "科别："
	});
	add({
		x: 780.53,
		y: 216.51,
		size: 25.5,
		text: doc.dept,
		maxw: 250
	});
	add({
		x: 1049.99,
		y: 216.78,
		size: 25.5,
		text: "年龄："
	});
	add({
		x: 1128.36,
		y: 216.68,
		size: 25.5,
		text: `${doc.age}岁`,
		maxw: 120
	});
	add({
		x: 231,
		y: 287.2,
		size: 25.5,
		text: doc.hospital,
		anchor: "center",
		maxw: 244
	});
	if (o.showCardNo) add({
		x: 227,
		y: 399.13,
		size: 27.26,
		text: doc.cardNo,
		font: ["Courier New"],
		anchor: "center",
		maxw: 180
	});
	if (o.showSerial) {
		add({
			x: 145.06,
			y: 435.69,
			size: 38.5,
			text: "序号："
		});
		add({
			x: 220,
			y: 482.4,
			size: 32.5,
			text: doc.serial,
			anchor: "center",
			maxw: 200
		});
	}
	add({
		x: 219.5,
		y: 524.38,
		size: 39.5,
		text: doc.dept,
		anchor: "center",
		maxw: 236
	});
	const validText = doc.validDays <= 1 ? "此处方当日有效" : `此处方${doc.validDays}日内有效`;
	const validShort = doc.validDays <= 1 ? "（当日有效）" : `（${doc.validDays}日内有效）`;
	add({
		x: 221,
		y: 575.45,
		size: 23.5,
		text: validText,
		anchor: "center",
		maxw: 236
	});
	add({
		x: 219,
		y: 605.48,
		size: 23.5,
		text: `（自${doc.printDate}）`,
		anchor: "center",
		maxw: 236
	});
	add({
		x: 218,
		y: 637.16,
		size: 23.5,
		text: validShort,
		anchor: "center",
		maxw: 236
	});
	add({
		x: 216,
		y: 674.91,
		size: 21.5,
		text: o.selfPayLabel,
		anchor: "center",
		track: 8.73,
		maxw: 200
	});
	if (o.showPrintDate) add({
		x: 150.4,
		y: 854.15,
		size: 19.5,
		text: `印刷日期：${doc.printDate}`,
		maxw: 208
	});
	add({
		x: 441.96,
		y: 285.82,
		size: 23.5,
		text: "诊断："
	});
	doc.diagnoses.slice(0, 8).forEach((d, i) => {
		add({
			x: 384.5,
			y: 340.62 + i * 29.3,
			size: 23.5,
			text: d,
			maxw: 226
		});
	});
	add({
		x: 385.73,
		y: 643.25,
		size: 23,
		text: "合计："
	});
	add({
		x: 455.86,
		y: 643.31,
		size: 21.5,
		text: money(total),
		font: ["Arial"],
		weight: "bold",
		maxw: 130
	});
	add({
		x: 642.86,
		y: 283.53,
		size: 26.5,
		text: "Rp",
		font: ["Arial"],
		weight: "bold"
	});
	add({
		x: 709.78,
		y: 285.37,
		size: 24.5,
		text: "药品名称/规格/单价"
	});
	doc.drugs.slice(0, 5).forEach((d, i) => {
		const y = 337.47 + i * 70.74;
		const brand = d.brand ? `(${d.brand})` : "";
		add({
			x: 651.81,
			y,
			size: 27,
			text: `${circled(i + 1)}${d.name}${brand}`,
			maxw: 880
		});
		let line2 = `(${d.spec}) ${money(d.price)}元`;
		if (o.showMoney && Number(d.qty) > 1) line2 += ` ×${d.qty} = ${money(d.price * d.qty)}元`;
		if (o.showUsage && d.usage) line2 += `  用法：${d.usage}`;
		add({
			x: 696.09,
			y: y + 35.37,
			size: 24.5,
			text: line2,
			maxw: 836
		});
	});
	add({
		x: 388.66,
		y: 699.93,
		size: 23.5,
		text: "审核/调配签名（签章）："
	});
	add({
		x: 954.2,
		y: 700.4,
		size: 23.5,
		text: "核对/发药签名（签章）："
	});
	if (o.showTips) {
		const xs = [
			386.56,
			676.03,
			934.54
		];
		const mw = [
			280,
			250,
			580
		];
		o.tips.slice(0, 3).forEach((t, i) => add({
			x: xs[i],
			y: 741.2,
			size: 23.5,
			text: t,
			maxw: mw[i]
		}));
	}
	if (o.showFeeLine) {
		add({
			x: 386.27,
			y: 781.97,
			size: 23.5,
			text: "费用类别："
		});
		const xs = [
			520.15,
			697.82,
			873.75
		];
		[
			"①(甲)无自付",
			"②(乙)有自付",
			"③(丙)全自付"
		].forEach((label, i) => {
			const key = [
				"甲",
				"乙",
				"丙"
			][i];
			add({
				x: xs[i],
				y: 781.85,
				size: 23.5,
				text: label,
				weight: o.showFeeMark && doc.feeKey === key ? "bold" : "regular"
			});
		});
	}
	add({
		x: 1089.15,
		y: 816.55,
		size: 23.5,
		text: "医师："
	});
	if (doc.doctor) add({
		x: 1168.88,
		y: 816.6,
		size: 22.5,
		text: doc.doctor,
		track: doc.doctor.length <= 2 ? 18 : 6,
		maxw: doc.doctor.length <= 2 ? 200 : 220
	});
	if (o.showSign) add({
		x: 1160,
		y: 853.8,
		size: 23.5,
		text: "（签章）",
		anchor: "center"
	});
	let bars = [];
	if (o.showBarcode && doc.cardNo.trim()) bars = barsToRects(encodeCode128(doc.cardNo), F.bcX0, F.bcX1 - F.bcX0);
	const qrText = String(doc.extra?.qrText ?? "").trim() || String(doc.cardNo ?? "").trim();
	const qr = qrText ? qrBlock(qrText, QR.side / 2) : `#box(width: ${QR.side / 2}pt, height: ${QR.side / 2}pt, stroke: 0.4pt)`;
	const L = [];
	L.push(`// ============================================================
//  ${doc.hospital} · ${doc.docType}
//  由「Prescription Master」按选定的医院/诊断/药品/医师等数据生成
//  页面 836pt × 470.5pt（1 原图像素 = 0.5pt），纯矢量输出
//  字体：中文 SimSun（宋体）；Rp、合计金额为 Arial Bold；条码数字为 Courier New
// ============================================================
`);
	L.push("#set page(width: 836pt, height: 470.5pt, margin: 0pt, fill: white)");
	L.push("#set text(font: \"SimSun\", lang: \"zh\", fill: black)");
	L.push("");
	L.push("#let px = 0.5pt");
	L.push("");
	L.push("// x, y：排版原点（原图像素）；size：字号（原图像素 = em 高度）");
	L.push("// T=左对齐起笔点；TC=以 x 为水平中心；TR=以 x 为右端（用 measure 精确对齐）");
	L.push("#let G(x, y, size, body, font: \"SimSun\", weight: \"regular\", tracking: 0, mode: \"l\", maxw: 0) = context {");
	L.push("  let mk(s) = text(font: font, size: s * px, weight: weight, tracking: tracking * px, body)");
	L.push("  let t0 = mk(size)");
	L.push("  let w0 = measure(t0).width");
	L.push("  let s = if maxw > 0 and w0 > maxw * px { size * maxw * px / w0 } else { size }");
	L.push("  let t = if s == size { t0 } else { mk(s) }");
	L.push("  let w = if s == size { w0 } else { measure(t).width }");
	L.push("  let dx = if mode == \"c\" { x * px - w / 2 } else if mode == \"r\" { x * px - w } else { x * px }");
	L.push("  place(dx: dx, dy: y * px, t)");
	L.push("}");
	L.push("#let T(x, y, size, body, font: \"SimSun\", weight: \"regular\", tracking: 0, maxw: 0) = G(x, y, size, body, font: font, weight: weight, tracking: tracking, mode: \"l\", maxw: maxw)");
	L.push("#let TC(x, y, size, body, font: \"SimSun\", weight: \"regular\", tracking: 0, maxw: 0) = G(x, y, size, body, font: font, weight: weight, tracking: tracking, mode: \"c\", maxw: maxw)");
	L.push("#let TR(x, y, size, body, font: \"SimSun\", weight: \"regular\", tracking: 0, maxw: 0) = G(x, y, size, body, font: font, weight: weight, tracking: tracking, mode: \"r\", maxw: maxw)");
	L.push("");
	L.push("#let tint(x0, y0, x1, y1, a) = place(dx: x0 * px, dy: y0 * px,");
	L.push("  rect(width: (x1 - x0) * px, height: (y1 - y0) * px, fill: rgb(0, 0, 0, a * 100%)))");
	L.push("");
	L.push("#let edgeH(x0, x1, y, A) = place(dx: x0 * px, dy: y * px,");
	L.push("  rect(width: (x1 - x0) * px, height: A.len() * px,");
	L.push("    fill: gradient.linear(angle: 90deg,");
	L.push("      ..A.enumerate().map(((i, a)) => (rgb(0, 0, 0, a * 100%), i / A.len() * 100%)),");
	L.push("      (rgb(0, 0, 0, A.last() * 100%), 100%))))");
	L.push("");
	L.push("#let edgeV(y0, y1, x, A) = place(dx: x * px, dy: y0 * px,");
	L.push("  rect(width: A.len() * px, height: (y1 - y0) * px,");
	L.push("    fill: gradient.linear(angle: 0deg,");
	L.push("      ..A.enumerate().map(((i, a)) => (rgb(0, 0, 0, a * 100%), i / A.len() * 100%)),");
	L.push("      (rgb(0, 0, 0, A.last() * 100%), 100%))))");
	L.push("");
	L.push("#let hline(x0, x1, y, w) = place(dx: x0 * px, dy: y * px,");
	L.push("  line(start: (0pt, 0pt), end: ((x1 - x0) * px, 0pt), stroke: w * px))");
	L.push("#let vline(x, y0, y1, w) = place(dx: x * px, dy: y0 * px,");
	L.push("  line(start: (0pt, 0pt), end: (0pt, (y1 - y0) * px), stroke: w * px))");
	L.push("");
	if (qrText) {
		L.push("// 二维码：把 bool 矩阵画成方块阵（与 zz 模板共用 kit.QR_HELPER） ──");
		L.push(QR_HELPER);
		L.push("");
	}
	L.push("// ── 纸张边缘阴影（四边闭合细线框，电子模拟） ─────────────");
	L.push(`#tint(0, 0, ${F.xr}, ${F.yt}, 0.018)`);
	L.push(`#tint(${F.xr}, 0, 1672, 941, 0.028)`);
	L.push(`#tint(0, ${F.yt}, ${F.xl}, ${F.yb}, 0.018)`);
	L.push(`#tint(0, ${F.yb}, ${F.xr}, 941, 0.016)`);
	L.push(`#let A_TOP = (${A_TOP.map((v) => v.toFixed(3)).join(", ")})`);
	L.push(`#let A_RIGHT = (${A_RIGHT.map((v) => v.toFixed(3)).join(", ")})`);
	L.push(`#let A_LEFT = (${A_LEFT.map((v) => v.toFixed(3)).join(", ")})`);
	L.push(`#let A_BOTTOM = (${A_BOTTOM.map((v) => v.toFixed(3)).join(", ")})`);
	L.push(`#edgeV(${F.yt}, ${F.yb}, 3, A_LEFT)`);
	L.push(`#edgeV(${F.yt}, ${F.yb}, 1653, A_RIGHT)`);
	L.push(`#edgeH(${F.xl}, ${F.xr}, 8, A_TOP)`);
	L.push(`#edgeH(${F.xl}, ${F.xr}, 918, A_BOTTOM)`);
	L.push("");
	L.push("// ── 表格线 ───────────────────────────────────────────────");
	L.push("#let LW = 2.0   // 1pt");
	L.push(`#hline(${F.ruleTopX0}, ${F.ruleTopX1}, ${F.ruleTopY}, LW)`);
	L.push(`#hline(${F.ruleMidX0}, ${F.ruleMidX1}, ${F.ruleMidY}, LW)`);
	L.push(`#vline(${F.ruleV1X}, ${F.ruleTopY}, ${F.ruleV1Y1}, LW)`);
	L.push(`#vline(${F.ruleV2X}, ${F.ruleTopY}, ${F.ruleMidY}, LW)`);
	L.push("");
	L.push("// ── 左上角「扫码支付」二维码（新增元素，样张此处为空白） ─────────");
	L.push(`// 内容：${qrText ? esc(qrText).replace(/\s+/g, " ") : "（qrText 与病历号均为空，仅画空框）"}`);
	L.push(`#place(dx: ${n$1(QR.x)} * px, dy: ${n$1(QR.y)} * px)[${qr}]`);
	L.push("");
	if (bars.length) {
		L.push(`// ── 条码（Code 128，${bars.length} 根条，由卡号 ${esc(doc.cardNo)} 生成） ──`);
		L.push(`#let BARS = (${bars.map(([a, b]) => `(${n$1(a)}, ${n$1(b)})`).join(", ")})`);
		L.push("#for (a, b) in BARS {");
		L.push(`  place(dx: a * px, dy: ${F.bcY0} * px,`);
		L.push(`    polygon(fill: black, (0pt, 0pt), ((b - a) * px, 0pt), ((b - a) * px, ${F.bcY1 - F.bcY0} * px), (0pt, ${F.bcY1 - F.bcY0} * px)))`);
		L.push("}");
		L.push("");
	}
	L.push("// ── 文字 ─────────────────────────────────────────────────");
	for (const r of runs) {
		if (!r.text) continue;
		const fn = r.anchor === "center" ? "TC" : r.anchor === "right" ? "TR" : "T";
		const args = [`${n$1(r.x)}, ${n$1(r.y)}, ${n$1(r.size, 2)}, "${esc(r.text)}"`];
		const opt = [];
		if (r.font) opt.push(`font: (${r.font.map((f) => `"${f}"`).join(", ")})`);
		if (r.weight && r.weight !== "regular") opt.push(`weight: "${r.weight}"`);
		if (r.track) opt.push(`tracking: ${n$1(r.track, 2)}`);
		if (r.maxw) opt.push(`maxw: ${n$1(r.maxw, 1)}`);
		L.push(`#${fn}(${args.join(", ")}${opt.length ? ", " + opt.join(", ") : ""})`);
	}
	L.push("");
	return L.join("\n");
}
//#endregion
//#region src/templates/bj6.ts
/** 复刻样张：原 origin_pic.png 的版式（绝对定位 + 纸张边缘阴影框） */
const bj6 = {
	id: "bj6",
	name: "北京大学第六医院 · 非医保处方",
	hospital: "北京大学第六医院",
	desc: "按原扫描样张逐像素复刻：四格表格线 + 纸张边缘闭合阴影框，版面固定 836×470.5pt；左上角新增扫码支付二维码",
	group: "复刻样张",
	page: {
		widthPt: 836,
		heightPt: 470.5
	},
	limits: {
		maxDiag: 8,
		maxDrugs: 5
	},
	sections: {
		patient: true,
		identity: true,
		visit: false,
		diagnosis: true,
		drugs: true,
		drugTable: false,
		tcm: false,
		footer: true
	},
	extraKeys: [{
		key: "qrText",
		label: "二维码内容（扫码支付）"
	}],
	build: buildTypst
};
//#endregion
//#region src/templates/cq.ts
/**
* 重庆市九龙坡区中医院 处方笺（中药）
*
* 版面按 refs/cq_chongqing.png 逐项复刻（页宽 559pt，与照片 1:1.42 的纸张比例一致）：
*   ① 左上「支付宝/微信」竖排小字 + 真实二维码，其下「发药药房：…」；
*   ② 中上两行居中标题（院名 / 处 方 笺）；右上 NO·普通·条码·条码号·取药联；
*   ③ 患者行（姓名 · 性别 · 年龄 · 门诊号）、科室行（科室 · 医疗类别 · 床号 · 日期）；
*   ④ 费别行、证型诊断行——每行下方一条通栏分隔线；
*   ⑤ Rx 下方**三栏药味宫格**（药名 + 克数，列优先排布；24 味 = 8 行 × 3 栏）；
*   ⑥「（该处方结束，以下内容为空白）」+ 留白；剂数/煎服说明、嘱托、医师 / 药品金额、
*      审核调配 / 核对发药、药事管理规定两行页脚。
*
* 可变内容自适应：药味按 n 自动分栏（列优先）、诊断 1~8 行顺延并下移宫格、
* 宫格行距/字号随行数收缩、超宽文本按生成期实测宽度缩字号，均不溢出、不串栏。
*/
/**
* 印刷日期的紧凑形态：2026-10-11 → 20261011。
* 模板里「编号内嵌年月日」的字段（如取药联条码号 20231023108 的前 8 位）统一用它派生，
* 使编号里的日期跟随 doc.printDate；表单里印刷日期是普通文本框，5 月 7 日可能写成 2026-5-7，
* 故按年/月/日分别补零，拆不出三段时退回「取有效数字的前 8 位」（已是 20261011 这类紧凑写法）。
*/
const ymd$1 = (d) => {
	const p = String(d || "").split(/\D+/).filter(Boolean);
	return p.length >= 3 ? p[0].padStart(4, "0") + p[1].padStart(2, "0") + p[2].padStart(2, "0") : String(d || "").replace(/\D/g, "").slice(0, 8);
};
/** 页宽 */
const W$1 = 559;
/** 页高 */
const H$1 = 794;
/** 左边距（照片里正文左起点 ≈ 19pt；与照片逐像素对齐后取值） */
const ML = 19;
/** 版心右界（分隔线 / 页脚止于此，照片里右侧留白更大） */
const MR = 521;
/** 版心宽 */
const CW = 502;
/** 药味宫格三栏列起点（列距 191.5pt，与照片三栏等距一致） */
const COL_X = [
	19,
	210.5,
	402
];
/** 单栏可用宽度（列距 - 栏间留白） */
const COL_W = 189;
/** 宫格起始 y 的下限（诊断多行时顺延） */
const GRID_TOP_MIN = 238;
/** 宫格下沿（保证 8 行 × 31pt 行距） */
const GRID_BOTTOM = 487;
/** 正文字号（照片里药味 / 各字段同一字号 ≈ 15pt） */
const BASE = 15;
/** 药名与克数之间的间距（em） */
const NAME_GAP = .7;
/** 顶部通栏分隔线 y（发药药房行与患者行之间） */
const RULE_TOP = 96;
/** 页脚：药事管理规定 */
const FOOT1 = "根据卫生部《医疗机构药事管理规定》除药品质量原因外，药品一经发出，不得退换";
const FOOT2 = "处方三日有效（急诊处方除外）";
const n2 = (v) => String(Math.round(v * 100) / 100);
/** 绝对定位一块内容：页边距为 0，top+left 即页面左上角 */
const pin = (x, y, body) => `#place(top + left, dx: ${n2(x)}pt, dy: ${n2(y)}pt)[${body}]`;
/** 通栏分隔线 */
const rule = (y, x1 = ML, x2 = MR, w = .6) => pin(x1, y, `#line(length: ${n2(x2 - x1)}pt, stroke: ${w}pt)`);
/** 左对齐文本 */
const at = (x, y, s, size = BASE, weight) => pin(x, y, `#text(size: ${n2(size)}pt${weight ? `, weight: "${weight}"` : ""})[${esc$2(s)}]`);
/** 右对齐文本 */
const atRight = (xr, y, s, size = BASE, weight) => at(xr - tw(s) * size, y, s, size, weight);
/** 居中文本 */
const atCenter = (xc, y, s, size = BASE, weight) => at(xc - tw(s) * size / 2, y, s, size, weight);
/** 把 s 压进 maxW 宽所需字号（不低于 7pt） */
const fit$1 = (s, maxW, size) => Math.max(7, Math.min(size, maxW / Math.max(tw(s), .01)));
/** 一味药的用量文本：30.0g（照片统一一位小数 + g；无 tcm 的成药退化为数量+单位） */
const doseOf = (d) => {
	const tcm = Number(d.tcm);
	if (Number.isFinite(tcm) && tcm > 0) return `${tcm.toFixed(1)}${d.unit || "g"}`;
	const qty = d.qty === void 0 || d.qty === null ? "" : String(d.qty);
	return qty ? `${qty}${d.unit || ""}` : "";
};
const cq = {
	id: "cq",
	name: "重庆市九龙坡区中医院处方笺（中药）",
	hospital: "重庆市九龙坡区中医院",
	desc: "中药处方：左上二维码与发药药房、Rx 下方三栏药味宫格（名称+克数）、剂数与煎服说明、嘱托、药品金额与药事规定页脚",
	group: "中药处方",
	page: {
		widthPt: W$1,
		heightPt: H$1
	},
	limits: {
		maxDiag: 8,
		maxDrugs: 60
	},
	sections: {
		patient: true,
		identity: true,
		visit: true,
		diagnosis: true,
		drugs: true,
		drugTable: true,
		tcm: true,
		footer: true
	},
	extraKeys: [
		{
			key: "pharmacy",
			label: "发药药房"
		},
		{
			key: "rxNo",
			label: "NO / 处方号"
		},
		{
			key: "visitNo",
			label: "门诊号"
		},
		{
			key: "medicalId",
			label: "取药联条码号"
		},
		{
			key: "visitDate",
			label: "日期"
		},
		{
			key: "feeCategory",
			label: "费别"
		},
		{
			key: "note",
			label: "剂数与煎服说明"
		},
		{
			key: "amount",
			label: "药品金额"
		},
		{
			key: "qrText",
			label: "二维码内容"
		}
	],
	defaults: {
		hospital: "重庆市九龙坡区中医院",
		docType: "普通",
		patientName: "王强",
		gender: "女",
		age: "26",
		dept: "中医内科一诊室",
		diagnoses: ["腰痛(肾气虚证)"],
		drugs: [
			{
				id: "c1",
				name: "熟地黄",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 30,
				unit: "g"
			},
			{
				id: "c2",
				name: "牡丹皮",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 3,
				unit: "g"
			},
			{
				id: "c3",
				name: "白芍",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 8,
				unit: "g"
			},
			{
				id: "c4",
				name: "木香",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 12,
				unit: "g"
			},
			{
				id: "c5",
				name: "盐补骨脂",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 30,
				unit: "g"
			},
			{
				id: "c6",
				name: "甘草",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 6,
				unit: "g"
			},
			{
				id: "c7",
				name: "盐杜仲",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 15,
				unit: "g"
			},
			{
				id: "c8",
				name: "生姜",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 12,
				unit: "g"
			},
			{
				id: "c9",
				name: "茯苓",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 15,
				unit: "g"
			},
			{
				id: "c10",
				name: "山药",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 12,
				unit: "g"
			},
			{
				id: "c11",
				name: "党参",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 12,
				unit: "g"
			},
			{
				id: "c12",
				name: "醋香附",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 15,
				unit: "g"
			},
			{
				id: "c13",
				name: "桂枝",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 10,
				unit: "g"
			},
			{
				id: "c14",
				name: "北柴胡",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 5,
				unit: "g"
			},
			{
				id: "c15",
				name: "续断",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 15,
				unit: "g"
			},
			{
				id: "c16",
				name: "盐菟丝子",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 24,
				unit: "g"
			},
			{
				id: "c17",
				name: "盐泽泻",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 12,
				unit: "g"
			},
			{
				id: "c18",
				name: "当归",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 5,
				unit: "g"
			},
			{
				id: "c19",
				name: "白术",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 5,
				unit: "g"
			},
			{
				id: "c20",
				name: "乌药",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 15,
				unit: "g"
			},
			{
				id: "c21",
				name: "大枣",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 12,
				unit: "g"
			},
			{
				id: "c22",
				name: "黄芪",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 24,
				unit: "g"
			},
			{
				id: "c23",
				name: "山萸肉",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 12,
				unit: "g"
			},
			{
				id: "c24",
				name: "炒火麻仁",
				brand: "",
				spec: "",
				price: 0,
				qty: 1,
				usage: "",
				tcm: 15,
				unit: "g"
			}
		],
		doctor: "郑安国",
		extra: {
			pharmacy: "煎煮中心药房",
			rxNo: "0000000",
			visitNo: "",
			medicalId: "",
			visitDate: "2026年07月25日",
			feeCategory: "",
			note: "6剂，每天一剂，水煎(煎药机)至600ml，分3次口服（中药），单次剂量200ml",
			amount: "134.65",
			qrText: ""
		}
	},
	build: (doc) => {
		const ex = doc.extra;
		const amount = ex.amount?.trim() ? ex.amount.trim() : money$1(totalOf(doc.drugs));
		const derivedNo = ymd$1(doc.printDate) + "108";
		const visitNo = (ex.visitNo || "").trim() || derivedNo;
		/** 取药联条码号（条码 + 条码号文本 + 二维码内容）：手填优先，未填时与门诊号同值（样张两者就是同一个号） */
		const bcText = (ex.medicalId || "").trim() || visitNo;
		const head = [
			preamble(W$1, H$1, {
				margin: "0pt",
				baseSize: 10
			}),
			"#set text(cjk-latin-spacing: none)",
			BARCODE_HELPER,
			QR_HELPER,
			""
		];
		const out = [];
		out.push(pin(34, 11, qrBlock(ex.qrText || "https://pay.cqjlpzyy.com/" + (bcText || ""), 66)));
		const vert = [
			"支",
			"付",
			"宝",
			"/",
			"微",
			"信"
		].map((c) => `text(size: 8.5pt)[${c}]`).join(", ");
		out.push(pin(22, 14, `#stack(dir: ttb, spacing: 0.3pt, ${vert})`));
		out.push(at(ML, 78, `发药药房：${ex.pharmacy || ""}`));
		out.push(atCenter(253, 12, doc.hospital || "重庆市九龙坡区中医院", 18.5, "bold"));
		const t2Size = 18.5;
		const t2Gap = .45;
		out.push(pin(253 - 72.15 / 2, 35, `#text(size: ${n2(t2Size)}pt)[处#h(${t2Gap}em)方#h(${t2Gap}em)笺]`));
		if (ex.rxNo) out.push(atRight(463, 18, `NO: ${ex.rxNo}`, 13.5));
		out.push(atCenter(434, 32.5, doc.docType || "普通", 13));
		if (bcText) {
			out.push(`#let __bc = (${encodeCode128(bcText).widths.join(", ")})`);
			out.push(pin(360, 46.5, "#barcode(__bc, 168pt, 12pt)"));
			out.push(atCenter(444.6, 62.5, bcText, 20));
			out.push(atRight(508, 81, "取药联", 14));
		}
		out.push(rule(RULE_TOP));
		out.push(at(ML, 104, `姓名：${doc.patientName || ""}`, fit$1(`姓名：${doc.patientName || ""}`, 132.5, BASE)));
		out.push(at(162, 104, `性别：${doc.gender || ""}`));
		out.push(at(265, 104, doc.age ? `年龄：${doc.age}岁` : "年龄："));
		const visitNoLine = `门诊号:${visitNo}`;
		out.push(at(360, 104, visitNoLine, fit$1(visitNoLine, 135.5, BASE)));
		const deptLine = `科室：${doc.dept || ""}`;
		out.push(at(ML, 128, deptLine, fit$1(deptLine, 151, BASE)));
		out.push(at(174, 128, "医疗类别："));
		out.push(at(301, 128, "床号："));
		const dateLine = ex.visitDate || doc.printDate || "";
		out.push(at(390, 128, dateLine, fit$1(dateLine, 131, BASE)));
		out.push(rule(146));
		out.push(at(ML, 155, `费别：${ex.feeCategory || ""}`));
		out.push(rule(171));
		const diagList = doc.diagnoses.map((d) => (d || "").trim()).filter(Boolean);
		const shown = (diagList.length ? diagList : [""]).slice(0, 8);
		const dSize = shown.length > 3 ? 12.5 : BASE;
		const dLead = shown.length > 3 ? 14 : 16;
		const diagTop = 177;
		shown.forEach((d, i) => {
			const s = i === 0 ? `证型诊断：${d}` : d;
			const x = i === 0 ? ML : ML + 5 * dSize;
			out.push(at(x, diagTop + i * dLead, s, fit$1(s, MR - x, dSize)));
		});
		const ruleDiagY = diagTop + shown.length * dLead + 5;
		out.push(rule(ruleDiagY));
		const gridTop = Math.max(GRID_TOP_MIN, ruleDiagY + 10);
		out.push(pin(10, gridTop - 34, "#text(size: 26pt, weight: \"bold\", style: \"italic\", font: \"Times New Roman\")[R]"));
		const drugs = doc.drugs ?? [];
		const rows = Math.max(1, Math.ceil(drugs.length / COL_X.length));
		const pitch = Math.min(31, (GRID_BOTTOM - gridTop) / rows);
		const gridSize = Math.min(BASE, pitch * .48);
		drugs.forEach((d, i) => {
			const col = Math.floor(i / rows);
			if (col >= COL_X.length) return;
			const row = i % rows;
			const name = d.name || "";
			const dose = doseOf(d);
			const w0 = (tw(name) + (dose ? NAME_GAP + tw(dose) : 0)) * gridSize;
			const size = w0 > COL_W ? Math.max(7, gridSize * (COL_W / w0)) : gridSize;
			const body = dose ? `${esc$2(name)}#h(${NAME_GAP}em)${esc$2(dose)}` : esc$2(name);
			out.push(pin(COL_X[col], gridTop + row * pitch, `#text(size: ${n2(size)}pt)[${body}]`));
		});
		out.push(at(ML, 490, "（该处方结束，以下内容为空白）", 12));
		const usage = (ex.note || "").trim();
		if (usage) out.push(at(ML, 629, usage, fit$1(usage, CW, BASE)));
		out.push(at(ML, 668, "嘱托："));
		out.push(rule(685));
		out.push(at(ML, 695, `医师：${doc.doctor || ""}`));
		out.push(at(324, 695, "药品金额", 17));
		out.push(atRight(464, 695, amount, fit$1(amount, 54, 17)));
		out.push(rule(713));
		out.push(at(ML, 721, "审核、调配："));
		out.push(at(326, 721, "核对、发药："));
		out.push(rule(741));
		out.push(at(ML, 752, FOOT1, fit$1(FOOT1, CW, 13)));
		out.push(at(ML, 771, FOOT2, fit$1(FOOT2, CW, 13)));
		return [
			...head,
			...out,
			""
		].join("\n");
	}
};
//#endregion
//#region src/templates/zy.ts
/**
* 遵义医科大学第五附属（珠海）医院 / 珠海市第六人民医院 门诊处方笺
*
* 版面按 refs/zy_zunyi.png 复刻，全部栏位用**绝对坐标（pt）**定位：
*   ① 顶栏：左=Code128 条码 + 病历号；中=院徽 + 中英文院名 4 行；右=「普通」方框
*   ② 费别：门诊自付（左） / 「处方笺」居中大标题 / 医师：____（标题下方）
*   ③ 患者信息 4 行，「标签 + 下划线填空」结构：
*      姓名·体重·性别·年龄 ／ 门诊住院病历号·科别 ／ 电话地址·开具日期 ／ 临床诊断
*   ④ 分隔实线 ⑤ Rp
*   ⑥ 每味药**两行**：第 1 行「序号 药名(规格) … 数量」，第 2 行为独立缩进行
*      「用法： 剂量　途径　频次×天数」（剂量/途径/频次为四味药对齐的固定列）
*   ⑦ 「以下空白」 ⑧ 页脚：取药说明 + 二维码 + 处方序号 + 医师/金额/药师签名 + 温馨提示
*
* 坐标来源：对 refs/zy_zunyi.png 做墨迹行列扫描后按 3.08px/pt 换算；正文 9.5pt、
* 药名行 10.5pt、Rp 19pt、条码号 16pt，与照片上的字号层级一致。
*/
const W = 419.5;
const H = 595.3;
/** 内容左右边界（参考照片量得 约 13pt / 406.5pt） */
const L$1 = 13;
/** 参考单据固定的温馨提示（版面容条纹样，不随数据变化） */
const TIPS = "温馨提示：1、依《医疗机构药事管理规定》第二十八条“为保证患者用药安全，除药品质量原因外，药品一经发出，不得退换”；2、本处方当天有效；3、取药时请仔细核对清单，点齐药品；";
/** 换行符（避免源码里出现裸转义） */
const LF = String.fromCharCode(10);
/** 缺省取药说明（参考照片上的两行） */
const NOTE_DEFAULT = "1.中/西药房位置：门诊一楼医保窗口旁；\n2.先缴费后取药。关注药房窗口上方显示屏，到对应窗口排队取药。";
const pt = (v) => String(Math.round(v * 100) / 100);
/** 内容模式转义：先做字符串转义，再转义 Typst 标记字符 */
const cx = (s) => esc$2(String(s ?? "")).replace(/([#$\[\]*_])/g, "\\$1");
/** 生成期按可用宽度自动缩字号（em 估算），保证长名字/长规格不溢出、不串栏 */
function fit(text, size, maxW) {
	const em = tw(text);
	if (em <= 0) return size;
	const want = maxW / em;
	if (want >= size) return size;
	return Math.max(3.4, Math.round(want * 100) / 100);
}
/** 绝对定位文本（place 的 dy 即字面墨迹顶端，已用标尺实测校准） */
const T = (x, y, s, body) => `#place(dx: ${pt(x)}pt, dy: ${pt(y)}pt, text(size: ${pt(s)}pt)[${body}])`;
const TB = (x, y, s, body) => `#place(dx: ${pt(x)}pt, dy: ${pt(y)}pt, text(size: ${pt(s)}pt, weight: "bold")[${body}])`;
/** 定宽居中 / 右对齐文本 */
const TC = (x, y, w, s, body) => `#place(dx: ${pt(x)}pt, dy: ${pt(y)}pt, box(width: ${pt(w)}pt, align(center, text(size: ${pt(s)}pt)[${body}])))`;
const TR = (x, y, w, s, body) => `#place(dx: ${pt(x)}pt, dy: ${pt(y)}pt, box(width: ${pt(w)}pt, align(right, text(size: ${pt(s)}pt)[${body}])))`;
/** 绝对坐标直线（填空白下划线 / 栏间分隔线） */
const LN = (x, y, w, t = .6) => `#place(dx: ${pt(x)}pt, dy: ${pt(y)}pt, line(length: ${pt(w)}pt, stroke: ${t}pt))`;
/** 「标签 + 填空白」一栏：标签 / 值（自动缩字号）/ 下划线 */
function fill(o) {
	const size = fit(o.value, o.vs, o.vw);
	const out = [T(o.lx, o.ly, o.ls, o.label)];
	if (o.value) out.push(T(o.vx, o.vy, size, cx(o.value)));
	out.push(LN(o.ux, o.uy, o.uw, .6));
	return out;
}
const zy = {
	id: "zy",
	name: "遵义医科大学第五附属（珠海）医院处方笺",
	hospital: "遵义医科大学第五附属（珠海）医院",
	desc: "门诊处方笺：条码+病历号在左上、中英文院名带院徽、右上普通方框、每味药两行（用法含剂量/途径/频次×天数）、页脚取药说明与药师签名",
	group: "门诊电子处方",
	page: {
		widthPt: W,
		heightPt: H
	},
	limits: {
		maxDiag: 6,
		maxDrugs: 6
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
			key: "feeCategory",
			label: "费别"
		},
		{
			key: "weight",
			label: "体重(kg)"
		},
		{
			key: "medicalId",
			label: "门诊/住院病历号"
		},
		{
			key: "phone",
			label: "电话/地址"
		},
		{
			key: "visitDate",
			label: "开具日期"
		},
		{
			key: "rxNo",
			label: "处方序号"
		},
		{
			key: "amount",
			label: "药品金额"
		},
		{
			key: "note",
			label: "页脚说明(两行)"
		},
		{
			key: "qrText",
			label: "二维码内容"
		}
	],
	defaults: {
		hospital: "遵义医科大学第五附属（珠海）医院",
		docType: "普通",
		patientName: "赵敏",
		gender: "男",
		age: "34",
		dept: "口腔科门诊",
		diagnoses: ["18、48阻生牙"],
		drugs: [
			{
				id: "z1",
				name: "双氯芬酸钠缓释胶囊(Ⅰ)",
				brand: "",
				spec: "0.1g*20粒/盒",
				price: 0,
				qty: 1,
				usage: "",
				prefix: "",
				unit: "盒",
				freq: "必要时",
				dose: "0.1000g",
				route: "口服",
				days: "1"
			},
			{
				id: "z2",
				name: "头孢克肟胶囊",
				brand: "",
				spec: "0.1g*20粒/盒",
				price: 0,
				qty: 1,
				usage: "",
				prefix: "(国采)",
				unit: "盒",
				freq: "每日二次",
				dose: "0.1000g",
				route: "口服",
				days: "1"
			},
			{
				id: "z3",
				name: "甲硝唑片",
				brand: "",
				spec: "0.2g*100片/盒",
				price: 6,
				qty: 6,
				usage: "",
				prefix: "(集采)",
				unit: "片",
				freq: "每日二次",
				dose: "0.2000g",
				route: "口服",
				days: "3"
			},
			{
				id: "z4",
				name: "西帕依固龈液",
				brand: "",
				spec: "30ml/瓶",
				price: 0,
				qty: 1,
				usage: "",
				prefix: "",
				unit: "瓶",
				freq: "每日二次",
				dose: "3.0000ml",
				route: "含漱",
				days: "1"
			}
		],
		doctor: "林浩然",
		extra: {
			feeCategory: "门诊自付",
			weight: "",
			medicalId: "0000000000",
			phone: "",
			visitDate: "2026年05月30日",
			rxNo: "00000000",
			amount: "",
			note: NOTE_DEFAULT,
			qrText: "https://fifth.zmu.edu.cn/pay/00000000"
		}
	},
	build: (doc) => {
		const ex = doc.extra;
		const out = [];
		out.push(preamble(W, H, {
			margin: "0pt",
			baseSize: 9.5
		}));
		out.push("#set text(cjk-latin-spacing: none)");
		out.push(BARCODE_HELPER);
		out.push(QR_HELPER);
		out.push("");
		const bcText = ex.medicalId || doc.cardNo || "";
		const amount = ex.amount?.trim() ? ex.amount.trim() : money$1(totalOf(doc.drugs));
		const bcW = 113;
		if (bcText) {
			const bc = barcodeBlock(bcText, bcW, 18).replace(/#/g, "");
			out.push(`#place(dx: ${pt(L$1)}pt, dy: 12pt, box(width: ${pt(bcW)}pt, { ${bc} }))`);
			out.push(TC(L$1, 33, bcW, fit(bcText, 16, 111), cx(bcText)));
		}
		out.push("#place(dx: 139.1pt, dy: 34.8pt, circle(radius: 15.5pt, stroke: 0.8pt))");
		out.push("#place(dx: 144.1pt, dy: 39.8pt, circle(radius: 10.5pt, stroke: 0.45pt))");
		out.push("#place(dx: 151.6pt, dy: 42.4pt, rect(width: 6pt, height: 16pt, fill: black))");
		out.push("#place(dx: 146.6pt, dy: 47.4pt, rect(width: 16pt, height: 6pt, fill: black))");
		const hx = 187;
		out.push(TB(hx, 39, 8, cx(doc.hospital)));
		out.push(T(hx, 52, 4.1, "THE FIFTH AFFILIATED HOSPITAL OF ZUNYI MEDICAL UNIVERSITY(ZHUHAI)"));
		out.push(TB(hx, 60.5, 8.5, "珠海市第六人民医院"));
		out.push(T(hx, 72, 4.2, "ZHUHAI SIXTH PEOPLE'S HOSPITAL"));
		out.push(`#place(dx: ${pt(336)}pt, dy: 57.5pt, box(width: ${pt(70.5)}pt, height: 21pt, stroke: 0.7pt, align(center + horizon, text(size: 11pt)[${cx(doc.docType || "普通")}])))`);
		out.push(T(13.5, 89.5, 9.5, `费别： ${cx(ex.feeCategory)}`));
		out.push(`#place(dx: 178pt, dy: 84pt, box(width: 82pt, align(center, text(size: 13.5pt, weight: "bold")[处方笺])))`);
		out.push(T(197, 111, 9.5, "医师："));
		out.push(LN(L$1, 123, 393.5, .7));
		out.push(...fill({
			lx: 14,
			ly: 127,
			ls: 10,
			label: "姓名",
			vx: 52,
			vy: 127.5,
			vs: 10,
			value: doc.patientName,
			vw: 64,
			ux: 45,
			uy: 143,
			uw: 75
		}));
		out.push(...fill({
			lx: 147.4,
			ly: 127.5,
			ls: 9.5,
			label: "体重：",
			vx: 176,
			vy: 128.5,
			vs: 9.5,
			value: ex.weight,
			vw: 18,
			ux: 174,
			uy: 143,
			uw: 22
		}));
		out.push(T(198, 127.5, 9.5, "kg"));
		out.push(...fill({
			lx: 240.3,
			ly: 127.5,
			ls: 9.5,
			label: "性别",
			vx: 268,
			vy: 128.5,
			vs: 9.5,
			value: doc.gender,
			vw: 26,
			ux: 254,
			uy: 143,
			uw: 22
		}));
		out.push(...fill({
			lx: 319.6,
			ly: 127.5,
			ls: 9.5,
			label: "年龄：",
			vx: 351,
			vy: 128.5,
			vs: 9.5,
			value: doc.age,
			vw: 20,
			ux: 349,
			uy: 143,
			uw: 26
		}));
		out.push(...fill({
			lx: 15,
			ly: 158,
			ls: 9.5,
			label: "门诊/住院病历号：",
			vx: 108,
			vy: 159,
			vs: 9.5,
			value: bcText,
			vw: 112,
			ux: 105,
			uy: 173.5,
			uw: 119
		}));
		out.push(...fill({
			lx: 238.5,
			ly: 158,
			ls: 9.5,
			label: "科别(病区/床位号)：",
			vx: 331,
			vy: 159,
			vs: 9.5,
			value: doc.dept,
			vw: 74,
			ux: 329.5,
			uy: 173.5,
			uw: 77
		}));
		out.push(...fill({
			lx: 18.2,
			ly: 188.5,
			ls: 9.5,
			label: "电话/地址：",
			vx: 144,
			vy: 189.5,
			vs: 9.5,
			value: ex.phone,
			vw: 50,
			ux: 141.6,
			uy: 204,
			uw: 53
		}));
		out.push(...fill({
			lx: 238.5,
			ly: 188.5,
			ls: 9.5,
			label: "开具日期：",
			vx: 288,
			vy: 189.5,
			vs: 9.5,
			value: ex.visitDate || doc.printDate,
			vw: 100,
			ux: 286,
			uy: 204,
			uw: 110
		}));
		const diagRaw = doc.diagnoses.filter(Boolean).join("；");
		const DIAG_MAX_EM = 330 / 4.5;
		const diag = (() => {
			if (tw(diagRaw) <= DIAG_MAX_EM) return diagRaw;
			let w = 0;
			let acc = "";
			for (const ch of diagRaw) {
				const cw = ch.charCodeAt(0) > 11904 ? 1 : .5;
				if (w + cw > 72.33333333333333) break;
				w += cw;
				acc += ch;
			}
			return acc + "…";
		})();
		out.push(...fill({
			lx: 20.1,
			ly: 219,
			ls: 9.5,
			label: "临床诊断：",
			vx: 74,
			vy: 220,
			vs: 9.5,
			value: diag,
			vw: 330,
			ux: 73,
			uy: 234.5,
			uw: 333.5
		}));
		out.push(LN(L$1, 247.5, 393.5, .7));
		out.push(TB(15.3, 253, 19, "Rp"));
		const drugs = doc.drugs;
		const drugTop = 274;
		const BASE_FS = 11.8;
		const BASE_GAP = 14.6;
		const BASE_PITCH = 27.7;
		const budget = 171;
		const need = drugs.length > 1 ? (drugs.length - 1) * BASE_PITCH + BASE_GAP + BASE_FS : BASE_FS;
		const k = Math.min(1, budget / need);
		const fs = BASE_FS * k;
		const lineGap = BASE_GAP * k;
		const pitch = BASE_PITCH * k;
		drugs.forEach((d, i) => {
			const y1 = drugTop + i * pitch;
			const y2 = y1 + lineGap;
			const name = `${d.prefix ?? ""}${d.name}${d.brand ? `(${d.brand})` : ""}`;
			const spec = d.spec ? `(${d.spec})` : "";
			const qty = `${trim(d.qty)}${d.unit || ""}`;
			out.push(TR(22, y1, 12, fs, String(i + 1)));
			const QTY_X = 260;
			const qtySize = fit(qty, fs, 44);
			const layout = (nameLimit) => {
				const nSize = fit(name, fs, nameLimit);
				const nW = tw(name) * nSize;
				const sX = 40 + nW + 5;
				const sSize = spec ? fit(spec, fs, Math.max(24, 254 - sX)) : 0;
				return {
					nSize,
					nW,
					sX,
					sSize,
					sW: spec ? tw(spec) * sSize : 0
				};
			};
			let L1 = layout(150);
			if (L1.sX + L1.sW > 254 && spec) L1 = layout(Math.max(60, 150 - (L1.sX + L1.sW - 254) - 5));
			if (name) out.push(T(40, y1, L1.nSize, cx(name)));
			if (spec) out.push(T(L1.sX, y1, L1.sSize, cx(spec)));
			if (qty) out.push(T(QTY_X, y1, qtySize, cx(qty)));
			out.push(T(54.2, y2, fs, "用法："));
			const raw = d.usage?.trim();
			if (raw) out.push(T(93.5, y2, fit(raw, fs, 205), cx(raw)));
			else {
				const dose = d.dose || "";
				const route = d.route || "";
				const freq = `${d.freq || ""}${d.days ? `×${trim(d.days)}天` : ""}`;
				if (dose) out.push(T(93.5, y2, fit(dose, fs, 48), cx(dose)));
				if (route) out.push(T(143.5, y2, fit(route, fs, 34), cx(route)));
				if (freq) out.push(T(179.5, y2, fit(freq, fs, 120), cx(freq)));
			}
		});
		const lastY = drugs.length ? drugTop + (drugs.length - 1) * pitch + lineGap : drugTop;
		const tailY = Math.min(lastY + 16.5, 452);
		out.push(LN(149, tailY - 4.5, 101, .6));
		out.push(T(178, tailY, 10.5, "以下空白"));
		const rawNote = ex.note?.trim() ? ex.note : NOTE_DEFAULT;
		let notices = rawNote.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean);
		if (notices.length < 2) {
			const m = rawNote.match(/^(.*?)\s*(?=2[.、])/);
			notices = m ? [m[1].trim(), rawNote.slice(m[1].length).trim()] : [rawNote];
		}
		notices.slice(0, 2).forEach((t, i) => out.push(T(22, 466 + i * 11.5, fit(t, 9.5, 280), cx(t))));
		out.push(`#place(dx: 308pt, dy: 434pt, ${qrBlock(ex.qrText || "", 48).replace(/^#/, "")})`);
		for (const [vx, vtext] of [[361, "自费患者"], [375.5, "请扫码支付"]]) for (let i = 0; i < vtext.length; i++) out.push(T(vx, 436 + i * 12, 10, vtext[i]));
		out.push(T(187.3, 488, 9.5, "处方序号："));
		out.push(T(235, 488, fit(ex.rxNo, 9.5, 40), cx(ex.rxNo)));
		out.push(LN(186, 497, 62, .6));
		out.push(LN(L$1, 500, 393.5, .7));
		out.push(T(26.6, 503.5, 9.5, "医师："));
		out.push(T(57.5, 503.5, 10, cx(doc.doctor)));
		out.push(T(104.6, 503.5, 9.5, "药品金额："));
		out.push(T(154.5, 504, fit(amount, 9.5, 50), cx(amount)));
		out.push(LN(149, 513.5, 58, .6));
		out.push(T(26.6, 516.5, 9.5, "审核药师："));
		out.push(LN(88, 526.5, 60, .6));
		out.push(T(119, 516.5, 9.5, "调配药师："));
		out.push(LN(178, 526.5, 60, .6));
		out.push(T(228, 516.5, 9.5, "核对、发药师："));
		out.push(LN(296, 526.5, 110, .6));
		out.push(LN(L$1, 532, 393.5, .7));
		out.push(`#place(dx: ${pt(L$1)}pt, dy: 535pt, box(width: ${pt(393.5)}pt, text(size: 9.5pt)[${cx(TIPS)}]))`);
		return out.join(LF) + LF;
	}
};
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
	const amount = e.amount?.trim() || money$1(totalOf(doc.drugs));
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
			`"` + esc$2(r.text) + `"`
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
//#endregion
//#region src/templates/index.ts
/** 模板注册表：新增模板只需写一个文件并在这里登记一行 */
const TEMPLATES = [
	bj6,
	{
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
	},
	bj3,
	zy,
	cq
];
//#endregion
//#region scripts/long-diag.ts
const OUT = path.resolve("out");
const typst = path.resolve("resources", process.platform === "win32" ? "typst.exe" : "typst");
for (const id of ["bj3", "zy"]) {
	const t = TEMPLATES.find((x) => x.id === id);
	const d = t.defaults ?? {};
	const doc = {
		...defaultDoc(),
		...d,
		templateId: id,
		extra: {
			...emptyExtra(),
			...d.extra ?? {}
		}
	};
	doc.diagnoses = [
		"双相情感障碍，目前为轻度抑郁发作",
		"广泛性焦虑障碍",
		"强迫性障碍",
		"躯体形式障碍",
		"非器质性失眠症",
		"创伤后应激障碍"
	];
	const typ = path.join(OUT, "long-" + id + ".typ");
	fs.writeFileSync(typ, t.build(doc), "utf8");
	execFileSync(typst, [
		"compile",
		typ,
		path.join(OUT, "long-" + id + ".png"),
		"--ppi",
		"144"
	], { stdio: "pipe" });
	console.log("rendered", id);
}
//#endregion
