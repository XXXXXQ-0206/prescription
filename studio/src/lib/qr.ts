/**
 * 二维码编码器（真实实现，零第三方依赖）
 *
 * 契约（调用方 kit.ts 的 qrBlock 依赖它，不要改签名）：
 *   qrMatrix(text)  →  N×N 布尔矩阵（true = 黑块），编码不出来时返回 null。
 *
 * 另导出两个辅助函数，供交叉验证 / 排查使用（不影响上面的契约）：
 *   qrMatrixEx(text, { version, mask })  —— 可指定版本与掩码
 *   qrInfo(text, { version })            —— 版本 / 掩码 / 码字分块等元信息
 *
 * 实现范围：Byte（UTF-8）模式 + 纠错等级 M + 版本 1~10 自动选择 + 8 种掩码自动择优。
 * 实现依据 ISO/IEC 18004：数据编码 → 终止符 → 字节对齐 → 0xEC/0x11 填充
 * → GF(256)（本原多项式 0x11D）Reed-Solomon 纠错 → 数据/纠错交织
 * → 功能图形（定位、分隔、校正、时序、暗模块）→ 格式信息 / 版本信息 → 掩码。
 *
 * 失败（内容超出版本 10 容量、参数非法）一律返回 null，绝不返回"看起来像二维码"的假图案。
 */

/* ───────────────────────── 参数表：纠错等级 M，版本 1~10 ───────────────────────── */

/** 一个版本的 Reed-Solomon 分块方案 */
interface RSBlockPlan {
  /** 每个纠错块的纠错码字数 */
  ec: number;
  /** [块数, 每块的数据码字数]，可有 1~2 组 */
  groups: Array<[number, number]>;
}

/** 索引即版本号（索引 0 占位不用）。数据来自 ISO/IEC 18004 表 9（纠错等级 M）。 */
const RS_PLANS_M: readonly RSBlockPlan[] = [
  { ec: 0, groups: [] },
  { ec: 10, groups: [[1, 16]] },
  { ec: 16, groups: [[1, 28]] },
  { ec: 26, groups: [[1, 44]] },
  { ec: 18, groups: [[2, 32]] },
  { ec: 24, groups: [[2, 43]] },
  { ec: 16, groups: [[4, 27]] },
  { ec: 18, groups: [[4, 31]] },
  { ec: 22, groups: [[2, 38], [2, 39]] },
  { ec: 22, groups: [[3, 36], [2, 37]] },
  { ec: 26, groups: [[4, 43], [1, 44]] },
];

/** 校正图形中心坐标（索引即版本号，索引 0 占位不用） */
const ALIGN_CENTERS: readonly (readonly number[])[] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

/** Byte 模式指示符 0100 */
const MODE_BYTE = 0b0100;
/** 纠错等级 M 的 2 bit 指示符（L=01、M=00、Q=11、H=10） */
const ECC_M_BITS = 0b00;
const VERSION_MIN = 1;
const VERSION_MAX = 10;

/* ───────────────────────── GF(256)：本原多项式 0x11D ───────────────────────── */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

const GEN_POLY_CACHE = new Map<number, Uint8Array>();

/** 生成多项式 (x-α^0)(x-α^1)…(x-α^(ecLen-1))，系数按次数从高到低 */
function rsGeneratorPoly(ecLen: number): Uint8Array {
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
function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) rem[j] ^= gfMul(gen[j + 1], factor);
    }
  }
  return rem;
}

/* ───────────────────────── BCH：格式信息 / 版本信息 ───────────────────────── */

function bitLength(value: number): number {
  let n = 0;
  while (value !== 0) {
    value >>>= 1;
    n++;
  }
  return n;
}

const G15 = 0b10100110111; // 0x537
const G15_MASK = 0b101010000010010; // 0x5412
const G18 = 0b1111100100101; // 0x1F25

/** 15 bit 格式信息：5 bit 数据 + 10 bit BCH 校验，最后异或 0x5412 */
function bchFormatInfo(data5: number): number {
  let d = data5 << 10;
  while (bitLength(d) - bitLength(G15) >= 0) d ^= G15 << (bitLength(d) - bitLength(G15));
  return ((data5 << 10) | d) ^ G15_MASK;
}

/** 18 bit 版本信息：6 bit 版本号 + 12 bit BCH 校验（版本 ≥ 7 才有） */
function bchVersionInfo(version: number): number {
  let d = version << 12;
  while (bitLength(d) - bitLength(G18) >= 0) d ^= G18 << (bitLength(d) - bitLength(G18));
  return (version << 12) | d;
}

/* ───────────────────────── 掩码 ───────────────────────── */

/** 8 种掩码条件（row = 行，col = 列），依据 ISO/IEC 18004 表 10 */
function maskAt(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7:
      return (((row * col) % 3) + ((row + col) % 2)) % 2 === 0;
    default:
      return false;
  }
}

