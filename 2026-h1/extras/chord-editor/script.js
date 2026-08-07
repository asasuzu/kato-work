const STORAGE_KEY = "chord-sheet-editor-mvp";

const NOTES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const PRINT_LAYOUTS = ["a4-portrait", "a3-landscape-2up"];
const COLUMN_COUNTS = [1, 2];

// 行末より右にもコードを置けるように、画面表示のときだけ空きスロットを足す
const PAD_SLOTS = 3;

// ドラッグとみなす移動量。これ未満ならクリック扱い
const DRAG_THRESHOLD = 4;

// プレビューの拡大上限。広い画面でも大きくしすぎない
const MAX_PREVIEW_SCALE = 1.6;

// ページ割りの計算用。CSSの1mmは96/25.4px
const MM_TO_PX = 96 / 25.4;
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;
const COLUMN_GAP_MM = 10;

// 用紙の高さを紙ぴったりにすると、端数の丸めではみ出して
// 空白のページが1枚増えることがあるので、わずかに詰めておく
const PAGE_BLEED_GUARD_MM = 0.5;
const SHEET_HEIGHT_MM = PAGE_HEIGHT_MM - PAGE_BLEED_GUARD_MM;

const DEFAULT_SETTINGS = {
  pageMargin: 12,
  fontSize: 16,
  chordLyricGap: 2,
  blockGap: 18,
  letterSpacing: 0,
  songKey: "C",
  previewKey: "C",
  transposePreview: false,
  showDegree: true,
  printLayout: "a4-portrait",
  columns: 1
};

const NOTE_ALIASES = {
  C: "C",
  "C#": "C#",
  Db: "C#",
  D: "D",
  "D#": "D#",
  Eb: "D#",
  E: "E",
  F: "F",
  "F#": "F#",
  Gb: "F#",
  G: "G",
  "G#": "G#",
  Ab: "G#",
  A: "A",
  "A#": "A#",
  Bb: "A#",
  B: "B"
};

// パレット用のダイアトニックコード（キーのI〜VII）
const DIATONIC = [
  { step: 0, suffix: "" },
  { step: 2, suffix: "m" },
  { step: 4, suffix: "m" },
  { step: 5, suffix: "" },
  { step: 7, suffix: "" },
  { step: 9, suffix: "m" },
  { step: 11, suffix: "m7-5" }
];

const state = {
  title: "かえるの歌",
  blocks: [
    {
      lyric: "かえるの歌が  きこえてくるよ",
      chords: [
        { at: 0, name: "C" },
        { at: 4, name: "G" },
        { at: 8, name: "C" },
        { at: 12, name: "G" }
      ]
    }
  ],
  settings: { ...DEFAULT_SETTINGS }
};

// プレビュー上でコードを入力している位置。未編集なら blockIndex が -1
const editor = {
  blockIndex: -1,
  charIndex: -1
};

const drag = {
  active: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  fromBlock: -1,
  fromChar: -1,
  name: "",
  ghost: null,
  hoverUnit: null
};

const elements = {
  titleInput: document.getElementById("titleInput"),
  songKeyInput: document.getElementById("songKeyInput"),

  lyricsInput: document.getElementById("lyricsInput"),

  transposePreviewInput: document.getElementById("transposePreviewInput"),
  previewKeyInput: document.getElementById("previewKeyInput"),
  showDegreeInput: document.getElementById("showDegreeInput"),
  applyTransposeBtn: document.getElementById("applyTransposeBtn"),

  columnsInput: document.getElementById("columnsInput"),
  printLayoutInput: document.getElementById("printLayoutInput"),

  pageMarginInput: document.getElementById("pageMarginInput"),
  fontSizeInput: document.getElementById("fontSizeInput"),
  chordLyricGapInput: document.getElementById("chordLyricGapInput"),
  blockGapInput: document.getElementById("blockGapInput"),
  letterSpacingInput: document.getElementById("letterSpacingInput"),

  pageMarginValue: document.getElementById("pageMarginValue"),
  fontSizeValue: document.getElementById("fontSizeValue"),
  chordLyricGapValue: document.getElementById("chordLyricGapValue"),
  blockGapValue: document.getElementById("blockGapValue"),
  letterSpacingValue: document.getElementById("letterSpacingValue"),

  exportBtn: document.getElementById("exportBtn"),
  importInput: document.getElementById("importInput"),
  printBtn: document.getElementById("printBtn"),

  printArea: document.getElementById("printArea"),
  previewStage: document.querySelector(".preview-stage")
};

let shouldRestorePreviewAfterPrint = false;

/* ------------------------------------------------------------------
 * 文字列の正規化
 * ---------------------------------------------------------------- */

function normalizeLineEndings(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function normalizeCommonText(text) {
  return normalizeLineEndings(text).replace(/　/g, "  ");
}

function toHalfWidthAlphaNumeric(char) {
  return String.fromCharCode(char.charCodeAt(0) - 0xfee0);
}

function normalizeChordText(text) {
  return normalizeCommonText(text)
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, toHalfWidthAlphaNumeric)
    .replace(/[＃♯]/g, "#")
    .replace(/♭/g, "b")
    .replace(/／/g, "/")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/＋/g, "+")
    .replace(/[－−]/g, "-");
}

// コード名には空白を含めない
function normalizeChordName(text) {
  return normalizeChordText(text).replace(/\s+/g, "");
}

