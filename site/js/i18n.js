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
    "app.article": "article",

    "article.subtitle": "Reading DRY, SRP and Clean Architecture precisely enough to make them tools.",
    "article.toViewer": "open the viewer",
    "article.loading": "loading chapters…",
    "article.ready": "{count} chapters",
    "article.loadFailed": "could not load {file}: {message}",
    "article.rename": "Rename every identifier to nonsense",
    "article.restore": "Restore the names",
    "article.renamed": "Every name is gone. No number moved.",
    "article.dataset": "live graph: {name}",
    "article.openInViewer": "open in the viewer",
    "article.selection.empty": "Click a node to see where it could live.",
    "article.selection.node": "{name} ({kind}) — in {in} / out {out}, height {height}",

    "section.data": "Data",
    "section.view": "View",
    "section.edges": "Edges",
    "section.physics": "Physics",
    "section.zones": "Zones",
    "section.diagnostics": "Diagnostics: is it a tree?",
    "section.selection": "Selection",
    "section.legend": "Legend",

    "data.dataset": "Dataset",
    "data.openJson": "Open JSON",
    "data.localFile": "(local file)",

    "view.labels": "Labels",
    "view.labels.auto": "auto",
    "view.labels.all": "all",
    "view.labels.none": "none",
    "view.colourBy": "Colour by",
    "view.colour.kind": "kind",
    "view.colour.height": "call height",
    "edge.call": "call",
    "edge.create": "create",
    "edge.reference": "reference",
    "edge.write": "write",
    "edge.type": "type",
    "edge.extends": "extends",
    "edge.implements": "implements",
    "edge.override": "override",
    "view.layerGap": "Layer gap",
    "view.layerPlanes": "Layer planes",
    "view.autoRotate": "Auto-rotate",
    "view.fit": "Fit to view",
    "view.top": "Top view",
    "view.help": "Drag to orbit, shift+drag to pan, wheel to zoom. Click a node to inspect it, double-click to focus it. Top view looks straight down the height axis with no perspective; orbiting away from it returns to the normal view.",

    "physics.reheat": "Recompute (reheat)",
    "physics.reset": "Reset positions",
    "physics.repulsion": "Repulsion (1/d)",
    "physics.stiffness": "Spring stiffness",
    "physics.restLength": "Spring rest length",
    "physics.help": "Repulsion between every pair of nodes is inversely proportional to their distance, at any distance, and every edge is a spring whose pull is proportional to its length. Those are the only two forces: no point is a centre and nothing pulls towards one, so declarations end up close together only when edges hold them there. Directories and files never influence the layout. Use Recompute when the layout gets stuck in an early configuration, and Fit to view to bring the result back on screen.",

    "zones.depth": "Directory / file depth",
    "zones.help": "Depth 0 hides all zones; each step reveals one more level of directories, and the maximum also shows the files. Zones are convex hulls around the declarations they contain and have no effect on the physics.",

    "metric.treeScore": "Tree score",
    "metric.treeScore.hint": "Average of the five ratios below.",
    "metric.spanning": "Spanning ratio",
    "metric.spanning.hint": "(nodes - roots) / edges. A directed forest gives every non-root exactly one incoming edge, so this is 1 only when no declaration has a second caller.",
    "metric.acyclicity": "Acyclicity",
    "metric.acyclicity.hint": "Share of declarations that are not part of any call cycle.",
    "metric.singleCaller": "Single caller",
    "metric.singleCaller.hint": "Share of declarations with at most one caller.",
    "metric.dagness": "DAG-ness",
    "metric.dagness.hint": "Share of edges that do not participate in a cycle.",
    "metric.locality": "Locality",
    "metric.locality.hint": "How close sharing stays to legal nesting. Every edge scores 1 / (1 + lift), where the lift is the distance in the dominator tree between the caller and the scope the target had to be hoisted to. Being called from an unrelated part of the program costs much more than being shared between siblings.",
    "metric.declarations": "Declarations",
    "metric.edges": "Edges",
    "metric.activeEdges": "Edges counted",
    "metric.activeEdges.hint": "Edges of the kinds enabled in the Edges section.",
    "metric.initCycles": "Init cycles",
    "metric.initCycles.hint": "Declarations in a cycle of definition-time dependencies: read before they are initialised.",
    "metric.scope": "Computed on the edge kinds enabled in the Edges section.",
    "metric.components": "Components",
    "metric.components.hint": "Weakly connected components.",
    "metric.roots": "Roots",
    "metric.roots.hint": "Declarations nobody calls.",
    "metric.leaves": "Leaves",
    "metric.leaves.hint": "Declarations that call nothing.",
    "metric.maxHeight": "Max height",
    "metric.maxHeight.hint": "Longest call chain (layers in 3D).",
    "metric.surplus": "Surplus edges",
    "metric.surplus.hint": "Extra incoming edges: how many would have to go for every declaration to have a single caller.",
    "metric.cycles": "Cycles (SCCs)",
    "metric.cycles.hint": "Non-trivial strongly connected components.",
    "metric.selfLoops": "Self loops",
    "metric.selfLoops.hint": "Directly recursive declarations.",
    "metric.multiCallers": "Multi-caller nodes",
    "metric.multiCallers.hint": "Declarations called from more than one place.",
    "metric.nestingEdges": "Nesting edges",
    "metric.nestingEdges.hint": "Edges whose caller is the natural parent of the target (lift 0): the ones a tree would keep.",
    "metric.maxLift": "Max lift",
    "metric.maxLift.hint": "Largest distance between a caller and the scope its target had to be hoisted to.",
    "metric.dropped": "Dropped edges",
    "metric.dropped.hint": "Edges whose endpoints were not declared.",
    "metric.shared": "Most costly sharing",
    "metric.shared.none": "none: every declaration has at most one caller",
    "metric.shared.callers": "{count} callers, lift {lift}",

    "selection.empty": "Click a node to see its callers and callees.",
    "selection.focus": "Focus",
    "selection.focus.hint": "Centre the camera on this declaration.",
    "selection.height": "height {height}",
    "selection.inCycle": "in a cycle",
    "selection.exported": "exported",
    "selection.scope": "Natural scope",
    "selection.scope.hint": "Where this declaration could live if the program were a tree: its immediate dominator.",
    "selection.scope.top": "top level",
    "selection.lift": "lift {lift}",
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
    "kind.module": "module (top-level code)",
    "kind.unknown": "unknown",
    "legend.inCycle": "in a cycle",
    "legend.edges": "Edges",
    "edges.help": "An enabled kind is drawn, acts as a spring in the physics and counts for degrees, call heights and the diagnostics; a disabled kind does none of these. Every kind starts enabled; turn `write` back off if its reversed direction (variable to writer) is throwing off a dominator-tree-based reading of the diagnostics.",
    "legend.inferred": "dashed = found by flow analysis",

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
    "app.article": "記事",

    "article.subtitle": "DRY・SRP・Clean Architecture を、道具になるまで正確に読む。",
    "article.toViewer": "ビューアを開く",
    "article.loading": "章を読み込み中…",
    "article.ready": "{count} 章",
    "article.loadFailed": "{file} を読み込めませんでした: {message}",
    "article.rename": "すべての識別子を無意味にする",
    "article.restore": "元の名前に戻す",
    "article.renamed": "名前は消えた。数値は一つも動いていない。",
    "article.dataset": "ライブグラフ: {name}",
    "article.openInViewer": "ビューアで開く",
    "article.selection.empty": "ノードをクリックすると、それが本来住める場所が出ます。",
    "article.selection.node": "{name}（{kind}）— 入 {in} / 出 {out}、高さ {height}",

    "section.data": "データ",
    "section.view": "表示",
    "section.edges": "エッジ",
    "section.physics": "物理",
    "section.zones": "ゾーン",
    "section.diagnostics": "診断: 木になっているか",
    "section.selection": "選択",
    "section.legend": "凡例",

    "data.dataset": "データセット",
    "data.openJson": "JSON を開く",
    "data.localFile": "(ローカルファイル)",

    "view.labels": "ラベル",
    "view.labels.auto": "自動",
    "view.labels.all": "すべて",
    "view.labels.none": "なし",
    "view.colourBy": "色分け",
    "view.colour.kind": "種類",
    "view.colour.height": "呼び出し高さ",
    "edge.call": "呼び出し",
    "edge.create": "生成",
    "edge.reference": "参照",
    "edge.write": "書き込み",
    "edge.type": "型",
    "edge.extends": "継承",
    "edge.implements": "実装",
    "edge.override": "オーバーライド",
    "view.layerGap": "層の間隔",
    "view.layerPlanes": "層の平面",
    "view.autoRotate": "自動回転",
    "view.fit": "全体表示",
    "view.top": "真上から見る",
    "view.help": "ドラッグで回転、Shift+ドラッグでパン、ホイールでズーム。ノードをクリックすると詳細を表示、ダブルクリックで注視します。「真上から見る」は遠近感なしで高さの軸を真上から見下ろす視点で、そこから回転すると通常の視点に戻ります。",

    "physics.reheat": "再計算 (リヒート)",
    "physics.reset": "位置をリセット",
    "physics.repulsion": "斥力 (1/d)",
    "physics.stiffness": "ばね定数",
    "physics.restLength": "ばねの自然長",
    "physics.help": "すべてのノード対には距離に反比例する斥力が、どれだけ離れていても働きます。各エッジは長さに比例して引き合うばねです。力はこの 2 つだけで、中心となる点も、そこへ引き寄せる力もありません。近くに集まっている宣言は、エッジがそこに留めているからそこにあります。ディレクトリやファイルは配置に一切影響しません。初期の反復で引っかかった配置になったときは再計算を、画面外に出たときは表示に合わせるを押してください。",

    "zones.depth": "ディレクトリ / ファイル深さ",
    "zones.help": "深さ 0 ですべてのゾーンを非表示、1 段階ごとにディレクトリを 1 階層ずつ表示し、最大でファイルまで表示します。ゾーンは含まれる宣言を囲む凸包で、物理には一切影響しません。",

    "metric.treeScore": "木スコア",
    "metric.treeScore.hint": "下の 5 つの比率の平均。",
    "metric.spanning": "全域比",
    "metric.spanning.hint": "(ノード数 - 根の数) / エッジ数。有向の森では根以外の入次数がちょうど 1 なので、2 つ目の呼び出し元を持つ宣言が 1 つでもあれば 1 を下回る。",
    "metric.acyclicity": "非循環率",
    "metric.acyclicity.hint": "呼び出しの循環に含まれない宣言の割合。",
    "metric.singleCaller": "単一呼び出し元率",
    "metric.singleCaller.hint": "呼び出し元が 1 つ以下の宣言の割合。",
    "metric.dagness": "DAG 率",
    "metric.dagness.hint": "循環に関与しないエッジの割合。",
    "metric.locality": "近接率",
    "metric.locality.hint": "共有が正当な入れ子からどれだけ離れているか。各エッジのスコアは 1 / (1 + 持ち上げ量)。持ち上げ量は、支配木上での呼び出し元と、対象が退避させられたスコープとの距離。無関係な場所から呼ばれるほどコストが大きく、兄弟同士の共有は軽い。",
    "metric.declarations": "宣言",
    "metric.edges": "エッジ",
    "metric.activeEdges": "対象エッジ",
    "metric.activeEdges.hint": "エッジ セクションで有効な種別のエッジ数。",
    "metric.initCycles": "初期化サイクル",
    "metric.initCycles.hint": "定義時依存の循環に含まれる宣言。初期化前に読まれます。",
    "metric.scope": "エッジ セクションで有効な種別で計算しています。",
    "metric.components": "連結成分",
    "metric.components.hint": "弱連結成分の数。",
    "metric.roots": "根",
    "metric.roots.hint": "どこからも呼ばれない宣言。",
    "metric.leaves": "葉",
    "metric.leaves.hint": "何も呼ばない宣言。",
    "metric.maxHeight": "最大高さ",
    "metric.maxHeight.hint": "最長の呼び出し連鎖 (3D の層数)。",
    "metric.surplus": "余剰エッジ",
    "metric.surplus.hint": "余分な入力エッジ数。すべての宣言の呼び出し元を 1 つにするために取り除く必要のあるエッジの数。",
    "metric.cycles": "循環 (SCC)",
    "metric.cycles.hint": "非自明な強連結成分の数。",
    "metric.selfLoops": "自己ループ",
    "metric.selfLoops.hint": "直接再帰する宣言。",
    "metric.multiCallers": "複数呼び出し元ノード",
    "metric.multiCallers.hint": "2 か所以上から呼ばれる宣言。",
    "metric.nestingEdges": "入れ子エッジ",
    "metric.nestingEdges.hint": "呼び出し元が対象の自然な親であるエッジ (持ち上げ量 0)。木にしても残るエッジ。",
    "metric.maxLift": "最大持ち上げ量",
    "metric.maxLift.hint": "呼び出し元と、対象が退避させられたスコープとの距離の最大値。",
    "metric.dropped": "破棄エッジ",
    "metric.dropped.hint": "端点が宣言されていないエッジ。",
    "metric.shared": "共有コストの大きい宣言",
    "metric.shared.none": "なし: すべての宣言の呼び出し元は 1 つ以下",
    "metric.shared.callers": "呼び出し元 {count}、持ち上げ {lift}",

    "selection.empty": "ノードをクリックすると呼び出し元と呼び出し先を表示します。",
    "selection.focus": "フォーカス",
    "selection.focus.hint": "この宣言にカメラを合わせます。",
    "selection.height": "高さ {height}",
    "selection.inCycle": "循環に含まれる",
    "selection.exported": "エクスポート済み",
    "selection.scope": "自然なスコープ",
    "selection.scope.hint": "プログラムが木だったとしたらこの宣言が置ける場所。すなわち直近支配者。",
    "selection.scope.top": "トップレベル",
    "selection.lift": "持ち上げ {lift}",
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
    "kind.module": "モジュール (トップレベルのコード)",
    "kind.unknown": "不明",
    "legend.inCycle": "循環に含まれる",
    "legend.edges": "エッジ",
    "edges.help": "有効な種別は描画され、物理でばねとして働き、次数・呼び出し高さ・診断に数えられます。無効な種別はそのどれにも関与しません。すべての種別は既定で有効です。「書き込み」は向きが逆（変数から書き込み元へ）なので、支配木に基づく診断の読み取りを乱す場合はオフに戻してください。",
    "legend.inferred": "破線 = フロー解析で見つかった呼び出し",

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
