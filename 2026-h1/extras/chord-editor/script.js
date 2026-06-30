const STORAGE_KEY = "chord-sheet-editor-mvp";

const NOTES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const PRINT_LAYOUTS = ["a4-portrait", "a3-landscape-2up"];

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
  printLayout: "a4-portrait"
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

const state = {
  mode: "text",
  title: "かえるの歌",
  blocks: [
    {
      chord: "C      G    C      G",
      lyric: "かえるの歌が  きこえてくるよ"
    }
  ],
  settings: { ...DEFAULT_SETTINGS }
};

const elements = {
  titleInput: document.getElementById("titleInput"),
  songKeyInput: document.getElementById("songKeyInput"),

  textModeBtn: document.getElementById("textModeBtn"),
  blockModeBtn: document.getElementById("blockModeBtn"),

  textEditorArea: document.getElementById("textEditorArea"),
  blockEditorArea: document.getElementById("blockEditorArea"),

  bulkTextInput: document.getElementById("bulkTextInput"),
  formatTextBtn: document.getElementById("formatTextBtn"),
  applyBulkBtn: document.getElementById("applyBulkBtn"),

  blocksContainer: document.getElementById("blocksContainer"),
  addBlockBtn: document.getElementById("addBlockBtn"),
  applyBlocksBtn: document.getElementById("applyBlocksBtn"),

  transposePreviewInput: document.getElementById("transposePreviewInput"),
  previewKeyInput: document.getElementById("previewKeyInput"),
  showDegreeInput: document.getElementById("showDegreeInput"),
  applyTransposeBtn: document.getElementById("applyTransposeBtn"),

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

  printArea: document.getElementById("printArea")
};

let shouldRestorePreviewAfterPrint = false;

function normalizeLineEndings(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function normalizeCommonText(text) {
  return normalizeLineEndings(text).replace(/\u3000/g, "  ");
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

function normalizeKey(key) {
  return normalizeChordText(key).trim();
}

function normalizeBlocks(blocks) {
  if (!Array.isArray(blocks)) {
    return [];
  }

  return blocks.map((block) => ({
    chord: normalizeChordText(block?.chord || ""),
    lyric: normalizeCommonText(block?.lyric || "")
  }));
}

function readNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSettings(settings = {}) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...settings
  };

  if (!settings.songKey && settings.degreeKey) {
    merged.songKey = settings.degreeKey;
  }

  const songKey = getNoteIndex(merged.songKey) === -1
    ? DEFAULT_SETTINGS.songKey
    : normalizeKey(merged.songKey);

  const previewKey = getNoteIndex(merged.previewKey) === -1
    ? songKey
    : normalizeKey(merged.previewKey);

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
      : DEFAULT_SETTINGS.printLayout
  };
}

function parseTextToBlocks(text) {
  const normalized = normalizeCommonText(text).trim();

  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\n\s*\n+/)
    .map((chunk) => {
      const lines = chunk.split("\n");
      const chord = normalizeChordText(lines[0] || "");
      const lyric = normalizeCommonText(lines.slice(1).join(" ") || "");

      return {
        chord,
        lyric
      };
    });
}

function blocksToText(blocks) {
  return normalizeBlocks(blocks)
    .map((block) => `${block.chord || ""}\n${block.lyric || ""}`)
    .join("\n\n");
}