/* ───────────────────────── 矩阵构建 ───────────────────────── */

interface Skeleton {
  size: number;
  /** 模块颜色（1 = 黑） */
  modules: Uint8Array;
  /** 是否属于功能图形/保留区（这些格子不参与数据填充） */
  reserved: Uint8Array;
}

function createSkeleton(version: number): Skeleton {
  const n = version * 4 + 17;
  const modules = new Uint8Array(n * n);
  const reserved = new Uint8Array(n * n);

  const put = (row: number, col: number, dark: boolean) => {
    modules[row * n + col] = dark ? 1 : 0;
    reserved[row * n + col] = 1;
  };

  // 定位图形 + 分隔符（以 7×7 定位图形的左上角为基准，向外扩 1 圈即分隔符）
  const finder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const y = row + r;
        const x = col + c;
        if (y < 0 || y >= n || x < 0 || x >= n) continue;
        const dark =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        put(y, x, dark);
      }
    }
  };
  finder(0, 0);
  finder(n - 7, 0);
  finder(0, n - 7);

  // 校正图形（与定位图形重叠的中心会被占用，自动跳过）
  const centers = ALIGN_CENTERS[version];
  for (const row of centers) {
    for (const col of centers) {
      if (reserved[row * n + col]) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const dark = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
          put(row + r, col + c, dark);
        }
      }
    }
  }

  // 时序图形：第 6 行 / 第 6 列，深浅交替
  for (let i = 8; i <= n - 9; i++) {
    if (!reserved[6 * n + i]) put(6, i, i % 2 === 0);
    if (!reserved[i * n + 6]) put(i, 6, i % 2 === 0);
  }

  // 格式信息区（围绕左上定位图形 + 右上 / 左下各一份）
  for (let i = 0; i <= 8; i++) {
    if (!reserved[i * n + 8]) put(i, 8, false);
    if (!reserved[8 * n + i]) put(8, i, false);
  }
  for (let i = n - 8; i < n; i++) {
    if (!reserved[i * n + 8]) put(i, 8, false);
    if (!reserved[8 * n + i]) put(8, i, false);
  }

  // 版本信息区（版本 ≥ 7）：左上角外侧 3×6 与其转置
  if (version >= 7) {
    for (let r = 0; r < 6; r++) {
      for (let c = n - 11; c <= n - 9; c++) {
        put(r, c, false);
        put(c, r, false);
      }
    }
  }

  // 暗模块
  put(n - 8, 8, true);

  return { size: n, modules, reserved };
}

/** 把格式信息写入矩阵（不参与掩码） */
function placeFormatInfo(m: Uint8Array, n: number, mask: number): void {
  const bits = bchFormatInfo((ECC_M_BITS << 3) | mask);
  for (let i = 0; i < 15; i++) {
    const dark = ((bits >> i) & 1) === 1;
    // 左上竖向 + 左下竖向
    if (i < 6) m[i * n + 8] = dark ? 1 : 0;
    else if (i < 8) m[(i + 1) * n + 8] = dark ? 1 : 0;
    else m[(n - 15 + i) * n + 8] = dark ? 1 : 0;
    // 右上横向 + 左上横向
    if (i < 8) m[8 * n + (n - i - 1)] = dark ? 1 : 0;
    else if (i < 9) m[8 * n + (15 - i)] = dark ? 1 : 0;
    else m[8 * n + (14 - i)] = dark ? 1 : 0;
  }
  m[(n - 8) * n + 8] = 1; // 暗模块恒为黑
}

/** 把版本信息写入矩阵（版本 ≥ 7，不参与掩码） */
function placeVersionInfo(m: Uint8Array, n: number, version: number): void {
  const bits = bchVersionInfo(version);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >> i) & 1) === 1 ? 1 : 0;
    const r = Math.floor(i / 3);
    const c = n - 11 + (i % 3);
    m[r * n + c] = dark;
    m[c * n + r] = dark;
  }
}