function normalizeKey(key) {
  return normalizeChordText(key).trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/* ------------------------------------------------------------------
 * ブロック（1行 = 歌詞 + その上に載るコード）
 * ---------------------------------------------------------------- */

// 同じ位置に2つコードが載らないよう、位置順に整えて重複を落とす
function normalizeChords(chords, lyricLength) {
  if (!Array.isArray(chords)) {
    return [];
  }

  const seen = new Set();

  return chords
    .map((chord) => ({
      at: Math.max(0, Math.trunc(readNumber(chord?.at, 0))),
      name: normalizeChordName(chord?.name || "")
    }))
    .filter((chord) => chord.name !== "")
    .filter((chord) => lyricLength === undefined || chord.at <= lyricLength + PAD_SLOTS)
    .sort((a, b) => a.at - b.at)
    .filter((chord) => {
      if (seen.has(chord.at)) {
        return false;
      }

      seen.add(chord.at);
      return true;
    });
}

function normalizeBlock(block) {
  const lyric = normalizeCommonText(block?.lyric || "");
  return { lyric, chords: normalizeChords(block?.chords, lyric.length) };
}

function normalizeBlocks(blocks) {
  if (!Array.isArray(blocks)) {
    return [];
  }

  return blocks.map(normalizeBlock);
}

// 歌詞もコードも無い行が「かたまりの区切り」
function isBreakBlock(block) {
  return !block.lyric.trim() && block.chords.length === 0;
}

// その行に何個ぶんのマスがあるか（行末より右にもコードを置ける）
function getSlotCount(block, { forPrint = false } = {}) {
  const maxAnchor = block.chords.reduce((max, chord) => Math.max(max, chord.at + 1), 0);
  const base = Math.max(block.lyric.length, maxAnchor, 1);

  return forPrint ? base : base + PAD_SLOTS;
}

function setChord(blockIndex, at, name) {
  const block = state.blocks[blockIndex];

  if (!block) {
    return;
  }

  const rest = block.chords.filter((chord) => chord.at !== at);
  const chordName = normalizeChordName(name);

  block.chords = chordName
    ? normalizeChords([...rest, { at, name: chordName }])
    : normalizeChords(rest);
}

function getChordAt(block, at) {
  const found = block.chords.find((chord) => chord.at === at);
  return found ? found.name : "";
}

function moveChord(fromBlockIndex, fromAt, toBlockIndex, toAt) {
  const fromBlock = state.blocks[fromBlockIndex];
  const toBlock = state.blocks[toBlockIndex];

  if (!fromBlock || !toBlock) {
    return;
  }

  const name = getChordAt(fromBlock, fromAt);

  if (!name) {
    return;
  }

  setChord(fromBlockIndex, fromAt, "");
  setChord(toBlockIndex, toAt, name);
}

/* ------------------------------------------------------------------
 * 歌詞テキスト（左パネル）とブロックの相互変換
 * ---------------------------------------------------------------- */

function blocksToLyricsText(blocks) {
  return blocks.map((block) => block.lyric).join("\n");
}

// 歌詞を編集してもコードが飛ばないように、行を突き合わせて引き継ぐ
function alignBlocksToLines(oldBlocks, lines) {
  const used = new Array(oldBlocks.length).fill(false);
  const result = new Array(lines.length).fill(null);

  // 1周目：文字列がそのまま一致する行を、元の位置に近いものから拾う
  lines.forEach((line, index) => {
    let best = -1;
    let bestDistance = Infinity;

    for (let i = 0; i < oldBlocks.length; i += 1) {
      if (used[i] || oldBlocks[i].lyric !== line) {
        continue;
      }

      const distance = Math.abs(i - index);

      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }

    if (best !== -1) {
      used[best] = true;
      result[index] = {
        lyric: line,
        chords: oldBlocks[best].chords.map((chord) => ({ ...chord }))
      };
    }
  });

  // 2周目：書き換えられた行は、同じ位置にあった行のコードを引き継ぐ
  lines.forEach((line, index) => {
    if (result[index]) {
      return;
    }

    const fallback = !used[index] && oldBlocks[index] ? oldBlocks[index] : null;

    if (fallback) {
      used[index] = true;
    }

    result[index] = normalizeBlock({
      lyric: line,
      chords: fallback ? fallback.chords : []
    });
  });

  return result;
}

function applyLyricsText(text) {
  const lines = normalizeCommonText(text).split("\n");

  // 末尾の空行は区切りとして扱わない
  while (lines.length > 0 && !lines[lines.length - 1].trim()) {
    lines.pop();
  }

  state.blocks = alignBlocksToLines(state.blocks, lines);

  if (state.blocks.length === 0) {
    state.blocks = [{ lyric: "", chords: [] }];
  }
}

/* ------------------------------------------------------------------
 * キー・移調・ディグリー
 * ---------------------------------------------------------------- */

function getNoteIndex(note) {
  const alias = NOTE_ALIASES[normalizeKey(note)];

  if (!alias) {
    return -1;
  }

  return NOTES_SHARP.indexOf(alias);
}

// 移調先キーがフラット系（Db, Eb, F など）なら、コードもフラット表記にする。
// 例: Ebへの移調で D#m ではなく Ebm を出す。
function usesFlatSpelling(key) {
  const normalized = normalizeKey(key);

  if (normalized.includes("b")) {
    return true;
  }

  if (normalized.includes("#")) {
    return false;
  }

  // 変化記号なしのキーで調号がフラット系なのはFのみ
  return normalized === "F";
}

function parseChordToken(token) {
  const normalized = normalizeChordName(token);
  const match = normalized.match(/^([A-G](?:#|b)?)([^/\s]*)(?:\/([A-G](?:#|b)?))?$/);

  if (!match) {
    return null;
  }

  return {
    root: match[1],
    suffix: match[2] || "",
    bass: match[3] || ""
  };
}

function transposeNote(note, steps, useFlats) {
  const index = getNoteIndex(note);

  if (index === -1) {
    return note;
  }

  const names = useFlats ? NOTES_FLAT : NOTES_SHARP;
  return names[(index + steps + 12) % 12];
}

function getTransposeSteps(fromKey, toKey) {
  const fromIndex = getNoteIndex(fromKey);
  const toIndex = getNoteIndex(toKey);

  if (fromIndex === -1 || toIndex === -1) {
    return null;
  }

  return toIndex - fromIndex;
}

function transposeChordName(name, steps, useFlats) {
  const parsed = parseChordToken(name);

  if (!parsed) {
    return name;
  }

  const root = transposeNote(parsed.root, steps, useFlats);
  const bass = parsed.bass ? `/${transposeNote(parsed.bass, steps, useFlats)}` : "";

  return `${root}${parsed.suffix}${bass}`;
}

function getDegreeNumber(root, key) {
  const rootIndex = getNoteIndex(root);
  const keyIndex = getNoteIndex(key);

  if (rootIndex === -1 || keyIndex === -1) {
    return "";
  }

  const diff = (rootIndex - keyIndex + 12) % 12;

  const degreeMap = {
    0: "1",
    1: "♭2",
    2: "2",
    3: "♭3",
    4: "3",
    5: "4",
    6: "♭5",
    7: "5",
    8: "♭6",
    9: "6",
    10: "♭7",
    11: "7"
  };

  return degreeMap[diff] || "";
}

function formatDegreeSuffix(suffix) {
  // テンション数字のみのサフィックス（7・9・6・11・13 など）は
  // 度数と区別しやすいよう括弧で囲む。m・maj7・sus4・dim などの
  // 性質を表すサフィックスはそのまま付与する。
  if (suffix !== "" && /^[0-9]+$/.test(suffix)) {
    return `(${suffix})`;
  }

  return suffix;
}

function chordToDegree(name, key) {
  const parsed = parseChordToken(name);

  if (!parsed) {
    return "";
  }

  const rootDegree = getDegreeNumber(parsed.root, key);

  if (!rootDegree) {
    return "";
  }

  const bassDegree = parsed.bass ? getDegreeNumber(parsed.bass, key) : "";
  const bass = bassDegree ? `/${bassDegree}` : "";

  return `${rootDegree}${formatDegreeSuffix(parsed.suffix)}${bass}`;
}

function getDiatonicChords(key) {
  const keyIndex = getNoteIndex(key);

  if (keyIndex === -1) {
    return [];
  }

  const names = usesFlatSpelling(key) ? NOTES_FLAT : NOTES_SHARP;

  return DIATONIC.map(({ step, suffix }) => `${names[(keyIndex + step) % 12]}${suffix}`);
}

/* ------------------------------------------------------------------
 * 設定
 * ---------------------------------------------------------------- */

function normalizeSettings(settings = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };

  if (!settings.songKey && settings.degreeKey) {
    merged.songKey = settings.degreeKey;
  }

  const songKey = getNoteIndex(merged.songKey) === -1
    ? DEFAULT_SETTINGS.songKey
    : normalizeKey(merged.songKey);

  const previewKey = getNoteIndex(merged.previewKey) === -1
    ? songKey
    : normalizeKey(merged.previewKey);

  const columns = readNumber(merged.columns, DEFAULT_SETTINGS.columns);

  return {
    pageMargin: readNumber(merged.pageMargin, DEFAULT_SETTINGS.pageMargin),
    fontSize: readNumber(merged.fontSize, DEFAULT_SETTINGS.fontSize),
    chordLyricGap: readNumber(merged.chordLyricGap, DEFAULT_SETTINGS.chordLyricGap),
    blockGap: readNumber(merged.blockGap, DEFAULT_SETTINGS.blockGap),
    letterSpacing: readNumber(merged.letterSpacing, DEFAULT_SETTINGS.letterSpacing),
    songKey,
    previewKey,
    transposePreview: settings.transposePreview === undefined
      ? DEFAULT_SETTINGS.transposePreview
      : Boolean(merged.transposePreview),
    showDegree: settings.showDegree === undefined
      ? DEFAULT_SETTINGS.showDegree
      : Boolean(merged.showDegree),
    printLayout: PRINT_LAYOUTS.includes(merged.printLayout)
      ? merged.printLayout
      : DEFAULT_SETTINGS.printLayout,
    columns: COLUMN_COUNTS.includes(columns) ? columns : DEFAULT_SETTINGS.columns
  };
}

/* ------------------------------------------------------------------
 * 旧フォーマット（v2：スペースで桁を合わせたコード行）からの移行
 * ---------------------------------------------------------------- */

function isHalfWidthChar(char) {
  return /[ -~｡-ﾟ]/.test(char);
}

// 旧データは等幅フォント前提で、全角1文字が2カラムぶんの幅だった
function columnToCharIndex(lyric, column) {
  let current = 0;

  for (let i = 0; i < lyric.length; i += 1) {
    if (current >= column) {
      return i;
    }

    current += isHalfWidthChar(lyric[i]) ? 1 : 2;
  }

  return lyric.length + Math.max(0, column - current);
}

function migrateV2Block(block) {
  const lyric = normalizeCommonText(block?.lyric || "");
  const chordLine = normalizeChordText(block?.chord || "");
  const chordRegex = /(^|[\s([{|])([A-G](?:#|b)?[A-Za-z0-9△+\-()]*(?:\/[A-G](?:#|b)?)?)(?=$|[\s)\]},.;:|])/g;
  const chords = [];

  let match;

  while ((match = chordRegex.exec(chordLine)) !== null) {
    const column = match.index + (match[1] || "").length;
    chords.push({ at: columnToCharIndex(lyric, column), name: match[2] });
  }

  return normalizeBlock({ lyric, chords });
}

function readBlocksFromData(data) {
  if (!Array.isArray(data?.blocks)) {
    return null;
  }

  const isLegacy = data.blocks.some(
    (block) => typeof block?.chord === "string" && !Array.isArray(block?.chords)
  );

  return isLegacy
    ? data.blocks.map(migrateV2Block)
    : normalizeBlocks(data.blocks);
}

/* ------------------------------------------------------------------
 * プレビューの描画
 * ---------------------------------------------------------------- */

function applyPrintLayoutClass() {
  document.body.classList.toggle(
    "print-layout-a4-portrait",
    state.settings.printLayout === "a4-portrait"
  );
  document.body.classList.toggle(
    "print-layout-a3-landscape-2up",
    state.settings.printLayout === "a3-landscape-2up"
  );
}

function applyCssVariables() {
  document.documentElement.style.setProperty("--page-margin", `${state.settings.pageMargin}mm`);
  document.documentElement.style.setProperty("--font-size", `${state.settings.fontSize}px`);
  document.documentElement.style.setProperty("--chord-lyric-gap", `${state.settings.chordLyricGap}px`);
  document.documentElement.style.setProperty("--block-gap", `${state.settings.blockGap}px`);
  document.documentElement.style.setProperty("--letter-spacing", `${state.settings.letterSpacing}px`);
  document.documentElement.style.setProperty("--columns", String(state.settings.columns));
  // ページ割りの計算とCSSで同じ高さを使う
  document.documentElement.style.setProperty("--page-height", `${SHEET_HEIGHT_MM}mm`);

  elements.pageMarginValue.textContent = state.settings.pageMargin;
  elements.fontSizeValue.textContent = state.settings.fontSize;
  elements.chordLyricGapValue.textContent = state.settings.chordLyricGap;
  elements.blockGapValue.textContent = state.settings.blockGap;
  elements.letterSpacingValue.textContent = state.settings.letterSpacing;

  applyPrintLayoutClass();
}

// プレビューに出すコード（キー変更中は移調後の名前）
function getDisplayChords(block) {
  if (!state.settings.transposePreview) {
    return block.chords;
  }

  const steps = getTransposeSteps(state.settings.songKey, state.settings.previewKey);

  if (steps === null) {
    return block.chords;
  }

  const useFlats = usesFlatSpelling(state.settings.previewKey);

  return block.chords.map((chord) => ({
    at: chord.at,
    name: transposeChordName(chord.name, steps, useFlats)
  }));
}

function getDegreeKey() {
  return state.settings.transposePreview
    ? state.settings.previewKey
    : state.settings.songKey;
}

function renderChordEditorHtml() {
  const palette = getDiatonicChords(state.settings.songKey)
    .map((name) => `<button type="button" class="chord-palette-btn" data-chord="${escapeHtml(name)}">${escapeHtml(name)}</button>`)
    .join("");

  return `
    <div class="chord-editor no-print">
      <div class="chord-editor-row">
        <input class="chord-editor-input" type="text" spellcheck="false" autocomplete="off" />
        <button type="button" class="chord-editor-ok">確定</button>
      </div>
      <div class="chord-palette">${palette}</div>
    </div>
  `;
}

function renderBlockHtml(block, blockIndex, { forPrint, canInsertBreak }) {
  const chords = getDisplayChords(block);
  const chordByPosition = new Map(chords.map((chord) => [chord.at, chord.name]));
  const degreeKey = getDegreeKey();
  const slotCount = getSlotCount(block, { forPrint });
  const showDegree = state.settings.showDegree;

  const units = [];

  for (let i = 0; i < slotCount; i += 1) {
    const chordName = chordByPosition.get(i) || "";
    const degree = showDegree && chordName ? chordToDegree(chordName, degreeKey) : "";
    const rawChar = i < block.lyric.length ? block.lyric[i] : " ";
    const char = rawChar === " " ? " " : rawChar;

    const isActive = !forPrint && editor.blockIndex === blockIndex && editor.charIndex === i;
    const unitClass = ["cs-unit"];

    if (isActive) {
      unitClass.push("is-active");
    }

    if (i >= block.lyric.length) {
      unitClass.push("is-pad");
    }

    const degreeHtml = showDegree
      ? `<span class="cs-deg">${escapeHtml(degree)}</span>`
      : "";

    const chordClass = chordName ? "cs-chord has-chord" : "cs-chord";
    const editorHtml = isActive ? renderChordEditorHtml() : "";

    units.push(
      `<span class="${unitClass.join(" ")}" data-block="${blockIndex}" data-char="${i}">` +
      degreeHtml +
      `<span class="${chordClass}">${escapeHtml(chordName)}</span>` +
      `<span class="cs-lyric">${escapeHtml(char)}</span>` +
      editorHtml +
      `</span>`
    );
  }

  // 行末の空きマスは幅ゼロの入れ物に押し込む。
  // これがないと、行が段の幅ぎりぎりのときに空きマスだけで折り返してしまう。
  const bodyCount = getSlotCount(block, { forPrint: true });
  const body = units.slice(0, bodyCount).join("");
  const pad = units.length > bodyCount
    ? `<span class="cs-pad-wrap no-print">${units.slice(bodyCount).join("")}</span>`
    : "";

  const insertHtml = canInsertBreak && !forPrint
    ? `<button type="button" class="break-insert no-print" data-insert="${blockIndex}" title="ここで区切る"><span>ここで区切る</span></button>`
    : "";

  return `<div class="song-block" data-block="${blockIndex}">${insertHtml}<div class="cs-line">${body}${pad}</div></div>`;
}

function renderBreakHtml(blockIndex, { forPrint }) {
  const removeHtml = forPrint
    ? ""
    : `<button type="button" class="break-remove no-print" data-remove="${blockIndex}" title="区切りを外す">×</button>`;

  return `<div class="sheet-break" data-block="${blockIndex}">${removeHtml}</div>`;
}

/* ------------------------------------------------------------------
 * ページ割り
 *
 * 紙の上でどこがページの変わり目になるかを自前で計算して、
 * プレビューもその通りにページごとに組む。
 * ブラウザ任せの段組みだと、画面（均等割り）と紙（段ごとに埋める）で
 * 流し方が変わってしまい、プレビューが当てにならないため。
 * ---------------------------------------------------------------- */

function getPageMetrics() {
  const margin = state.settings.pageMargin;
  const columns = state.settings.columns;
  const contentWidth = (PAGE_WIDTH_MM - margin * 2) * MM_TO_PX;
  const contentHeight = (SHEET_HEIGHT_MM - margin * 2) * MM_TO_PX;
  const gap = COLUMN_GAP_MM * MM_TO_PX;

  return {
    columns,
    contentWidth,
    contentHeight,
    columnWidth: columns === 1 ? contentWidth : (contentWidth - gap) / 2
  };
}

// 区切りで挟まれた「かたまり」の連なりにする
function buildSheetItems({ forPrint }) {
  const items = [];

  let group = null;

  state.blocks.forEach((block, index) => {
    if (isBreakBlock(block)) {
      group = null;
      items.push({ kind: "break", html: renderBreakHtml(index, { forPrint }) });
      return;
    }

    if (!group) {
      group = { kind: "group", blocks: [] };
      items.push(group);
    }

    // かたまりの先頭は、すぐ上がもう区切りなので挿入ボタンを出さない
    group.blocks.push({
      html: renderBlockHtml(block, index, { forPrint, canInsertBreak: group.blocks.length > 0 })
    });
  });

  return items;
}

function getOuterHeight(element) {
  const style = getComputedStyle(element);
  return element.offsetHeight + (parseFloat(style.marginBottom) || 0);
}

// 段の幅で一度だけ組んで、各行の高さを測る
function measureSheetItems(items, columnWidth) {
  const layer = document.createElement("div");
  layer.className = "measure-layer";
  layer.style.width = `${columnWidth}px`;
  layer.innerHTML = `<h1 class="sheet-title">${escapeHtml(state.title || "無題")}</h1>` +
    items
      .map((item) => (item.kind === "break" ? item.html : item.blocks.map((b) => b.html).join("")))
      .join("");

  elements.printArea.appendChild(layer);

  const titleHeight = getOuterHeight(layer.querySelector(".sheet-title"));
  const blockElements = layer.querySelectorAll(".song-block");
  const breakElements = layer.querySelectorAll(".sheet-break");

  let blockCursor = 0;
  let breakCursor = 0;

  items.forEach((item) => {
    if (item.kind === "break") {
      item.height = getOuterHeight(breakElements[breakCursor]);
      breakCursor += 1;
      return;
    }

    item.blocks.forEach((block) => {
      block.height = getOuterHeight(blockElements[blockCursor]);
      blockCursor += 1;
    });

    item.height = item.blocks.reduce((total, block) => total + block.height, 0);
  });

  layer.remove();

  return titleHeight;
}

function paginateSheetItems(items, metrics, titleHeight) {
  const limit = metrics.contentHeight;
  const pages = [];
  const queue = items.slice();

  let columns = [];
  let current = [];
  let used = titleHeight; // 1ページ目の1段目には曲名が乗る

  const pushColumn = () => {
    columns.push(current);
    current = [];
    used = 0;

    if (columns.length === metrics.columns) {
      pages.push(columns);
      columns = [];
    }
  };

  let index = 0;

  while (index < queue.length) {
    const item = queue[index];

    if (item.kind === "break") {
      // 段をまたぐ区切りは、前の段の終わりに置いたままにする
      current.push(item);
      used += item.height;
      index += 1;
      continue;
    }

    // かたまりごと収まるならそのまま
    if (used + item.height <= limit) {
      current.push(item);
      used += item.height;
      index += 1;
      continue;
    }

    // 収まらない。段に何か入っているなら次の段へ送る
    if (current.length > 0) {
      pushColumn();
      continue;
    }

    // 段が空でも収まらない＝かたまり自体が1段より高い。行単位で割る
    const fitted = [];
    let height = 0;

    for (const block of item.blocks) {
      if (fitted.length > 0 && height + block.height > limit) {
        break;
      }

      fitted.push(block);
      height += block.height;
    }

    current.push({ kind: "group", blocks: fitted, height });
    used += height;

    const rest = item.blocks.slice(fitted.length);

    if (rest.length === 0) {
      index += 1;
      continue;
    }

    queue[index] = { kind: "group", blocks: rest, height: item.height - height };
    pushColumn();
  }

  if (current.length > 0) {
    columns.push(current);
  }

  if (columns.length > 0) {
    pages.push(columns);
  }

  return pages.length > 0 ? pages : [[[]]];
}

function renderItemsHtml(items) {
  return items
    .map((item) => (item.kind === "break" ? item.html : `<div class="song-group">${item.blocks.map((b) => b.html).join("")}</div>`))
    .join("");
}

function renderPageHtml(columns, pageIndex, metrics) {
  const columnsHtml = columns
    .map((column) => `<div class="sheet-column">${renderItemsHtml(column)}</div>`)
    .join("");

  // 使わなかった段も枠だけ置いて、段幅がずれないようにする
  const filler = Array.from(
    { length: Math.max(0, metrics.columns - columns.length) },
    () => `<div class="sheet-column"></div>`
  ).join("");

  const title = pageIndex === 0
    ? `<h1 class="sheet-title">${escapeHtml(state.title || "無題")}</h1>`
    : "";

  return `<div class="sheet-page-inner">${title}<div class="sheet-columns" data-columns="${metrics.columns}">${columnsHtml}${filler}</div></div>`;
}

function buildPages({ forPrint }) {
  const metrics = getPageMetrics();
  const items = buildSheetItems({ forPrint });
  const titleHeight = measureSheetItems(items, metrics.columnWidth);
  const pages = paginateSheetItems(items, metrics, titleHeight);

  return {
    metrics,
    html: pages.map((columns, index) => renderPageHtml(columns, index, metrics)),
    count: pages.length
  };
}

function renderPreview({ forPrint = false } = {}) {
  applyPrintLayoutClass();

  const pages = buildPages({ forPrint });
  const renderTwoUp = state.settings.printLayout === "a3-landscape-2up";

  // A3の2面付けは、ページごとに同じ面を左右に並べる
  if (renderTwoUp) {
    elements.printArea.className = "print-area print-area-a3-2up";
    elements.printArea.innerHTML = pages.html
      .map((pageHtml, index) => `
        <div class="two-up-page" data-page="${index}">
          ${renderPageLabelHtml(index, pages.count, forPrint)}
          <section class="sheet-page two-up-copy">${pageHtml}</section>
          <div class="cut-line" aria-hidden="true"></div>
          <section class="sheet-page two-up-copy">${pageHtml}</section>
        </div>
      `)
      .join("");
  } else {
    elements.printArea.className = "print-area print-area-a4";
    elements.printArea.innerHTML = pages.html
      .map((pageHtml, index) => `
        <div class="page-slot" data-page="${index}">
          ${renderPageLabelHtml(index, pages.count, forPrint)}
          <section class="sheet-page">${pageHtml}</section>
        </div>
      `)
      .join("");
  }

  if (!forPrint) {
    fitPreviewToStage();
    positionChordEditor();
    focusChordEditorInput();
  }
}

function renderPageLabelHtml(index, total, forPrint) {
  if (forPrint) {
    return "";
  }

  return `<div class="page-label no-print"><span>${index + 1}</span> / ${total} ページ</div>`;
}

// 用紙の実寸は変えずに、プレビュー枠に収まる倍率で見せる。
// 横スクロールを出さないためと、枠が広いときは大きく表示するため。
function fitPreviewToStage() {
  const stage = elements.previewStage;
  const area = elements.printArea;

  if (!stage) {
    return;
  }

  // 画面が狭いときは用紙が枠幅いっぱいに縮むので、拡縮しない
  if (window.matchMedia("(max-width: 1100px)").matches) {
    area.style.transform = "";
    stage.style.height = "";
    return;
  }

  area.style.transform = "";

  const pageWidth = area.offsetWidth;
  const pageHeight = area.offsetHeight;
  const available = stage.clientWidth;

  if (!pageWidth || !available) {
    return;
  }

  const scale = Math.min(MAX_PREVIEW_SCALE, available / pageWidth);

  area.style.transform = `scale(${scale})`;
  stage.style.height = `${pageHeight * scale}px`;
}

// ウィンドウの幅だけでなく、パネル側の伸縮でも枠幅は変わるので
// resizeイベントではなく枠そのものを見張る
function observePreviewWidth() {
  window.addEventListener("resize", fitPreviewToStage);

  if (!elements.previewStage || typeof ResizeObserver === "undefined") {
    return;
  }

  let lastWidth = 0;

  const observer = new ResizeObserver(() => {
    const width = elements.previewStage.clientWidth;

    // 高さは自分で書き換えるので、幅が変わったときだけ計算し直す
    if (width === lastWidth) {
      return;
    }

    lastWidth = width;
    fitPreviewToStage();
  });

  observer.observe(elements.previewStage);
}

function renderForPrint() {
  shouldRestorePreviewAfterPrint = true;
  renderPreview({ forPrint: true });
}

function restoreScreenPreviewAfterPrint() {
  if (!shouldRestorePreviewAfterPrint) {
    return;
  }

  shouldRestorePreviewAfterPrint = false;
  renderPreview();
}

/* ------------------------------------------------------------------
 * プレビュー上でのコード入力
 * ---------------------------------------------------------------- */

function getChordEditorInput() {
  return elements.printArea.querySelector(".chord-editor-input");
}

// プレビューは拡縮して表示しているので、実測値をCSSピクセルに戻す倍率
function getPreviewScale() {
  const width = elements.printArea.offsetWidth;
  return width ? elements.printArea.getBoundingClientRect().width / width : 1;
}

// 小窓は歌詞の上に出す。上や右がはみ出すときだけ逃がす。
function positionChordEditor() {
  const editorEl = elements.printArea.querySelector(".chord-editor");
  const unit = elements.printArea.querySelector(".cs-unit.is-active");

  if (!editorEl || !unit) {
    return;
  }

  editorEl.classList.remove("is-below");
  editorEl.style.left = "";

  const wrapper = elements.printArea.closest(".preview-wrapper");

  if (!wrapper) {
    return;
  }

  const scale = getPreviewScale() || 1;
  const bounds = wrapper.getBoundingClientRect();

  // プレビュー枠は内容にあわせて伸びるので、実際に見えている範囲は
  // 枠と画面の重なった部分になる
  const topLimit = Math.max(bounds.top, 0);
  const rightLimit = Math.min(bounds.right, window.innerWidth);

  // 上に出す余白が無いなら下に回す
  if (editorEl.getBoundingClientRect().top < topLimit + 4) {
    editorEl.classList.add("is-below");
  }

  // 右にはみ出すぶんだけ左へずらす
  const overflowRight = editorEl.getBoundingClientRect().right - (rightLimit - 8);

  if (overflowRight > 0) {
    editorEl.style.left = `${-overflowRight / scale}px`;
  }

  // 三角が対象のマスを指すように位置を合わせる
  const editorRect = editorEl.getBoundingClientRect();
  const unitRect = unit.getBoundingClientRect();
  const arrowX = (unitRect.left - editorRect.left) / scale + 3;

  editorEl.style.setProperty("--arrow-x", `${Math.max(4, arrowX)}px`);
}

function focusChordEditorInput() {
  const input = getChordEditorInput();

  if (!input) {
    return;
  }

  const block = state.blocks[editor.blockIndex];
  input.value = block ? getChordAt(block, editor.charIndex) : "";
  input.focus();
  input.select();
}

function isEditorOpen() {
  return editor.blockIndex !== -1;
}

// 入力中の値を state に書き戻す（描画はしない）
function commitEditorValue() {
  const input = getChordEditorInput();

  if (!input || !isEditorOpen()) {
    return;
  }

  setChord(editor.blockIndex, editor.charIndex, input.value);
}

function openEditor(blockIndex, charIndex) {
  const block = state.blocks[blockIndex];

  if (!block || isBreakBlock(block)) {
    return;
  }

  editor.blockIndex = blockIndex;
  editor.charIndex = Math.max(0, Math.min(charIndex, getSlotCount(block) - 1));

  renderPreview();
  saveToLocalStorage();
}

function closeEditor({ commit = true } = {}) {
  if (!isEditorOpen()) {
    return;
  }

  if (commit) {
    commitEditorValue();
  }

  editor.blockIndex = -1;
  editor.charIndex = -1;

  renderPreview();
  saveToLocalStorage();
}

function getEditableBlockIndexes() {
  return state.blocks
    .map((block, index) => (isBreakBlock(block) ? -1 : index))
    .filter((index) => index !== -1);
}

function moveEditor(direction) {
  if (!isEditorOpen()) {
    return;
  }

  commitEditorValue();

  const editable = getEditableBlockIndexes();
  const position = editable.indexOf(editor.blockIndex);

  if (position === -1) {
    closeEditor({ commit: false });
    return;
  }

  let blockIndex = editor.blockIndex;
  let charIndex = editor.charIndex;

  if (direction === "right" || direction === "left") {
    const step = direction === "right" ? 1 : -1;
    charIndex += step;

    if (charIndex < 0) {
      const previous = editable[position - 1];

      if (previous === undefined) {
        charIndex = 0;
      } else {
        blockIndex = previous;
        charIndex = getSlotCount(state.blocks[previous]) - 1;
      }
    } else if (charIndex >= getSlotCount(state.blocks[blockIndex])) {
      const next = editable[position + 1];

      if (next === undefined) {
        charIndex = getSlotCount(state.blocks[blockIndex]) - 1;
      } else {
        blockIndex = next;
        charIndex = 0;
      }
    }
  } else {
    const next = direction === "down" ? editable[position + 1] : editable[position - 1];

    if (next === undefined) {
      return;
    }

    blockIndex = next;
    charIndex = Math.min(charIndex, getSlotCount(state.blocks[next]) - 1);
  }

  editor.blockIndex = blockIndex;
  editor.charIndex = charIndex;

  renderPreview();
  saveToLocalStorage();
}

function handleEditorKeydown(event) {
  const input = event.target;

  // IMEで変換している最中のキーは、こちらでは拾わずIMEに任せる。
  // 変換中に描画し直すと入力欄が作り直され、未確定の文字が
  // 次のマスの入力欄に持ち越されてしまうため。
  // （keyCode 229 は isComposing が付かないブラウザ向けの保険）
  if (event.isComposing || event.keyCode === 229) {
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    closeEditor({ commit: true });
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeEditor({ commit: false });
    return;
  }

  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    moveEditor(event.key === "ArrowUp" ? "up" : "down");
    return;
  }

  // カーソルが端にあるときだけ、隣のマスへ移る
  if (event.key === "ArrowRight" && input.selectionStart === input.value.length) {
    event.preventDefault();
    moveEditor("right");
    return;
  }

  if (event.key === "ArrowLeft" && input.selectionStart === 0) {
    event.preventDefault();
    moveEditor("left");
  }
}

/* ------------------------------------------------------------------
 * コードのドラッグ移動
 * ---------------------------------------------------------------- */

function createDragGhost(name) {
  const ghost = document.createElement("div");
  ghost.className = "chord-drag-ghost";
  ghost.textContent = name;
  document.body.appendChild(ghost);
  return ghost;
}

function clearDragHover() {
  if (drag.hoverUnit) {
    drag.hoverUnit.classList.remove("is-drop-target");
    drag.hoverUnit = null;
  }
}

function resetDrag() {
  if (drag.ghost) {
    drag.ghost.remove();
  }

  clearDragHover();

  drag.active = false;
  drag.pointerId = null;
  drag.fromBlock = -1;
  drag.fromChar = -1;
  drag.name = "";
  drag.ghost = null;
}

function findUnitAtPoint(x, y) {
  const element = document.elementFromPoint(x, y);
  return element ? element.closest(".cs-unit") : null;
}

function handlePointerMove(event) {
  if (drag.fromBlock === -1) {
    return;
  }

  if (!drag.active) {
    const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);

    if (moved < DRAG_THRESHOLD) {
      return;
    }

    drag.active = true;
    drag.ghost = createDragGhost(drag.name);
    document.body.classList.add("is-dragging-chord");
  }

  drag.ghost.style.left = `${event.clientX}px`;
  drag.ghost.style.top = `${event.clientY}px`;

  const unit = findUnitAtPoint(event.clientX, event.clientY);

  if (unit !== drag.hoverUnit) {
    clearDragHover();

    if (unit) {
      unit.classList.add("is-drop-target");
      drag.hoverUnit = unit;
    }
  }
}

function handlePointerUp(event) {
  if (drag.fromBlock === -1) {
    return;
  }

  const fromBlock = drag.fromBlock;
  const fromChar = drag.fromChar;
  const wasDragging = drag.active;
  const unit = wasDragging ? findUnitAtPoint(event.clientX, event.clientY) : null;

  document.body.classList.remove("is-dragging-chord");
  resetDrag();

  if (!wasDragging) {
    openEditor(fromBlock, fromChar);
    return;
  }

  if (!unit) {
    return;
  }

  const toBlock = Number(unit.dataset.block);
  const toChar = Number(unit.dataset.char);

  if (toBlock === fromBlock && toChar === fromChar) {
    return;
  }

  moveChord(fromBlock, fromChar, toBlock, toChar);
  renderPreview();
  saveToLocalStorage();
}

/* ------------------------------------------------------------------
 * 区切りの挿入・削除
 * ---------------------------------------------------------------- */

function insertBreakBefore(blockIndex) {
  closeEditor({ commit: true });
  state.blocks.splice(blockIndex, 0, { lyric: "", chords: [] });
  renderAll();
}

function removeBreak(blockIndex) {
  closeEditor({ commit: true });
  state.blocks.splice(blockIndex, 1);

  if (state.blocks.length === 0) {
    state.blocks = [{ lyric: "", chords: [] }];
  }

  renderAll();
}

/* ------------------------------------------------------------------
 * 全体の描画・保存
 * ---------------------------------------------------------------- */

function renderAll() {
  elements.titleInput.value = state.title;
  elements.lyricsInput.value = blocksToLyricsText(state.blocks);
  syncSettingInputs();
  applyCssVariables();
  renderPreview();
  saveToLocalStorage();
}

function updateSettingsFromInputs() {
  state.settings = normalizeSettings({
    ...state.settings,
    pageMargin: elements.pageMarginInput.value,
    fontSize: elements.fontSizeInput.value,
    chordLyricGap: elements.chordLyricGapInput.value,
    blockGap: elements.blockGapInput.value,
    letterSpacing: elements.letterSpacingInput.value,
    songKey: elements.songKeyInput.value,
    previewKey: elements.previewKeyInput.value,
    transposePreview: elements.transposePreviewInput.checked,
    showDegree: elements.showDegreeInput.checked,
    printLayout: elements.printLayoutInput.value,
    columns: Number(elements.columnsInput.value)
  });
}

function setSelectValue(select, value, fallback) {
  select.value = value;

  if (select.value !== value) {
    select.value = fallback;
  }
}

function syncSettingInputs() {
  elements.pageMarginInput.value = state.settings.pageMargin;
  elements.fontSizeInput.value = state.settings.fontSize;
  elements.chordLyricGapInput.value = state.settings.chordLyricGap;
  elements.blockGapInput.value = state.settings.blockGap;
  elements.letterSpacingInput.value = state.settings.letterSpacing;
  setSelectValue(elements.songKeyInput, state.settings.songKey, DEFAULT_SETTINGS.songKey);
  setSelectValue(elements.previewKeyInput, state.settings.previewKey, state.settings.songKey);
  elements.transposePreviewInput.checked = state.settings.transposePreview;
  elements.showDegreeInput.checked = state.settings.showDegree;
  setSelectValue(elements.printLayoutInput, state.settings.printLayout, DEFAULT_SETTINGS.printLayout);
  setSelectValue(
    elements.columnsInput,
    String(state.settings.columns),
    String(DEFAULT_SETTINGS.columns)
  );
}

function applyTransposeToSource() {
  closeEditor({ commit: true });
  updateSettingsFromInputs();

  const fromKey = state.settings.songKey;
  const toKey = state.settings.previewKey;
  const steps = getTransposeSteps(fromKey, toKey);

  if (steps === null) {
    alert("キーの指定が正しくありません。");
    return;
  }

  if (steps === 0) {
    alert("曲のキーとプレビューキーが同じため、元データの変更はありません。");
    return;
  }

  const confirmed = window.confirm(
    `元データを ${fromKey} から ${toKey} に書き換えます。元に戻せない場合があります。よろしいですか？`
  );

  if (!confirmed) {
    return;
  }

  const useFlats = usesFlatSpelling(toKey);

  state.blocks = state.blocks.map((block) => ({
    lyric: block.lyric,
    chords: block.chords.map((chord) => ({
      at: chord.at,
      name: transposeChordName(chord.name, steps, useFlats)
    }))
  }));

  state.settings.songKey = toKey;
  state.settings.previewKey = toKey;
  state.settings.transposePreview = false;

  renderAll();
}

function exportJson() {
  closeEditor({ commit: true });

  state.title = elements.titleInput.value.trim();
  state.blocks = normalizeBlocks(state.blocks);
  state.settings = normalizeSettings(state.settings);

  const data = {
    appName: "chord-sheet-editor-mvp",
    version: 3,
    title: state.title,
    blocks: state.blocks,
    settings: state.settings
  };

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  // ファイル名に使えない文字を除いたタイトルをファイル名にする
  const safeTitle = (state.title || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim() || "chord-sheet";
  const fileName = `${safeTitle}.json`;

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();

  URL.revokeObjectURL(url);
  renderAll();
}

function importJson(file) {
  const reader = new FileReader();

  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);

      // このエディタが書き出したJSONかどうかを確認する
      // （appNameを持たない古い書き出しはblocksの形だけで判定する）
      const isForeignApp = data.appName && data.appName !== "chord-sheet-editor-mvp";
      const blocks = isForeignApp ? null : readBlocksFromData(data);

      if (!blocks) {
        alert("このファイルはコード譜エディタで書き出したJSONではないようです。");
        return;
      }

      editor.blockIndex = -1;
      editor.charIndex = -1;

      state.title = data.title || "無題";
      state.blocks = blocks.length > 0 ? blocks : [{ lyric: "", chords: [] }];
      state.settings = normalizeSettings(data.settings || {});

      renderAll();

      alert("JSONを読み込みました。");
    } catch (error) {
      alert("JSONの読み込みに失敗しました。ファイル形式を確認してください。");
      console.error(error);
    }
  };

  reader.readAsText(file);
}

function saveToLocalStorage() {
  const data = {
    version: 3,
    title: state.title,
    blocks: normalizeBlocks(state.blocks),
    settings: normalizeSettings(state.settings)
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    // プライベートbrowsingや容量超過でsetItemが失敗しても、
    // 編集自体は続けられるようにする
    console.error("localStorageへの保存に失敗しました。", error);
  }
}

function loadFromLocalStorage() {
  const json = localStorage.getItem(STORAGE_KEY);

  if (!json) {
    return;
  }

  try {
    const data = JSON.parse(json);
    const blocks = readBlocksFromData(data);

    state.title = data.title || state.title;
    state.blocks = blocks && blocks.length > 0 ? blocks : state.blocks;
    state.settings = normalizeSettings(data.settings || {});
  } catch (error) {
    console.error("localStorageの読み込みに失敗しました。", error);
  }
}

/* ------------------------------------------------------------------
 * イベント
 * ---------------------------------------------------------------- */

function bindPreviewEvents() {
  elements.printArea.addEventListener("pointerdown", (event) => {
    const insertButton = event.target.closest(".break-insert");

    if (insertButton) {
      event.preventDefault();
      insertBreakBefore(Number(insertButton.dataset.insert));
      return;
    }

    const removeButton = event.target.closest(".break-remove");

    if (removeButton) {
      event.preventDefault();
      removeBreak(Number(removeButton.dataset.remove));
      return;
    }

    // 入力中のフォームやパレットの中は、そのまま操作させる
    if (event.target.closest(".chord-editor")) {
      return;
    }

    // 歌詞そのものはコードの置き場所ではないので拾わない
    if (event.target.closest(".cs-lyric")) {
      return;
    }

    const unit = event.target.closest(".cs-unit");

    if (!unit) {
      return;
    }

    event.preventDefault();
    commitEditorValue();

    const blockIndex = Number(unit.dataset.block);
    const charIndex = Number(unit.dataset.char);
    const name = getChordAt(state.blocks[blockIndex], charIndex);

    // コードが載っているマスは、動かすかもしれないので判定を pointerup まで待つ
    if (name) {
      drag.pointerId = event.pointerId;
      drag.startX = event.clientX;
      drag.startY = event.clientY;
      drag.fromBlock = blockIndex;
      drag.fromChar = charIndex;
      drag.name = name;
      return;
    }

    openEditor(blockIndex, charIndex);
  });

  elements.printArea.addEventListener("keydown", (event) => {
    if (event.target.classList.contains("chord-editor-input")) {
      handleEditorKeydown(event);
    }
  });

  // 全角で打たれても、変換が確定した時点で半角のコード名に直す
  elements.printArea.addEventListener("compositionend", (event) => {
    if (!event.target.classList.contains("chord-editor-input")) {
      return;
    }

    event.target.value = normalizeChordName(event.target.value);
  });

  // ボタンを押しただけで入力欄のフォーカスが外れないようにする
  elements.printArea.addEventListener("mousedown", (event) => {
    if (event.target.closest(".chord-palette-btn, .chord-editor-ok")) {
      event.preventDefault();
    }
  });

  elements.printArea.addEventListener("click", (event) => {
    if (!isEditorOpen()) {
      return;
    }

    if (event.target.closest(".chord-editor-ok")) {
      closeEditor({ commit: true });
      return;
    }

    const button = event.target.closest(".chord-palette-btn");

    if (!button) {
      return;
    }

    setChord(editor.blockIndex, editor.charIndex, button.dataset.chord);
    closeEditor({ commit: false });
  });

  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp);
  window.addEventListener("pointercancel", () => {
    document.body.classList.remove("is-dragging-chord");
    resetDrag();
  });

  // プレビューの外を触ったら入力を閉じる。
  // プレビュー内のハンドラが再描画したあとだと event.target が
  // DOMから外れていて contains の判定ができないので、キャプチャ段階で見る。
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!isEditorOpen() || elements.printArea.contains(event.target)) {
        return;
      }

      closeEditor({ commit: true });
    },
    true
  );
}

