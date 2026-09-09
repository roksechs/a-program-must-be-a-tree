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
    "app.readingFiles": "reading files… {count}",
    "app.fetchingFiles": "fetching files… {done}/{total}",
    "app.loadingCompiler": "loading the TypeScript compiler…",
    "app.loadingTypes": "loading type definitions… {count}",
    "app.analyzingFiles": "analyzing {count} files…",
    "app.layingOut": "Laying the graph out… ({ticks} ticks)",
    "app.analyzeFailed": "could not analyze {name}: {message}",
    "app.status": "{nodes} declarations · {edges} edges",
    "app.statusUnsettled": "{nodes} declarations · {edges} edges · no layout yet — Recompute lays it out",
    "app.statusSettled": "{nodes} declarations · {edges} edges · layout settled",
    "app.dataInfo": "{label}: {nodes} declarations, {edges} edges, {files} files",
    "app.tooltip": "{name}  ({kind})  {location}  in {in} / out {out} / height {height}",
    "app.language": "Language",
    "panel.resize": "Resize the panel (drag, or arrow keys when focused)",

    "section.data": "Data",
    "section.view": "View & Physics",
    "section.edges": "Edges",
    "section.physics": "Physics",
    "section.zones": "Zones",
    "section.diagnostics": "Diagnostics",
    "section.selection": "Selection",
    "section.legend": "Legend",

    "data.open": "Open",
    "data.examples": "Examples",
    "data.loadNew": "Load new",
    "data.openJson": "JSON file…",
    "data.localFile": "(local file)",
    "data.openFolder": "Folder…",
    "data.folderUnsupported": "not supported in this browser (needs Chrome or Edge)",
    "data.githubOption": "GitHub repo…",
    "data.github": "GitHub repo",
    "data.githubPlaceholder": "owner/repo, owner/repo@ref, or a github.com URL",
    "data.githubLoad": "Load",
    "data.exportJson": "Export JSON",
    "data.recent": "Recently opened",
    "data.reanalyze": "Re-analyze",
    "data.remove": "Remove",

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
    "view.autoRotate": "Auto-rotate",
    "view.fit": "Fit to view",
    "view.top": "Top view",
    "view.help": "Drag to orbit, shift+drag to pan, wheel to zoom. W/S pitch, A/D roll (auto-levels when released), Q/E yaw, ↑/↓ move forward/back. Click a node to inspect it, double-click to focus it, ctrl/cmd+click a second one to highlight the path between them. Top view looks straight down the height axis with no perspective; orbiting away from it returns to the normal view.",

    "physics.reheat": "Recompute (reheat)",
    "physics.reset": "Reset positions",
    "physics.repulsion": "Repulsion (1/d)",
    "physics.stiffness": "Spring stiffness",
    "physics.restLength": "Spring rest length",
    "physics.help": "Repulsion between every pair of nodes is inversely proportional to their distance, at any distance, and every edge is a spring whose pull is proportional to its length. Those are the only two forces: no point is a centre and nothing pulls towards one, so declarations end up close together only when edges hold them there. Directories and files never influence the layout. Use Recompute when the layout gets stuck in an early configuration, and Fit to view to bring the result back on screen.",

    "zones.depth": "Directory / file depth range",
    "zones.help": "Both handles start at 0, showing no zones. The low handle is the outermost level shown, the high handle the innermost (the maximum reaches the files); dragging only the high handle keeps revealing outward from the top like before, but the low handle can also show an inner band — a directory two levels down, say — without its outer directories drawn at all. Zones are convex hulls around the declarations they contain and have no effect on the physics.",

    "metric.scope": "Computed on the edge kinds enabled in the Edges section.",
    "metric.export": "Export report",
    "metric.more": "+{count} more (in the exported report)",
    "metric.entryPoints": "Entry points",
    "metric.entryPoints.hint": "Declarations nothing calls: where control enters the program. In a forest these are the roots, so this is how many separate trees the program actually is — and in an application they are what startup and events run, which makes the list a rough inventory of the states the UI can reach.",
    "metric.entryPoints.none": "Nothing here is uncalled: every declaration is reached from somewhere.",
    "metric.escapes": "Scope escapes",
    "metric.escapes.hint": "Dependencies whose target had to be hoisted out of the caller's scope to stay reachable from its other users, grouped by how many scopes that took. A lift of 1 is two siblings sharing a helper; a high lift is a declaration visible across many levels that only one place actually needed.",
    "metric.escapes.summary": "{nesting} dependencies need no hoisting at all. Total lift: {liftSum}.",
    "metric.escapes.lift": "lift {lift}",
    "metric.escapes.show": "Highlight these in the view",
    "metric.escapes.none": "Nothing is hoisted: every dependency could be nested inside its caller.",
    "metric.independence": "Independence",
    "metric.independence.hint": "How much of what a declaration depends on is its alone, averaged over its dependencies as 1 / (1 + lift). It is 1 when everything it uses could live inside it, and falls as those turn out to be shared — the further away the other users, the further it falls. Ranked by how much a declaration gives up in total, not by the score alone: one dependency that happens to be shared says little, the same score across a dozen says a lot.",
    "metric.independence.of": "{score} — depends on {count}",
    "metric.independence.none": "Nothing here depends on anything.",
    "metric.islands": "Islands",
    "metric.islands.hint": "Groups of declarations that depend on each other and on nothing else in the program, and that nothing else depends on. Every connected piece but the largest counts as one, so an island is what you can already see drifting away from the rest of the graph. Usually a family kept together on purpose and reached only from outside — an exported API, handlers a framework calls — or code nothing reaches any more.",
    "metric.islands.summary": "{mainland} declarations are connected to the main body. {singles} more stand entirely alone (listed in the exported report).",
    "metric.islands.andMore": "{names} +{count}",
    "metric.islands.mainland": "Main body",
    "metric.islands.mainlandShow": "Highlight and frame the main body in the view",
    "metric.islands.show": "Highlight and frame this island in the view",
    "metric.islands.none": "No group stands apart: every declaration with a dependency is connected to the main body.",

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
    "selection.pathHint": "Ctrl/cmd+click another node to highlight the path to it.",
    "selection.path.found": "Path found: {count} declarations on it.",
    "selection.path.none": "No path from {from} to {to}.",
    "selection.path.clear": "Clear the path highlight.",

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

  },
  ja: {
    "app.title": "A program must be a tree",
    "app.source": "ソース",
    "app.loading": "読み込み中…",
    "app.loadingDataset": "{name} を読み込み中…",
    "app.loadFailed": "{file} の読み込みに失敗しました: {message}",
    "app.parseFailed": "{file} を解析できませんでした: {message}",
    "app.noDatasets": "データセットがありません。パネルから JSON ファイルを開いてください",
    "app.readingFiles": "ファイルを読み込み中… {count}",
    "app.fetchingFiles": "ファイルを取得中… {done}/{total}",
    "app.loadingCompiler": "TypeScript コンパイラを読み込み中…",
    "app.loadingTypes": "型定義を読み込み中… {count}",
    "app.analyzingFiles": "{count} ファイルを解析中…",
    "app.layingOut": "グラフを配置中… ({ticks} tick)",
    "app.analyzeFailed": "{name} を解析できませんでした: {message}",
    "app.status": "宣言 {nodes} · エッジ {edges}",
    "app.statusUnsettled": "宣言 {nodes} · エッジ {edges} · 配置未計算 — 「再計算」で配置します",
    "app.statusSettled": "宣言 {nodes} · エッジ {edges} · 配置が落ち着きました",
    "app.dataInfo": "{label}: 宣言 {nodes}、エッジ {edges}、ファイル {files}",
    "app.tooltip": "{name}  ({kind})  {location}  入 {in} / 出 {out} / 高さ {height}",
    "app.language": "言語",
    "panel.resize": "パネルの幅を変える(ドラッグ、またはフォーカス中に矢印キー)",

    "section.data": "データ",
    "section.view": "表示・物理",
    "section.edges": "エッジ",
    "section.physics": "物理",
    "section.zones": "ゾーン",
    "section.diagnostics": "診断",
    "section.selection": "選択",
    "section.legend": "凡例",

    "data.open": "開く",
    "data.examples": "サンプル",
    "data.loadNew": "新しく読み込む",
    "data.openJson": "JSONファイル…",
    "data.localFile": "(ローカルファイル)",
    "data.openFolder": "フォルダ…",
    "data.folderUnsupported": "このブラウザでは使えません(Chrome か Edge が必要)",
    "data.githubOption": "GitHub リポジトリ…",
    "data.github": "GitHub リポジトリ",
    "data.githubPlaceholder": "owner/repo、owner/repo@ref、または github.com の URL",
    "data.githubLoad": "読み込む",
    "data.exportJson": "JSON をエクスポート",
    "data.recent": "最近開いた項目",
    "data.reanalyze": "再解析",
    "data.remove": "削除",

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
    "view.autoRotate": "自動回転",
    "view.fit": "全体表示",
    "view.top": "真上から見る",
    "view.help": "ドラッグで回転、Shift+ドラッグでパン、ホイールでズーム。W/Sでピッチ、A/Dでロール(離すと自動で水平に戻ります)、Q/Eでヨー、↑/↓で前後移動。ノードをクリックすると詳細を表示、ダブルクリックで注視、Ctrl/Cmd+クリックで2つ目のノードとの間の経路をハイライトします。「真上から見る」は遠近感なしで高さの軸を真上から見下ろす視点で、そこから回転すると通常の視点に戻ります。",

    "physics.reheat": "再計算 (リヒート)",
    "physics.reset": "位置をリセット",
    "physics.repulsion": "斥力 (1/d)",
    "physics.stiffness": "ばね定数",
    "physics.restLength": "ばねの自然長",
    "physics.help": "すべてのノード対には距離に反比例する斥力が、どれだけ離れていても働きます。各エッジは長さに比例して引き合うばねです。力はこの 2 つだけで、中心となる点も、そこへ引き寄せる力もありません。近くに集まっている宣言は、エッジがそこに留めているからそこにあります。ディレクトリやファイルは配置に一切影響しません。初期の反復で引っかかった配置になったときは再計算を、画面外に出たときは表示に合わせるを押してください。",

    "zones.depth": "ディレクトリ / ファイル深さの範囲",
    "zones.help": "両方のハンドルは初期状態で 0 にあり、ゾーンは何も表示されません。下限ハンドルが表示する最も外側の階層、上限ハンドルが最も内側の階層(最大でファイルまで)です。上限ハンドルだけを動かせば従来どおり外側から段階的に表示できますが、下限ハンドルを使えば、例えば2階層下のディレクトリだけを、外側のディレクトリを表示せずに見せることもできます。ゾーンは含まれる宣言を囲む凸包で、物理には一切影響しません。",

    "metric.scope": "エッジ セクションで有効な種別で計算しています。",
    "metric.export": "レポートを書き出す",
    "metric.more": "他 {count} 件(書き出したレポートに含まれます)",
    "metric.entryPoints": "エントリポイント",
    "metric.entryPoints.hint": "どこからも呼ばれない宣言、つまり制御がプログラムに入ってくる場所です。森であればこれが根なので、この数はプログラムが実際にいくつの木でできているかを表します。アプリケーションでは起動処理とイベント処理がここに来るため、この一覧はUIが取りうる状態のおおまかな棚卸しになります。",
    "metric.entryPoints.none": "呼ばれていない宣言はありません。すべてどこかから到達されています。",
    "metric.escapes": "スコープの持ち出し",
    "metric.escapes.hint": "他の利用者から到達できるように、呼び出し元のスコープの外へ持ち上げざるを得なかった依存を、持ち上げた段数ごとに分類したものです。段数1は兄弟2つが補助関数を共有している状態、段数が大きいものは1箇所しか必要としていないのに何階層にもわたって見えてしまっている宣言です。",
    "metric.escapes.summary": "持ち上げが不要な依存は {nesting} 件。持ち上げ段数の合計: {liftSum}。",
    "metric.escapes.lift": "段数 {lift}",
    "metric.escapes.show": "ビューで強調表示する",
    "metric.escapes.none": "持ち上げは発生していません。すべての依存が呼び出し元の中に入れられます。",
    "metric.independence": "独立度",
    "metric.independence.hint": "その宣言が依存しているもののうち、どれだけが自分だけのものかを、各依存の 1 / (1 + 段数) の平均で表します。使っているものすべてを自分の中に置けるなら 1 で、それらが共有されているほど下がります。共有相手が遠いほど大きく下がります。並び順はスコアではなく「合計でどれだけ手放しているか」です。共有された依存が1件だけならほとんど何も言えませんが、同じスコアが十数件にわたるなら重大だからです。",
    "metric.independence.of": "{score}(依存 {count} 件)",
    "metric.independence.none": "何にも依存していません。",
    "metric.islands": "浮島",
    "metric.islands.hint": "互いに依存し合っているだけで、プログラムの他のどこにも依存せず、どこからも依存されていない宣言の組です。連結した塊のうち最大のもの以外がこれにあたるので、グラフ上で本体から離れて漂っている塊がそのまま該当します。多くは意図してまとめられた一族が外からしか呼ばれていない場合(公開API、フレームワークが呼ぶハンドラなど)か、もう誰も到達しなくなったコードです。",
    "metric.islands.summary": "本体につながっている宣言は {mainland} 件。ほかに {singles} 件が単独で孤立しています(書き出したレポートに一覧があります)。",
    "metric.islands.andMore": "{names} 他{count}件",
    "metric.islands.mainland": "本体",
    "metric.islands.mainlandShow": "本体を強調表示してビューに収める",
    "metric.islands.show": "この浮島を強調表示してビューに収める",
    "metric.islands.none": "離れている組はありません。依存を持つ宣言はすべて本体につながっています。",

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
    "selection.pathHint": "Ctrl/Cmd+クリックで別のノードとの間の経路をハイライトします。",
    "selection.path.found": "経路が見つかりました: {count} 件の宣言が含まれます。",
    "selection.path.none": "{from} から {to} への経路はありません。",
    "selection.path.clear": "経路のハイライトを解除します。",

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