/** 按标准之字形顺序填充数据并就地施加掩码 */
function placeData(skeleton: Skeleton, codewords: Uint8Array, mask: number): void {
  const { size: n, modules: m, reserved: fn } = skeleton;
  let row = n - 1;
  let inc = -1;
  let bitIndex = 7;
  let byteIndex = 0;

  for (let col = n - 1; col > 0; col -= 2) {
    // 跳过第 6 列（竖向时序图形）：该列左侧的列对整体左移一列
    const right = col <= 6 ? col - 1 : col;
    const pair = [right, right - 1];
    for (;;) {
      for (const c of pair) {
        const idx = row * n + c;
        if (fn[idx]) continue;
        let dark = 0;
        if (byteIndex < codewords.length) dark = (codewords[byteIndex] >> bitIndex) & 1;
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
function buildMatrix(version: number, codewords: Uint8Array, mask: number): Uint8Array {
  const skeleton = createSkeleton(version);
  placeData(skeleton, codewords, mask);
  placeFormatInfo(skeleton.modules, skeleton.size, mask);
  if (version >= 7) placeVersionInfo(skeleton.modules, skeleton.size, version);
  return skeleton.modules;
}

/* ───────────────────────── 掩码择优：ISO/IEC 18004 罚分规则 ───────────────────────── */

/**
 * 四条罚分规则（与参考实现 python-qrcode 的 util.lost_point 一致）：
 *   1. 行/列上连续同色 ≥5：每个连续段罚 (长度 - 2)；
 *   2. 2×2 同色块：每块罚 3；
 *   3. 出现 1:1:3:1:1 定位图形相似形态（10111010000 / 00001011101）：每次罚 40；
 *   4. 黑色模块比例偏离 50%：每偏离 5% 罚 10。
 */
function maskPenalty(m: Uint8Array, n: number): number {
  let penalty = 0;

  // 规则 1
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

  // 规则 2
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = m[r * n + c];
      if (v === m[r * n + c + 1] && v === m[(r + 1) * n + c] && v === m[(r + 1) * n + c + 1]) penalty += 3;
    }
  }

  // 规则 3（窗口长度为 11，两种形态互为镜像）
  const PAT_A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const PAT_B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (get: (k: number) => number, start: number): boolean => {
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
  for (let r = 0; r < n; r++) {
    for (let c = 0; c + 10 < n; c++) {
      if (matches((k) => m[r * n + k], c)) penalty += 40;
    }
  }
  for (let c = 0; c < n; c++) {
    for (let r = 0; r + 10 < n; r++) {
      if (matches((k) => m[k * n + c], r)) penalty += 40;
    }
  }

  // 规则 4（与参考实现相同的浮点运算顺序）
  let dark = 0;
  for (let i = 0; i < m.length; i++) dark += m[i];
  const percent = dark / (n * n);
  penalty += Math.trunc(Math.abs(percent * 100 - 50) / 5) * 10;

  return penalty;
}

/** 在 8 种掩码中选罚分最低者（同分取编号更小者） */
function chooseMask(version: number, codewords: Uint8Array): number {
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

/* ───────────────────────── 数据编码 ───────────────────────── */

function totalDataCodewords(plan: RSBlockPlan): number {
  let sum = 0;
  for (const [count, dataPerBlock] of plan.groups) sum += count * dataPerBlock;
  return sum;
}

/** Byte 模式位数：模式指示符 + 字符计数（版本 1~9 用 8 bit，10~26 用 16 bit） */
function requiredBits(byteLength: number, version: number): number {
  return 4 + (version < 10 ? 8 : 16) + byteLength * 8;
}

/** 选能装下内容的最小版本；超出版本 10 返回 null */
function pickVersion(byteLength: number): number | null {
  for (let v = VERSION_MIN; v <= VERSION_MAX; v++) {
    if (requiredBits(byteLength, v) <= totalDataCodewords(RS_PLANS_M[v]) * 8) return v;
  }
  return null;
}

function utf8Bytes(text: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text);
  // 兜底（极老环境）：手写 UTF-8 编码
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return Uint8Array.from(out);
}

/** 数据段 + 填充 + 纠错 + 交织，得到最终的码字序列 */
function buildCodewords(bytes: Uint8Array, version: number): Uint8Array {
  const plan = RS_PLANS_M[version];
  const dataCodewords = totalDataCodewords(plan);

  // 1) 模式指示符 + 字符计数 + 数据
  const bits: number[] = [];
  const put = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  put(MODE_BYTE, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (let i = 0; i < bytes.length; i++) put(bytes[i], 8);

  // 2) 终止符（最多 4 个 0）
  for (let i = 0; i < Math.min(4, dataCodewords * 8 - bits.length); i++) bits.push(0);
  // 3) 补齐到一个字节
  while (bits.length % 8 !== 0) bits.push(0);

  // 4) 0xEC / 0x11 交替填充
  const data = new Uint8Array(dataCodewords);
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    data[i / 8] = v;
  }
  for (let i = bits.length / 8, k = 0; i < dataCodewords; i++, k++) data[i] = k % 2 === 0 ? 0xec : 0x11;

  // 5) 分块 + Reed-Solomon
  const blocks: Array<{ data: Uint8Array; ec: Uint8Array }> = [];
  let offset = 0;
  for (const [count, dataPerBlock] of plan.groups) {
    for (let b = 0; b < count; b++) {
      const chunk = data.subarray(offset, offset + dataPerBlock);
      offset += dataPerBlock;
      blocks.push({ data: chunk, ec: rsEncode(chunk, plan.ec) });
    }
  }

  // 6) 交织：先数据码字（列优先），再纠错码字
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  const out = new Uint8Array(blocks.reduce((s, b) => s + b.data.length + b.ec.length, 0));
  let p = 0;
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.data.length) out[p++] = b.data[i];
  }
  for (let i = 0; i < plan.ec; i++) {
    for (const b of blocks) out[p++] = b.ec[i];
  }
  return out;
}

/* ───────────────────────── 对外接口 ───────────────────────── */

export interface QROptions {
  /** 指定版本（1~10）；不指定则自动选能装下内容的最小版本 */
  version?: number;
  /** 指定掩码（0~7）；不指定则按 ISO/IEC 18004 罚分规则自动择优 */
  mask?: number;
}

/** 交叉验证 / 排查用的元信息 */
export interface QRInfo {
  version: number;
  /** 矩阵边长 = 4 × version + 17 */
  size: number;
  mask: number;
  /** UTF-8 字节数 */
  byteLength: number;
  /** 数据码字总数 */
  dataCodewords: number;
  /** 每个纠错块的纠错码字数 */
  ecCodewordsPerBlock: number;
  /** 各数据块的数据码字数（块序） */
  blockDataCodewords: number[];
  /** 交织后码字总数（数据 + 纠错） */
  totalCodewords: number;
  /** 矩阵中可供数据使用的模块数（应为 totalCodewords×8 加上 0~7 个剩余位） */
  dataModules: number;
}

interface Encoded {
  version: number;
  mask: number;
  bytes: Uint8Array;
  codewords: Uint8Array;
}

function encode(text: string, options?: QROptions): Encoded | null {
  if (typeof text !== "string") return null;
  const bytes = utf8Bytes(text);

  let version: number;
  if (options && options.version !== undefined) {
    version = options.version;
    if (!Number.isInteger(version) || version < VERSION_MIN || version > VERSION_MAX) return null;
    if (requiredBits(bytes.length, version) > totalDataCodewords(RS_PLANS_M[version]) * 8) return null;
  } else {
    const picked = pickVersion(bytes.length);
    if (picked === null) return null;
    version = picked;
  }

  let mask: number;
  if (options && options.mask !== undefined) {
    mask = options.mask;
    if (!Number.isInteger(mask) || mask < 0 || mask > 7) return null;
  } else {
    mask = 0; // 占位，下面按码字择优
  }

  const codewords = buildCodewords(bytes, version);
  if (options?.mask === undefined) mask = chooseMask(version, codewords);
  return { version, mask, bytes, codewords };
}

function toRows(flat: Uint8Array, size: number): boolean[][] {
  const rows: boolean[][] = [];
  for (let r = 0; r < size; r++) {
    const row: boolean[] = new Array(size);
    for (let c = 0; c < size; c++) row[c] = flat[r * size + c] === 1;
    rows.push(row);
  }
  return rows;
}

/**
 * 生成二维码矩阵：N×N 布尔矩阵，true = 黑块；失败返回 null。
 * 默认：Byte（UTF-8）模式、纠错等级 M、版本 1~10 自动、8 种掩码自动择优。
 */
export function qrMatrix(text: string): boolean[][] | null {
  return qrMatrixEx(text);
}

/** 同 qrMatrix，但可指定版本 / 掩码（用于交叉验证与排查） */
export function qrMatrixEx(text: string, options?: QROptions): boolean[][] | null {
  try {
    const enc = encode(text, options);
    if (!enc) return null;
    const flat = buildMatrix(enc.version, enc.codewords, enc.mask);
    return toRows(flat, enc.version * 4 + 17);
  } catch {
    return null;
  }
}

/** 返回版本 / 掩码 / 码字分块等元信息；编码不出来返回 null */
export function qrInfo(text: string, options?: QROptions): QRInfo | null {
  try {
    const enc = encode(text, options);
    if (!enc) return null;
    const plan = RS_PLANS_M[enc.version];
    const size = enc.version * 4 + 17;
    const skeleton = createSkeleton(enc.version);
    let dataModules = 0;
    for (let i = 0; i < skeleton.reserved.length; i++) if (!skeleton.reserved[i]) dataModules++;
    const blockDataCodewords: number[] = [];
    for (const [count, dataPerBlock] of plan.groups) {
      for (let b = 0; b < count; b++) blockDataCodewords.push(dataPerBlock);
    }
    return {
      version: enc.version,
      size,
      mask: enc.mask,
      byteLength: enc.bytes.length,
      dataCodewords: totalDataCodewords(plan),
      ecCodewordsPerBlock: plan.ec,
      blockDataCodewords,
      totalCodewords: enc.codewords.length,
      dataModules,
    };
  } catch {
    return null;
  }
}