function bindEvents() {
  elements.titleInput.addEventListener("input", () => {
    state.title = elements.titleInput.value;
    renderPreview();
    saveToLocalStorage();
  });

  elements.lyricsInput.addEventListener("input", () => {
    const wasOpen = isEditorOpen();

    applyLyricsText(elements.lyricsInput.value);

    // 行が減って編集中の位置が消えることがあるので、その場合だけ閉じる
    if (wasOpen && !state.blocks[editor.blockIndex]) {
      editor.blockIndex = -1;
      editor.charIndex = -1;
    }

    renderPreview();
    saveToLocalStorage();
  });

  [
    elements.songKeyInput,
    elements.transposePreviewInput,
    elements.previewKeyInput,
    elements.showDegreeInput,
    elements.columnsInput,
    elements.printLayoutInput,
    elements.pageMarginInput,
    elements.fontSizeInput,
    elements.chordLyricGapInput,
    elements.blockGapInput,
    elements.letterSpacingInput
  ].forEach((input) => {
    // スライダーはドラッグ中も反映したいのでinput、
    // select・チェックボックスは確定時のchangeだけ拾う（二重実行を避ける）
    const eventName = input.tagName === "SELECT" || input.type === "checkbox"
      ? "change"
      : "input";

    input.addEventListener(eventName, () => {
      updateSettingsFromInputs();
      applyCssVariables();
      renderPreview();
      saveToLocalStorage();
    });
  });

  elements.applyTransposeBtn.addEventListener("click", applyTransposeToSource);

  elements.exportBtn.addEventListener("click", exportJson);

  elements.importInput.addEventListener("change", (event) => {
    const file = event.target.files[0];

    if (file) {
      importJson(file);
    }

    event.target.value = "";
  });

  elements.printBtn.addEventListener("click", () => {
    closeEditor({ commit: true });

    state.title = elements.titleInput.value.trim();
    state.blocks = normalizeBlocks(state.blocks);
    state.settings = normalizeSettings(state.settings);

    elements.titleInput.value = state.title;
    renderForPrint();
    saveToLocalStorage();

    window.print();
  });

  window.addEventListener("afterprint", restoreScreenPreviewAfterPrint);
  observePreviewWidth();

  bindPreviewEvents();
}

function initialize() {
  loadFromLocalStorage();
  state.settings = normalizeSettings(state.settings);

  bindEvents();
  renderAll();
}

initialize();
