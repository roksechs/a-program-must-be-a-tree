// Internationalisation: a small dictionary-based translator for the UI.
// Keys are stable identifiers; every language must define every key (the
// unit tests check that). Interpolation uses {name} placeholders.

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
];

const STRINGS = {
  en: {
    "app.title": "A program must be a tree",
    "app.source": "source",
    "app.loading": "loading…",
    "app.loadingDataset": "loading {name}…",
    "app.loadFailed": "failed to load {file}: {message}",
    "app.parseFailed": "could not parse {file}: {message}",
    "app.noDatasets": "no datasets found: open a JSON file from the panel",
    "app.status": "{nodes} declarations · {edges} edges",
    "app.dataInfo": "{label}: {nodes} declarations, {edges} edges, {files} files",
    "app.tooltip": "{name}  ({kind})  {location}  in {in} / out {out} / height {height}",
    "app.language": "Language",

    "section.data": "Data",
    "section.view": "View",
    "section.physics": "Physics",
    "section.zones": "Zones",
    "section.diagnostics": "Diagnostics: is it a tree?",
    "section.selection": "Selection",
    "section.legend": "Legend",

    "data.dataset": "Dataset",
    "data.openJson": "Open JSON",
    "data.localFile": "(local file)",

    "view.mode": "Mode",
    "view.labels": "Labels",
    "view.labels.auto": "auto",
    "view.labels.all": "all",
    "view.labels.none": "none",
    "view.colourBy": "Colour by",
    "view.colour.kind": "kind",
    "view.colour.height": "call height",
    "view.layerGap": "Layer gap (3D)",
    "view.layerPlanes": "Layer planes (3D)",
    "view.autoRotate": "Auto-rotate (3D)",
    "view.fit": "Fit to view",
    "view.help": "2D: drag nodes, wheel to zoom, drag background to pan. 3D: drag to orbit, shift+drag to pan, wheel to zoom. Click a node to inspect it.",

    "physics.reheat": "Recompute (reheat)",
    "physics.reset": "Reset positions",
    "physics.repulsion": "Repulsion (1/d)",
    "physics.stiffness": "Spring stiffness",
    "physics.restLength": "Spring rest length",
    "physics.gravity": "Gravity",
    "physics.help": "Repulsion between every pair of nodes is inversely proportional to their distance; every edge is a spring whose pull is proportional to its length. Directories and files never influence the layout. Use Recompute when the layout gets stuck in an early configuration.",

    "zones.depth": "Directory / file depth",
    "zones.help": "Depth 0 hides all zones; each step reveals one more level of directories, and the maximum also shows the files. Zones are convex hulls around the declarations they contain and have no effect on the physics.",

    "metric.treeScore": "Tree score",
    "metric.treeScore.hint": "Average of the four ratios below.",
    "metric.spanning": "Spanning ratio",
    "metric.spanning.hint": "(nodes - components) / edges. Exactly 1 for a forest; lower when declarations are reached by more than one path.",
    "metric.acyclicity": "Acyclicity",
    "metric.acyclicity.hint": "Share of declarations that are not part of any call cycle.",
    "metric.singleCaller": "Single caller",
    "metric.singleCaller.hint": "Share of declarations with at most one caller.",
    "metric.dagness": "DAG-ness",
    "metric.dagness.hint": "Share of edges that do not participate in a cycle.",
    "metric.declarations": "Declarations",
    "metric.edges": "Edges",
    "metric.components": "Components",
    "metric.components.hint": "Weakly connected components.",
    "metric.roots": "Roots",
    "metric.roots.hint": "Declarations nobody calls.",
    "metric.leaves": "Leaves",
    "metric.leaves.hint": "Declarations that call nothing.",
    "metric.maxHeight": "Max height",
    "metric.maxHeight.hint": "Longest call chain (layers in 3D).",
    "metric.surplus": "Surplus edges",
    "metric.surplus.hint": "Edges beyond what a forest would need.",
    "metric.cycles": "Cycles (SCCs)",
    "metric.cycles.hint": "Non-trivial strongly connected components.",
    "metric.selfLoops": "Self loops",
    "metric.selfLoops.hint": "Directly recursive declarations.",
    "metric.multiCallers": "Multi-caller nodes",
    "metric.multiCallers.hint": "Declarations called from more than one place.",
    "metric.dropped": "Dropped edges",
    "metric.dropped.hint": "Edges whose endpoints were not declared.",
    "metric.shared": "Most shared declarations",
    "metric.shared.none": "none: every declaration has at most one caller",
    "metric.shared.callers": "{count} callers",

    "selection.empty": "Click a node to see its callers and callees.",
    "selection.height": "height {height}",
    "selection.inCycle": "in a cycle",
    "selection.exported": "exported",
    "selection.callers": "Callers",
    "selection.callees": "Callees",
    "selection.none": "none",

    "kind.function": "function",
    "kind.method": "method",
    "kind.class": "class",
    "kind.variable": "variable",
    "kind.interface": "interface",
    "kind.type": "type",
    "kind.enum": "enum",
    "kind.module": "module",
    "kind.unknown": "unknown",
    "legend.inCycle": "in a cycle",

    "graph3d.height": "height {height}",
  },
  ja: {
    "app.title": "A program must be a tree",
    "app.source": "ソース",
    "app.loading": "読み込み中…",
    "app.loadingDataset": "{name} を読み込み中…",
    "app.loadFailed": "{file} の読み込みに失敗しました: {message}",
    "app.parseFailed": "{file} を解析できませんでした: {message}",
    "app.noDatasets": "データセットがありません。パネルから JSON ファイルを開いてください",
    "app.status": "宣言 {nodes} · エッジ {edges}",
    "app.dataInfo": "{label}: 宣言 {nodes}、エッジ {edges}、ファイル {files}",
    "app.tooltip": "{name}  ({kind})  {location}  入 {in} / 出 {out} / 高さ {height}",
    "app.language": "言語",

    "section.data": "データ",
    "section.view": "表示",
    "section.physics": "物理",
    "section.zones": "ゾーン",
    "section.diagnostics": "診断: 木になっているか",
    "section.selection": "選択",
    "section.legend": "凡例",

    "data.dataset": "データセット",
    "data.openJson": "JSON を開く",
    "data.localFile": "(ローカルファイル)",

    "view.mode": "モード",
    "view.labels": "ラベル",
    "view.labels.auto": "自動",
    "view.labels.all": "すべて",
    "view.labels.none": "なし",
    "view.colourBy": "色分け",
    "view.colour.kind": "種類",
    "view.colour.height": "呼び出し高さ",
    "view.layerGap": "層の間隔 (3D)",
    "view.layerPlanes": "層の平面 (3D)",
    "view.autoRotate": "自動回転 (3D)",
    "view.fit": "全体表示",
    "view.help": "2D: ノードをドラッグで移動、ホイールでズーム、背景ドラッグでパン。3D: ドラッグで回転、Shift+ドラッグでパン、ホイールでズーム。ノードをクリックすると詳細を表示します。",

    "physics.reheat": "再計算 (リヒート)",
    "physics.reset": "位置をリセット",
    "physics.repulsion": "斥力 (1/d)",
    "physics.stiffness": "ばね定数",
    "physics.restLength": "ばねの自然長",
    "physics.gravity": "重力",
    "physics.help": "すべてのノード対には距離に反比例する斥力が働き、各エッジは長さに比例して引き合うばねとして働きます。ディレクトリやファイルは配置に一切影響しません。初期の反復で引っかかった配置になったときは再計算を押してください。",

    "zones.depth": "ディレクトリ / ファイル深さ",
    "zones.help": "深さ 0 ですべてのゾーンを非表示、1 段階ごとにディレクトリを 1 階層ずつ表示し、最大でファイルまで表示します。ゾーンは含まれる宣言を囲む凸包で、物理には一切影響しません。",

    "metric.treeScore": "木スコア",
    "metric.treeScore.hint": "下の 4 つの比率の平均。",
    "metric.spanning": "全域比",
    "metric.spanning.hint": "(ノード数 - 連結成分数) / エッジ数。森ならちょうど 1、複数経路で到達できる宣言があるほど低下。",
    "metric.acyclicity": "非循環率",
    "metric.acyclicity.hint": "呼び出しの循環に含まれない宣言の割合。",
    "metric.singleCaller": "単一呼び出し元率",
    "metric.singleCaller.hint": "呼び出し元が 1 つ以下の宣言の割合。",
    "metric.dagness": "DAG 率",
    "metric.dagness.hint": "循環に関与しないエッジの割合。",
    "metric.declarations": "宣言",
    "metric.edges": "エッジ",
    "metric.components": "連結成分",
    "metric.components.hint": "弱連結成分の数。",
    "metric.roots": "根",
    "metric.roots.hint": "どこからも呼ばれない宣言。",
    "metric.leaves": "葉",
    "metric.leaves.hint": "何も呼ばない宣言。",
    "metric.maxHeight": "最大高さ",
    "metric.maxHeight.hint": "最長の呼び出し連鎖 (3D の層数)。",
    "metric.surplus": "余剰エッジ",
    "metric.surplus.hint": "森に必要な本数を超えるエッジ。",
    "metric.cycles": "循環 (SCC)",
    "metric.cycles.hint": "非自明な強連結成分の数。",
    "metric.selfLoops": "自己ループ",
    "metric.selfLoops.hint": "直接再帰する宣言。",
    "metric.multiCallers": "複数呼び出し元ノード",
    "metric.multiCallers.hint": "2 か所以上から呼ばれる宣言。",
    "metric.dropped": "破棄エッジ",
    "metric.dropped.hint": "端点が宣言されていないエッジ。",
    "metric.shared": "最も共有されている宣言",
    "metric.shared.none": "なし: すべての宣言の呼び出し元は 1 つ以下",
    "metric.shared.callers": "呼び出し元 {count}",

    "selection.empty": "ノードをクリックすると呼び出し元と呼び出し先を表示します。",
    "selection.height": "高さ {height}",
    "selection.inCycle": "循環に含まれる",
    "selection.exported": "エクスポート済み",
    "selection.callers": "呼び出し元",
    "selection.callees": "呼び出し先",
    "selection.none": "なし",

    "kind.function": "関数",
    "kind.method": "メソッド",
    "kind.class": "クラス",
    "kind.variable": "変数",
    "kind.interface": "インターフェース",
    "kind.type": "型",
    "kind.enum": "列挙型",
    "kind.module": "モジュール",
    "kind.unknown": "不明",
    "legend.inCycle": "循環に含まれる",

    "graph3d.height": "高さ {height}",
  },
};

