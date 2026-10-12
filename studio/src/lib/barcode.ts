/**
 * Code 128 条码编码（纯前端实现，无依赖）。
 * 输出为「按模块数表示的条/空宽度」序列，首元素必为条（bar），
 * 调用方按目标宽度换算成像素即可直接画矩形。
 */

/** Code 128 的 107 个符号图形：每位数字表示一个条或空的模块数（条空相间） */
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104;
const START_C = 105;
const STOP = 106;

export interface BarcodeResult {
  /** 条空宽度（模块数），索引偶数为条、奇数为空 */
  widths: number[];
  modules: number;
  codeSet: "B" | "C";
  text: string;
}

/** 生成 Code 128 条码；纯数字且偶数长度时用 Code C（更短更宽），否则用 Code B */
export function encodeCode128(raw: string): BarcodeResult {
  const text = (raw || "").replace(/\s+/g, "");
  const useC = /^\d{2,}$/.test(text) && text.length % 2 === 0;
  const values: number[] = [];
  let codeSet: "B" | "C";
  if (useC) {
    codeSet = "C";
    values.push(START_C);
    for (let i = 0; i < text.length; i += 2) values.push(Number.parseInt(text.slice(i, i + 2), 10));
  } else {
    codeSet = "B";
    values.push(START_B);
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      // Code B 覆盖 ASCII 32..126
      values.push(code >= 32 && code <= 126 ? code - 32 : 0);
    }
  }
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += i * values[i];
  values.push(sum % 103);
  values.push(STOP);

  const widths: number[] = [];
  for (const v of values) {
    const pat = PATTERNS[v] ?? PATTERNS[0];
    for (const d of pat) widths.push(Number(d));
  }
  const modules = widths.reduce((a, b) => a + b, 0);
  return { widths, modules, codeSet, text };
}

/** 把条码展开成绝对像素坐标的条（x0,x1），落在 [left,left+width] 区间内 */
export function barsToRects(bc: BarcodeResult, left: number, width: number) {
  const unit = width / bc.modules;
  const rects: Array<[number, number]> = [];
  let x = left;
  for (let i = 0; i < bc.widths.length; i++) {
    const w = bc.widths[i] * unit;
    if (i % 2 === 0) rects.push([x, x + w]);
    x += w;
  }
  return rects;
}
