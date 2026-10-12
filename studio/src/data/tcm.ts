/**
 * 常用中药库：供"中药处方"模板（重庆市九龙坡区中医院处方笺·中药）的弹层选择器使用。
 *
 * 约定：
 * - name 采用《中国药典》（2020 年版一部）正名，不使用产地/炮制前缀（如"盐杜仲"记为别名）；
 * - dose 为单味药默认剂量（克），取整数或一位小数，仅作回填初值，用户可改；
 * - class 取值必须命中 TCM_CLASSES（两者严格一一对应，顺序即处方排列顺序）；
 * - note 仅用于确有特殊煎法要求的药味，取值限定为：先煎 / 后下 / 包煎 / 另煎 / 烊化 / 冲服；
 * - alias 用于搜索匹配（别名、常用写法、常见炮制品名），同一别名不得重复。
 */

export interface TcmHerb {
  name: string;
  dose: number;
  class: string;
  note?: string;
  alias?: string;
}

/** 分类名称（顺序 = 中药处方中的排列顺序） */
export const TCM_CLASSES: string[] = [
  "解表药",
  "清热药",
  "泻下药",
  "祛风湿药",
  "化湿药",
  "利水渗湿药",
  "温里药",
  "理气药",
  "消食药",
  "止血药",
  "活血化瘀药",
  "化痰止咳平喘药",
  "安神药",
  "平肝息风药",
  "补虚药",
  "收涩药",
];