function formatBulkText(text) {
  return blocksToText(parseTextToBlocks(text));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getChordTokenRegex() {
  return /(^|[\s([{|])([A-G](?:#|b)?[A-Za-z0-9△+\-()]*(?:\/[A-G](?:#|b)?)?)(?=$|[\s)\]},.;:|])/g;
}

function parseChordToken(token) {
  const normalized = normalizeChordText(token);
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

function transposeChordToken(token, steps, useFlats) {
  const parsed = parseChordToken(token);

  if (!parsed) {
    return token;
  }

  const root = transposeNote(parsed.root, steps, useFlats);
  const bass = parsed.bass ? `/${transposeNote(parsed.bass, steps, useFlats)}` : "";

  return `${root}${parsed.suffix}${bass}`;
}

function replaceChordTokens(line, callback) {
  const normalizedLine = normalizeChordText(line);
  const chordRegex = getChordTokenRegex();

  return normalizedLine.replace(chordRegex, (match, prefix, chord) => {
    return `${prefix}${callback(chord)}`;
  });
}

function transposeChordLine(line, fromKey, toKey) {
  const steps = getTransposeSteps(fromKey, toKey);
  const normalizedLine = normalizeChordText(line);

  if (steps === null) {
    return normalizedLine;
  }

  const useFlats = usesFlatSpelling(toKey);
  return replaceChordTokens(normalizedLine, (chord) => transposeChordToken(chord, steps, useFlats));
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

function chordToDegree(chord, key) {
  const parsed = parseChordToken(chord);

  if (!parsed) {
    return chord;
  }

  const rootDegree = getDegreeNumber(parsed.root, key);

  if (!rootDegree) {
    return chord;
  }

  const bassDegree = parsed.bass ? getDegreeNumber(parsed.bass, key) : "";
  const bass = bassDegree ? `/${bassDegree}` : "";

  return `${rootDegree}${formatDegreeSuffix(parsed.suffix)}${bass}`;
}

function createDegreeLine(chordLine, key) {
  const normalizedLine = normalizeChordText(chordLine);
  const chars = [];
  const chordRegex = getChordTokenRegex();

  let match;
  let cursor = 0;

  while ((match = chordRegex.exec(normalizedLine)) !== null) {
    const prefix = match[1] || "";
    const chord = match[2];
    const degree = chordToDegree(chord, key);

    // 「1(7)」のように度数がコードより長い場合、
    // 直前の度数に重ならないよう1文字空けて右にずらす
    const start = Math.max(match.index + prefix.length, cursor);

    for (let i = 0; i < degree.length; i += 1) {
      chars[start + i] = degree[i];
    }

    cursor = start + degree.length + 1;
  }

  for (let i = 0; i < chars.length; i += 1) {
    if (chars[i] === undefined) {
      chars[i] = " ";
    }
  }

  return chars.join("").trimEnd();
}

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

  elements.pageMarginValue.textContent = state.settings.pageMargin;
  elements.fontSizeValue.textContent = state.settings.fontSize;
  elements.chordLyricGapValue.textContent = state.settings.chordLyricGap;
  elements.blockGapValue.textContent = state.settings.blockGap;
  elements.letterSpacingValue.textContent = state.settings.letterSpacing;

  applyPrintLayoutClass();
}

function getPreviewChordLine(block) {
  const sourceChord = normalizeChordText(block.chord || "");

  if (!state.settings.transposePreview) {
    return sourceChord;
  }

  return transposeChordLine(sourceChord, state.settings.songKey, state.settings.previewKey);
}

function getDegreeKey() {
  return state.settings.transposePreview
    ? state.settings.previewKey
    : state.settings.songKey;
}

function renderSongBlock(block) {
  const previewChord = getPreviewChordLine(block);
  const lyric = normalizeCommonText(block.lyric || "");
  const degreeLine = createDegreeLine(previewChord, getDegreeKey());
  const showDegree = state.settings.showDegree && degreeLine;

  const degreeHtml = showDegree
    ? `<div class="degree-line">${escapeHtml(degreeLine)}</div>`
    : "";

  const chordClass = previewChord ? "chord-line" : "chord-line empty-line";
  const lyricClass = lyric ? "lyric-line" : "lyric-line empty-line";

  return `
    <div class="song-block">
      ${degreeHtml}
      <div class="${chordClass}">${escapeHtml(previewChord || " ")}</div>
      <div class="${lyricClass}">${escapeHtml(lyric || " ")}</div>
    </div>
  `;
}

function renderSheetHtml() {
  const title = state.title || "無題";
  const blocksHtml = normalizeBlocks(state.blocks)
    .map((block) => renderSongBlock(block))
    .join("");

  return `
    <h1 class="sheet-title">${escapeHtml(title)}</h1>
    <div class="sheet-blocks">${blocksHtml}</div>
  `;
}

function renderPreview({ forPrint = false } = {}) {
  applyPrintLayoutClass();

  const sheetHtml = renderSheetHtml();
  const renderTwoUp = forPrint && state.settings.printLayout === "a3-landscape-2up";

  if (renderTwoUp) {
    elements.printArea.className = "print-area print-area-a3-2up";
    elements.printArea.innerHTML = `
      <div class="two-up-page">
        <section class="two-up-copy">${sheetHtml}</section>
        <div class="cut-line" aria-hidden="true"></div>
        <section class="two-up-copy">${sheetHtml}</section>
      </div>
    `;
    return;
  }

  elements.printArea.className = "print-area print-area-a4";
  elements.printArea.innerHTML = `<section class="sheet-copy">${sheetHtml}</section>`;
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

function renderTextMode() {
  elements.bulkTextInput.value = blocksToText(state.blocks);
}

function renderBlockMode() {
  elements.blocksContainer.innerHTML = "";

  state.blocks.forEach((block, index) => {
    const card = document.createElement("div");
    card.className = "block-card";

    card.innerHTML = `
      <div class="block-card-header">
        <div class="block-card-title">${index + 1}行目</div>
        <button type="button" data-action="delete" data-index="${index}">削除</button>
      </div>

      <label class="field">
        <span>コード</span>
        <textarea data-type="chord" data-index="${index}" spellcheck="false"></textarea>
      </label>

      <label class="field">
        <span>歌詞</span>
        <textarea data-type="lyric" data-index="${index}" spellcheck="false"></textarea>
      </label>
    `;

    const chordTextarea = card.querySelector('textarea[data-type="chord"]');
    const lyricTextarea = card.querySelector('textarea[data-type="lyric"]');

    chordTextarea.value = block.chord || "";
    lyricTextarea.value = block.lyric || "";

    elements.blocksContainer.appendChild(card);
  });
}

function renderAll() {
  elements.titleInput.value = state.title;
  syncSettingInputs();
  applyCssVariables();

  if (state.mode === "text") {
    renderTextMode();
  } else {
    renderBlockMode();
  }

  renderPreview();
  saveToLocalStorage();
}

function setMode(mode) {
  syncStateFromActiveEditor();
  state.mode = mode;

  elements.textModeBtn.classList.toggle("active", mode === "text");
  elements.blockModeBtn.classList.toggle("active", mode === "block");

  elements.textEditorArea.classList.toggle("hidden", mode !== "text");
  elements.blockEditorArea.classList.toggle("hidden", mode !== "block");

  renderAll();
}

function updateBlocksFromInputs() {
  const newBlocks = [];
  const cards = elements.blocksContainer.querySelectorAll(".block-card");

  cards.forEach((card) => {
    const chord = card.querySelector('textarea[data-type="chord"]').value;
    const lyric = card.querySelector('textarea[data-type="lyric"]').value;

    newBlocks.push({
      chord: normalizeChordText(chord),
      lyric: normalizeCommonText(lyric)
    });
  });

  state.blocks = newBlocks;
}

function syncStateFromActiveEditor({ trimTitle = false } = {}) {
  if (state.mode === "text") {
    state.blocks = parseTextToBlocks(elements.bulkTextInput.value);
  } else {
    updateBlocksFromInputs();
  }

  state.title = trimTitle
    ? elements.titleInput.value.trim()
    : elements.titleInput.value;
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
    printLayout: elements.printLayoutInput.value
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
}

function applyTransposeToSource() {
  syncStateFromActiveEditor();
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

  state.blocks = state.blocks.map((block) => ({
    chord: transposeChordLine(block.chord, fromKey, toKey),
    lyric: normalizeCommonText(block.lyric)
  }));

  state.settings.songKey = toKey;
  state.settings.previewKey = toKey;
  state.settings.transposePreview = false;

  renderAll();
}

function exportJson() {
  syncStateFromActiveEditor({ trimTitle: true });
  state.blocks = normalizeBlocks(state.blocks);
  state.settings = normalizeSettings(state.settings);

  const data = {
    appName: "chord-sheet-editor-mvp",
    version: 2,
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
  renderPreview();
  saveToLocalStorage();
}

function importJson(file) {
  const reader = new FileReader();

  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);

      // このエディタが書き出したJSONかどうかを確認する
      // （appNameを持たない古い書き出しはblocksの形だけで判定する）
      const isForeignApp = data.appName && data.appName !== "chord-sheet-editor-mvp";
      if (isForeignApp || !Array.isArray(data.blocks)) {
        alert("このファイルはコード譜エディタで書き出したJSONではないようです。");
        return;
      }

      state.title = data.title || "無題";
      state.blocks = normalizeBlocks(data.blocks);
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
    title: state.title,
    blocks: normalizeBlocks(state.blocks),
    settings: normalizeSettings(state.settings),
    mode: state.mode
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

    state.title = data.title || state.title;
    state.blocks = Array.isArray(data.blocks)
      ? normalizeBlocks(data.blocks)
      : state.blocks;
    state.settings = normalizeSettings(data.settings || {});
    state.mode = data.mode || "text";
  } catch (error) {
    console.error("localStorageの読み込みに失敗しました。", error);
  }
}

function bindEvents() {
  elements.titleInput.addEventListener("input", () => {
    state.title = elements.titleInput.value;
    renderPreview();
    saveToLocalStorage();
  });

  elements.textModeBtn.addEventListener("click", () => setMode("text"));
  elements.blockModeBtn.addEventListener("click", () => setMode("block"));

  elements.formatTextBtn.addEventListener("click", () => {
    elements.bulkTextInput.value = formatBulkText(elements.bulkTextInput.value);
    state.blocks = parseTextToBlocks(elements.bulkTextInput.value);
    renderPreview();
    saveToLocalStorage();
  });

  elements.applyBulkBtn.addEventListener("click", () => {
    syncStateFromActiveEditor();
    renderPreview();
    saveToLocalStorage();
  });

  elements.bulkTextInput.addEventListener("input", () => {
    state.blocks = parseTextToBlocks(elements.bulkTextInput.value);
    renderPreview();
    saveToLocalStorage();
  });

  elements.addBlockBtn.addEventListener("click", () => {
    updateBlocksFromInputs();

    state.blocks.push({
      chord: "",
      lyric: ""
    });

    renderAll();
  });

  elements.applyBlocksBtn.addEventListener("click", () => {
    updateBlocksFromInputs();
    renderPreview();
    saveToLocalStorage();
  });

  elements.blocksContainer.addEventListener("input", () => {
    updateBlocksFromInputs();
    renderPreview();
    saveToLocalStorage();
  });

  elements.blocksContainer.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='delete']");

    if (!button) {
      return;
    }

    const index = Number(button.dataset.index);

    updateBlocksFromInputs();
    state.blocks.splice(index, 1);

    if (state.blocks.length === 0) {
      state.blocks.push({
        chord: "",
        lyric: ""
      });
    }

    renderAll();
  });

  [
    elements.songKeyInput,
    elements.transposePreviewInput,
    elements.previewKeyInput,
    elements.showDegreeInput,
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
    syncStateFromActiveEditor({ trimTitle: true });
    state.blocks = normalizeBlocks(state.blocks);
    state.settings = normalizeSettings(state.settings);
    renderForPrint();
    saveToLocalStorage();

    window.print();
  });

  window.addEventListener("afterprint", restoreScreenPreviewAfterPrint);
}

function initialize() {
  loadFromLocalStorage();
  state.settings = normalizeSettings(state.settings);

  elements.textModeBtn.classList.toggle("active", state.mode === "text");
  elements.blockModeBtn.classList.toggle("active", state.mode === "block");
  elements.textEditorArea.classList.toggle("hidden", state.mode !== "text");
  elements.blockEditorArea.classList.toggle("hidden", state.mode !== "block");

  bindEvents();
  renderAll();
}

initialize();