let current = "en";
const listeners = new Set();

/** Pick the initial language: ?lang= query, then saved preference, then the browser locale. */
export function detectLanguage(search = "", saved = null, navigatorLanguage = "en") {
  const fromQuery = new URLSearchParams(search).get("lang");
  const candidates = [fromQuery, saved, navigatorLanguage?.slice(0, 2)];
  for (const c of candidates) {
    if (c && STRINGS[c]) return c;
  }
  return "en";
}

export function getLanguage() {
  return current;
}

export function setLanguage(code) {
  if (!STRINGS[code] || code === current) return;
  current = code;
  for (const fn of listeners) fn(code);
}

/** Subscribe to language changes. Returns an unsubscribe function. */
export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Translate a key with optional {placeholders}. Falls back to English, then to the key itself. */
export function t(key, params) {
  const str = STRINGS[current]?.[key] ?? STRINGS.en[key] ?? key;
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

/** Translate a declaration kind, keeping unknown kinds as-is. */
export function kindLabel(kind) {
  const key = `kind.${kind}`;
  return STRINGS.en[key] ? t(key) : kind;
}

/** Exposed for tests: every language must define exactly the English keys. */
export function missingKeys() {
  const base = Object.keys(STRINGS.en);
  const result = {};
  for (const [code, dict] of Object.entries(STRINGS)) {
    const missing = base.filter((k) => !(k in dict));
    const extra = Object.keys(dict).filter((k) => !(k in STRINGS.en));
    if (missing.length || extra.length) result[code] = { missing, extra };
  }
  return result;
}