/** 常用中药（按 TCM_CLASSES 归类、排列；同名药味只出现一次） */
export const TCM_HERBS: TcmHerb[] = [
  // ── 解表药 ────────────────────────────────────────────────────────────────
  { name: "麻黄", dose: 3, class: "解表药" },
  { name: "桂枝", dose: 10, class: "解表药" },
  { name: "紫苏叶", dose: 10, class: "解表药", alias: "苏叶" },
  { name: "生姜", dose: 10, class: "解表药" },
  { name: "荆芥", dose: 10, class: "解表药" },
  { name: "防风", dose: 10, class: "解表药" },
  { name: "羌活", dose: 10, class: "解表药" },
  { name: "白芷", dose: 10, class: "解表药" },
  { name: "细辛", dose: 3, class: "解表药" },
  { name: "辛夷", dose: 10, class: "解表药", note: "包煎", alias: "辛夷花" },
  { name: "薄荷", dose: 6, class: "解表药", note: "后下" },
  { name: "桑叶", dose: 10, class: "解表药", alias: "霜桑叶" },
  { name: "菊花", dose: 10, class: "解表药", alias: "杭菊" },
  { name: "柴胡", dose: 10, class: "解表药", alias: "北柴胡" },
  { name: "葛根", dose: 15, class: "解表药", alias: "粉葛" },

  // ── 清热药 ────────────────────────────────────────────────────────────────
  { name: "石膏", dose: 30, class: "清热药", note: "先煎" },
  { name: "知母", dose: 10, class: "清热药" },
  { name: "栀子", dose: 10, class: "清热药", alias: "山栀" },
  { name: "夏枯草", dose: 15, class: "清热药" },
  { name: "黄芩", dose: 10, class: "清热药" },
  { name: "黄连", dose: 5, class: "清热药" },
  { name: "黄柏", dose: 10, class: "清热药", alias: "盐黄柏" },
  { name: "金银花", dose: 15, class: "清热药", alias: "双花" },
  { name: "连翘", dose: 15, class: "清热药" },
  { name: "蒲公英", dose: 15, class: "清热药" },
  { name: "鱼腥草", dose: 15, class: "清热药", note: "后下" },
  { name: "生地黄", dose: 15, class: "清热药", alias: "生地" },
  { name: "玄参", dose: 15, class: "清热药", alias: "元参" },
  { name: "牡丹皮", dose: 10, class: "清热药", alias: "丹皮" },
  { name: "赤芍", dose: 10, class: "清热药" },

  // ── 泻下药 ────────────────────────────────────────────────────────────────
  { name: "大黄", dose: 10, class: "泻下药", note: "后下", alias: "生大黄" },
  { name: "芒硝", dose: 10, class: "泻下药", note: "冲服", alias: "玄明粉" },
  { name: "火麻仁", dose: 15, class: "泻下药", alias: "麻仁" },
  { name: "郁李仁", dose: 10, class: "泻下药" },

  // ── 祛风湿药 ──────────────────────────────────────────────────────────────
  { name: "独活", dose: 10, class: "祛风湿药" },
  { name: "威灵仙", dose: 10, class: "祛风湿药" },
  { name: "秦艽", dose: 10, class: "祛风湿药" },
  { name: "桑寄生", dose: 15, class: "祛风湿药", alias: "寄生" },
  { name: "木瓜", dose: 10, class: "祛风湿药", alias: "宣木瓜" },
  { name: "川乌", dose: 3, class: "祛风湿药", note: "先煎", alias: "制川乌" },

  // ── 化湿药 ────────────────────────────────────────────────────────────────
  { name: "藿香", dose: 10, class: "化湿药", alias: "广藿香" },
  { name: "佩兰", dose: 10, class: "化湿药" },
  { name: "苍术", dose: 10, class: "化湿药" },
  { name: "厚朴", dose: 10, class: "化湿药", alias: "川朴" },
  { name: "砂仁", dose: 6, class: "化湿药", note: "后下", alias: "阳春砂" },
  { name: "白豆蔻", dose: 6, class: "化湿药", note: "后下", alias: "豆蔻" },

  // ── 利水渗湿药 ────────────────────────────────────────────────────────────
  { name: "茯苓", dose: 15, class: "利水渗湿药", alias: "云苓" },
  { name: "泽泻", dose: 10, class: "利水渗湿药", alias: "盐泽泻" },
  { name: "薏苡仁", dose: 30, class: "利水渗湿药", alias: "薏米" },
  { name: "车前子", dose: 15, class: "利水渗湿药", note: "包煎" },
  { name: "滑石", dose: 15, class: "利水渗湿药", note: "包煎", alias: "飞滑石" },
  { name: "海金沙", dose: 15, class: "利水渗湿药", note: "包煎" },
  { name: "茵陈", dose: 15, class: "利水渗湿药", alias: "绵茵陈" },
  { name: "金钱草", dose: 30, class: "利水渗湿药", alias: "过路黄" },

  // ── 温里药 ────────────────────────────────────────────────────────────────
  { name: "附子", dose: 10, class: "温里药", note: "先煎", alias: "制附子" },
  { name: "干姜", dose: 10, class: "温里药" },
  { name: "肉桂", dose: 3, class: "温里药", note: "后下" },
  { name: "吴茱萸", dose: 5, class: "温里药" },
  { name: "小茴香", dose: 6, class: "温里药" },
  { name: "花椒", dose: 5, class: "温里药" },

  // ── 理气药 ────────────────────────────────────────────────────────────────
  { name: "陈皮", dose: 10, class: "理气药", alias: "橘皮" },
  { name: "枳实", dose: 10, class: "理气药" },
  { name: "枳壳", dose: 10, class: "理气药" },
  { name: "木香", dose: 10, class: "理气药", alias: "广木香" },
  { name: "香附", dose: 10, class: "理气药", alias: "醋香附" },
  { name: "乌药", dose: 10, class: "理气药" },
  { name: "川楝子", dose: 10, class: "理气药", alias: "金铃子" },
  { name: "薤白", dose: 10, class: "理气药" },

  // ── 消食药 ────────────────────────────────────────────────────────────────
  { name: "山楂", dose: 10, class: "消食药", alias: "焦山楂" },
  { name: "神曲", dose: 10, class: "消食药", alias: "六神曲" },
  { name: "麦芽", dose: 15, class: "消食药", alias: "炒麦芽" },
  { name: "鸡内金", dose: 10, class: "消食药", alias: "内金" },
  { name: "莱菔子", dose: 10, class: "消食药", alias: "萝卜子" },

  // ── 止血药 ────────────────────────────────────────────────────────────────
  { name: "三七", dose: 3, class: "止血药", note: "冲服", alias: "田七" },
  { name: "白及", dose: 10, class: "止血药", alias: "白芨" },
  { name: "仙鹤草", dose: 15, class: "止血药", alias: "龙芽草" },
  { name: "艾叶", dose: 10, class: "止血药" },
  { name: "小蓟", dose: 15, class: "止血药" },
  { name: "地榆", dose: 10, class: "止血药" },
  { name: "白茅根", dose: 15, class: "止血药", alias: "茅根" },
  { name: "蒲黄", dose: 10, class: "止血药", note: "包煎", alias: "炒蒲黄" },

  // ── 活血化瘀药 ────────────────────────────────────────────────────────────
  { name: "川芎", dose: 10, class: "活血化瘀药" },
  { name: "丹参", dose: 15, class: "活血化瘀药", alias: "紫丹参" },
  { name: "红花", dose: 6, class: "活血化瘀药" },
  { name: "桃仁", dose: 10, class: "活血化瘀药" },
  { name: "益母草", dose: 15, class: "活血化瘀药", alias: "坤草" },
  { name: "泽兰", dose: 10, class: "活血化瘀药" },
  { name: "牛膝", dose: 15, class: "活血化瘀药", alias: "怀牛膝" },
  { name: "延胡索", dose: 10, class: "活血化瘀药", alias: "元胡" },
  { name: "五灵脂", dose: 10, class: "活血化瘀药", note: "包煎" },
  { name: "鸡血藤", dose: 15, class: "活血化瘀药" },

  // ── 化痰止咳平喘药 ────────────────────────────────────────────────────────
  { name: "半夏", dose: 10, class: "化痰止咳平喘药", alias: "法半夏" },
  { name: "桔梗", dose: 10, class: "化痰止咳平喘药" },
  { name: "杏仁", dose: 10, class: "化痰止咳平喘药", alias: "苦杏仁" },
  { name: "紫苏子", dose: 10, class: "化痰止咳平喘药", alias: "苏子" },
  { name: "紫菀", dose: 10, class: "化痰止咳平喘药" },
  { name: "款冬花", dose: 10, class: "化痰止咳平喘药", alias: "冬花" },
  { name: "枇杷叶", dose: 15, class: "化痰止咳平喘药", note: "包煎" },
  { name: "桑白皮", dose: 15, class: "化痰止咳平喘药" },
  { name: "葶苈子", dose: 10, class: "化痰止咳平喘药", note: "包煎", alias: "甜葶苈" },
  { name: "浙贝母", dose: 10, class: "化痰止咳平喘药", alias: "象贝" },

  // ── 安神药 ────────────────────────────────────────────────────────────────
  { name: "酸枣仁", dose: 15, class: "安神药", alias: "枣仁" },
  { name: "柏子仁", dose: 10, class: "安神药" },
  { name: "远志", dose: 10, class: "安神药" },
  { name: "首乌藤", dose: 15, class: "安神药", alias: "夜交藤" },
  { name: "龙骨", dose: 15, class: "安神药", note: "先煎" },
  { name: "磁石", dose: 30, class: "安神药", note: "先煎", alias: "灵磁石" },

  // ── 平肝息风药 ────────────────────────────────────────────────────────────
  { name: "石决明", dose: 30, class: "平肝息风药", note: "先煎" },
  { name: "牡蛎", dose: 30, class: "平肝息风药", note: "先煎", alias: "生牡蛎" },
  { name: "天麻", dose: 10, class: "平肝息风药" },
  { name: "钩藤", dose: 15, class: "平肝息风药", note: "后下", alias: "双钩藤" },
  { name: "地龙", dose: 10, class: "平肝息风药", alias: "广地龙" },
  { name: "全蝎", dose: 5, class: "平肝息风药", alias: "全虫" },

  // ── 补虚药 ────────────────────────────────────────────────────────────────
  { name: "人参", dose: 6, class: "补虚药", note: "另煎", alias: "生晒参" },
  { name: "西洋参", dose: 6, class: "补虚药", note: "另煎", alias: "花旗参" },
  { name: "党参", dose: 15, class: "补虚药", alias: "潞党参" },
  { name: "黄芪", dose: 30, class: "补虚药", alias: "北芪" },
  { name: "白术", dose: 10, class: "补虚药", alias: "炒白术" },
  { name: "山药", dose: 15, class: "补虚药", alias: "怀山药" },
  { name: "甘草", dose: 6, class: "补虚药" },
  { name: "大枣", dose: 10, class: "补虚药" },
  { name: "淫羊藿", dose: 10, class: "补虚药", alias: "仙灵脾" },
  { name: "杜仲", dose: 15, class: "补虚药", alias: "盐杜仲" },
  { name: "续断", dose: 15, class: "补虚药" },
  { name: "菟丝子", dose: 15, class: "补虚药", alias: "盐菟丝子" },
  { name: "补骨脂", dose: 10, class: "补虚药", alias: "盐补骨脂" },
  { name: "肉苁蓉", dose: 15, class: "补虚药", alias: "淡苁蓉" },
  { name: "当归", dose: 10, class: "补虚药" },
  { name: "熟地黄", dose: 15, class: "补虚药", alias: "熟地" },
  { name: "白芍", dose: 10, class: "补虚药", alias: "炒白芍" },
  { name: "阿胶", dose: 10, class: "补虚药", note: "烊化" },
  { name: "麦冬", dose: 10, class: "补虚药", alias: "寸冬" },
  { name: "枸杞子", dose: 10, class: "补虚药", alias: "宁夏枸杞" },
  { name: "女贞子", dose: 10, class: "补虚药" },
  { name: "墨旱莲", dose: 10, class: "补虚药", alias: "旱莲草" },
  { name: "龟甲", dose: 15, class: "补虚药", note: "先煎", alias: "龟板" },
  { name: "鳖甲", dose: 15, class: "补虚药", note: "先煎", alias: "醋鳖甲" },

  // ── 收涩药 ────────────────────────────────────────────────────────────────
  { name: "五味子", dose: 6, class: "收涩药" },
  { name: "乌梅", dose: 10, class: "收涩药" },
  { name: "山茱萸", dose: 10, class: "收涩药", alias: "山萸肉" },
  { name: "金樱子", dose: 15, class: "收涩药" },
  { name: "桑螵蛸", dose: 10, class: "收涩药" },
  { name: "覆盆子", dose: 10, class: "收涩药" },
  { name: "益智仁", dose: 10, class: "收涩药", alias: "益智" },
  { name: "海螵蛸", dose: 10, class: "收涩药", alias: "乌贼骨" },
];

/** 正名 / 别名 → 药味 的检索索引（正名优先） */
const TCM_INDEX = new Map<string, TcmHerb>();
for (const herb of TCM_HERBS) {
  if (!TCM_INDEX.has(herb.name)) TCM_INDEX.set(herb.name, herb);
  if (herb.alias && !TCM_INDEX.has(herb.alias)) TCM_INDEX.set(herb.alias, herb);
}

/** 按正名或别名精确检索药味；未命中返回 undefined */
export function tcmByName(name: string): TcmHerb | undefined {
  const key = name.trim();
  return key ? TCM_INDEX.get(key) : undefined;
}
