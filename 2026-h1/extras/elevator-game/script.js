const FLOORS = 10;
const FLOOR_H = 54;
const MAX_CAPACITY = 4;
const ELEVATOR_COUNT = 2;

const GAME_DURATION_MS = 60000;     // 制限時間 60秒
const CLOCK_TICK_MS = 100;
const STRESS_TICK_MS = 250;
const WAIT_PATIENCE_MS = 14000;     // 待ち客が怒って帰るまで（VIPは短い）
const VIP_PATIENCE_RATE = 0.65;

const MOVE_MS = 230;                // 移動速度（1階あたり）

// 乗降アニメーションの各フェーズ時間
const DOOR_MS = 200;   // ドア開閉
const EXIT_MS = 320;   // 降車
const ENTER_MS = 320;  // 乗車

// 客の発生（時間経過でスポーン間隔が短くなる）
const SPAWN_START_MS = 2400;
const SPAWN_MIN_MS = 1100;
const INITIAL_SPAWN_COUNT = 5;
const LOBBY_BIAS = 0.35;            // 1F発・1F行きが出やすい
const MAX_VISIBLE_PER_FLOOR = 4;
const MAX_WAIT_PER_FLOOR = 6;

// スコア
const BASE_POINT = 100;
const VIP_POINT = 250;
const MISS_PENALTY = 50;
const MULTI_DROP_BONUS = 50;        // 同時降車ボーナス（2人目以降1人ごと）
const COMBO_WINDOW_MS = 7000;       // この間に次を運べばコンボ継続
const COMBO_STEP = 0.2;             // 1コンボごとの倍率上昇
const COMBO_MAX_MULT = 3;

const VIP_CHANCE = 0.1;
const BEST_KEY = 'elevator-duo-best';

const PASSENGER_ICONS = ['🧑', '👩', '👨', '👩‍💼', '👨‍💼'];
const VIP_ICONS = ['👔', '💼'];

/* ───────────── 状態 ───────────── */

let score = 0;
let delivered = 0;
let misses = 0;
let combo = 0;
let maxCombo = 0;
let comboLeftMs = 0;

let timeLeftMs = GAME_DURATION_MS;
let isRunning = false;
let spawnTimer = null;
let stressTimer = null;
let clockTimer = null;
let passengerIdCounter = 0;
let floorPassengers = {};

let elevators = [];

function newElevator(i, name, startFloor) {
  return {
    i, name,
    floor: startFloor,
    pax: [],
    state: 'idle',        // idle | moving | doors
    dir: 0,
    target: null,
    pendingTarget: null,  // ドア開閉中に受け付けた次の行き先
    timer: null
  };
}

function loadBest() {
  try {
    return parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
  } catch (e) {
    return 0;
  }
}

function saveBest(v) {
  try {
    localStorage.setItem(BEST_KEY, String(v));
  } catch (e) { /* localStorage 使えない環境は無視 */ }
}

/* ───────────── 画面遷移 ───────────── */

function showStart() {
  stopAllTimers();
  isRunning = false;

  document.getElementById('best-start').textContent = loadBest();
  document.getElementById('screen-result').style.display = 'none';
  document.getElementById('screen-start').style.display = 'flex';
  document.getElementById('overlay').style.display = 'flex';

  resetState();
  buildFloors();
  refreshAll();
}

function startGame() {
  document.getElementById('overlay').style.display = 'none';

  stopAllTimers();
  resetState();
  buildFloors();
  refreshAll();

  isRunning = true;

  scheduleSpawn();
  stressTimer = setInterval(tickStress, STRESS_TICK_MS);
  clockTimer = setInterval(tickClock, CLOCK_TICK_MS);

  for (let i = 0; i < INITIAL_SPAWN_COUNT; i++) {
    spawnPassenger();
  }
}

function stopAllTimers() {
  clearTimeout(spawnTimer);
  clearInterval(stressTimer);
  clearInterval(clockTimer);
  elevators.forEach(e => clearTimeout(e.timer));
}

function resetState() {
  score = 0;
  delivered = 0;
  misses = 0;
  combo = 0;
  maxCombo = 0;
  comboLeftMs = 0;
  timeLeftMs = GAME_DURATION_MS;
  passengerIdCounter = 0;
  floorPassengers = {};

  elevators = [newElevator(0, 'A', 1), newElevator(1, 'B', 5)];
}

function refreshAll() {
  updateScoreboard();
  updateTimerDisplay();
  elevators.forEach(e => {
    setCarOpen(e, false);
    positionElevator(e, false);
    renderCard(e);
    updateTargetMarker(e);
  });
}

function endGame() {
  isRunning = false;
  stopAllTimers();

  const prevBest = loadBest();
  const isNewBest = score > prevBest;
  const best = isNewBest ? score : prevBest;
  if (isNewBest) saveBest(best);

  document.getElementById('result-score').textContent = score;
  document.getElementById('result-count').textContent = delivered;
  document.getElementById('result-combo').textContent = maxCombo;
  document.getElementById('result-miss').textContent = misses;
  document.getElementById('best-result').textContent = best;

  document.getElementById('result-best').classList.toggle('new-best', isNewBest);
  document.getElementById('best-label').textContent
    = isNewBest ? '🎉 自己ベスト更新！' : '自己ベスト';

  document.getElementById('screen-start').style.display = 'none';
  document.getElementById('screen-result').style.display = 'flex';
  document.getElementById('overlay').style.display = 'flex';
}

/* ───────────── タイマー・コンボ ───────────── */

function tickClock() {
  if (!isRunning) return;
  timeLeftMs -= CLOCK_TICK_MS;
  if (timeLeftMs <= 0) {
    timeLeftMs = 0;
    updateTimerDisplay();
    endGame();
    return;
  }
  updateTimerDisplay();

  // コンボは時間切れで消える
  if (combo > 0) {
    comboLeftMs -= CLOCK_TICK_MS;
    if (comboLeftMs <= 0) {
      combo = 0;
      comboLeftMs = 0;
    }
    updateScoreboard();
  }
}

function updateTimerDisplay() {
  const sec = Math.ceil(timeLeftMs / 1000);
  document.getElementById('timer-val').textContent = sec;
  const pct = Math.min(100, (timeLeftMs / GAME_DURATION_MS) * 100);
  document.getElementById('timer-bar-fill').style.width = pct + '%';
  document.getElementById('timer-wrap').classList.toggle('urgent', timeLeftMs <= 10000);
}

function comboMultiplier() {
  return Math.min(1 + (combo - 1) * COMBO_STEP, COMBO_MAX_MULT);
}

// 1人運ぶごとに呼ばれ、獲得点を返す
function addDelivery(p) {
  combo++;
  if (combo > maxCombo) maxCombo = combo;
  comboLeftMs = COMBO_WINDOW_MS;
  const pts = Math.round((p.isVip ? VIP_POINT : BASE_POINT) * comboMultiplier());
  score += pts;
  return pts;
}

function addMiss(floor, count = 1) {
  misses += count;
  score = Math.max(0, score - MISS_PENALTY * count);
  combo = 0;
  comboLeftMs = 0;
  updateScoreboard();
  // 同じ階で複数人が同時に帰っても、ポップは1つにまとめて表示する
  showFloorPop(floor, `💢 -${MISS_PENALTY * count}`, null, true);
}

function updateScoreboard() {
  document.getElementById('score-val').textContent = String(score);
  document.getElementById('miss-val').textContent = String(misses);

  const comboVal = document.getElementById('combo-val');
  const comboFill = document.getElementById('combo-bar-fill');
  if (combo >= 2) {
    comboVal.textContent = `×${combo}`;
    comboVal.classList.add('active');
  } else {
    comboVal.textContent = '—';
    comboVal.classList.remove('active');
  }
  comboFill.style.width = combo > 0 ? `${(comboLeftMs / COMBO_WINDOW_MS) * 100}%` : '0%';
}

/* ───────────── 盤面（建物・シャフト） ───────────── */

function buildFloors() {
  const building = document.getElementById('building');
  building.innerHTML = '';

  for (let f = FLOORS; f >= 1; f--) {
    const row = document.createElement('div');
    row.className = 'floor';
    row.dataset.floor = f;
    row.innerHTML = `
      <div class="floor-num">${f}<span>F</span></div>
      <div class="floor-passengers" id="fp-${f}"></div>
    `;
    building.appendChild(row);
    floorPassengers[f] = [];
  }
}

// 各シャフトに階ごとのクリックマスを敷く（起動時に1回だけ）
function buildShaftCells() {
  for (let i = 0; i < ELEVATOR_COUNT; i++) {
    const shaft = document.getElementById(`shaft-${i}`);
    for (let f = 1; f <= FLOORS; f++) {
      const cell = document.createElement('div');
      cell.className = 'shaft-cell';
      cell.id = `cell-${i}-${f}`;
      cell.dataset.f = f;
      cell.style.bottom = ((f - 1) * FLOOR_H) + 'px';
      cell.addEventListener('click', () => commandElevator(i, f));
      shaft.appendChild(cell);
    }
  }
}

function positionElevator(e, animate) {
  const elv = document.getElementById(`elv-${e.i}`);
  const bottom = (e.floor - 1) * FLOOR_H + 3;
  elv.style.transition = animate ? `bottom ${MOVE_MS / 1000}s linear` : 'none';
  elv.style.bottom = bottom + 'px';
  document.getElementById(`elv-floor-${e.i}`).textContent = `${e.floor}F`;
  document.getElementById(`card-floor-${e.i}`).textContent = `${e.floor}F`;
}

/* ───────────── 操作：シャフトのマスをクリックで指示 ─────────────
   選択の概念はなく、A/Bどちらのレーンをクリックしたかで号機が決まる。
   移動中は行き先を上書き（リターゲット）、ドア開閉中は次の行き先として
   予約し、どの状態でもクリックが無駄にならないようにする */

function commandElevator(i, floor) {
  if (!isRunning) return;
  const e = elevators[i];

  if (e.state === 'doors') {
    e.pendingTarget = floor;
    updateTargetMarker(e);
    return;
  }

  if (e.state === 'moving') {
    if (floor === e.target) return;
    e.target = floor;
    setStatus(e, `${floor}F へ移動中`);
    renderCard(e);
    updateTargetMarker(e);
    return; // 進行中の stepMove が新しい行き先を拾う
  }

  // idle
  if (floor === e.floor) {
    doorCycle(e, true); // 今いる階＝その場で乗降
    return;
  }

  e.target = floor;
  e.state = 'moving';
  setStatus(e, `${floor}F へ移動中`);
  renderCard(e);
  updateTargetMarker(e);
  stepMove(e);
}

// 1階ぶん移動し、アニメーション完了後に到着・途中停車を判定する。
// 方向は毎ステップ target から計算し直すので、リターゲットで逆方向を
// 指示されても次の階で自然に折り返す。
function stepMove(e) {
  if (!isRunning) return;

  e.dir = e.target > e.floor ? 1 : -1;
  e.floor += e.dir;
  positionElevator(e, true);
  renderCard(e);

  e.timer = setTimeout(() => {
    if (!isRunning) return;

    if (e.floor === e.target) {
      // 目的階に到着
      doorCycle(e, true);
      return;
    }
    // 次の進行方向を確定してから途中停車を判定する
    e.dir = e.target > e.floor ? 1 : -1;
    if (shouldStopHere(e)) {
      doorCycle(e, false); // 途中階で乗降のため停車
    } else {
      stepMove(e);
    }
  }, MOVE_MS);
}

// 途中停車の条件：降りる客がいる or 同方向の待ち客を乗せられる
function shouldStopHere(e) {
  const hasDrop = e.pax.some(p => p.dest === e.floor);
  const waiting = floorPassengers[e.floor] || [];
  const hasPick = e.pax.length < MAX_CAPACITY && waiting.some(p => paxDir(p) === e.dir);
  return hasDrop || hasPick;
}

function paxDir(p) {
  return p.dest > p.floor ? 1 : -1;
}

/* ───────────── 乗降（自動ドアサイクル） ───────────── */

// final=true: 目的階（誰でも乗れる）
// final=false: 途中階（同方向の客のみ乗せて続行）
function doorCycle(e, final) {
  e.state = 'doors';
  setCarOpen(e, true);
  setStatus(e, final ? '乗降中' : '途中乗降');
  renderCard(e);

  const floor = e.floor;
  const leaving = e.pax.filter(p => p.dest === floor);
  const exitMs = leaving.length ? EXIT_MS : 0;

  // ① 降車（得点）→ ② 乗車
  e.timer = setTimeout(() => {
    if (!isRunning) return;
    dropPassengers(e);
    const boarded = boardPassengers(e, final);
    renderCard(e, { entering: boarded.map(p => p.id) });
    renderFloorPassengers(floor);

    // ③ ドアを閉めて、次の行き先へ出発 or 待機
    e.timer = setTimeout(() => {
      if (!isRunning) return;
      setCarOpen(e, false);

      e.timer = setTimeout(() => {
        if (!isRunning) return;

        // ドア開閉中の予約 > 続行中の目的階 の優先で次を決める
        const next = e.pendingTarget != null
          ? e.pendingTarget
          : (final ? null : e.target);
        e.pendingTarget = null;

        if (next == null || next === e.floor) {
          e.state = 'idle';
          e.dir = 0;
          e.target = null;
          setStatus(e, '待機中');
          renderCard(e);
          updateTargetMarker(e);
        } else {
          e.target = next;
          e.state = 'moving';
          setStatus(e, `${next}F へ移動中`);
          renderCard(e);
          updateTargetMarker(e);
          stepMove(e);
        }
      }, DOOR_MS);
    }, exitMs + ENTER_MS);
  }, DOOR_MS + exitMs);
}

function setCarOpen(e, open) {
  document.getElementById(`elv-${e.i}`).classList.toggle('open', open);
}

// 乗せる：目的階なら誰でも、途中階なら同方向のみ。待ちが長い人から優先
function boardPassengers(e, final) {
  const floor = e.floor;
  const onFloor = floorPassengers[floor] || [];
  const room = MAX_CAPACITY - e.pax.length;
  if (room <= 0 || onFloor.length === 0) return [];

  let candidates = final ? onFloor : onFloor.filter(p => paxDir(p) === e.dir);
  if (candidates.length === 0) return [];

  const taking = [...candidates].sort((a, b) => b.stress - a.stress).slice(0, room);
  const takenIds = new Set(taking.map(p => p.id));

  taking.forEach(p => e.pax.push(p));
  floorPassengers[floor] = onFloor.filter(p => !takenIds.has(p.id));
  return taking;
}

function dropPassengers(e) {
  const floor = e.floor;
  const dropped = e.pax.filter(p => p.dest === floor);
  if (dropped.length === 0) return;

  e.pax = e.pax.filter(p => p.dest !== floor);
  delivered += dropped.length;

  let pts = 0;
  dropped.forEach((p, index) => {
    pts += addDelivery(p);
    animateDrop(floor, p.icon, index);
  });

  // 同じ階でまとめて降ろすとボーナス
  let bonus = 0;
  if (dropped.length >= 2) {
    bonus = MULTI_DROP_BONUS * (dropped.length - 1);
    score += bonus;
  }

  flashElevator(e);
  updateScoreboard();

  const subs = [];
  if (bonus > 0) subs.push(`👥まとめ降車 +${bonus}`);
  if (combo >= 2) subs.push(`COMBO ×${combo}`);
  showFloorPop(floor, `+${pts + bonus}`, subs.join('　'), false, combo);
}

function animateDrop(floor, icon, index) {
  const fp = document.getElementById(`fp-${floor}`);
  if (!fp) return;

  const dropChip = document.createElement('div');
  dropChip.className = 'drop-anim-chip';
  dropChip.textContent = icon;
  dropChip.style.left = `${6 + (index * 15)}px`;
  dropChip.style.bottom = '10px';
  fp.appendChild(dropChip);

  setTimeout(() => dropChip.remove(), 800);
}

/* ───────────── 客の発生・離脱 ───────────── */

function scheduleSpawn() {
  const elapsed = GAME_DURATION_MS - timeLeftMs;
  const interval = Math.max(
    SPAWN_MIN_MS,
    SPAWN_START_MS - (elapsed / GAME_DURATION_MS) * (SPAWN_START_MS - SPAWN_MIN_MS)
  );
  spawnTimer = setTimeout(() => {
    spawnPassenger();
    scheduleSpawn();
  }, interval);
}

function spawnPassenger() {
  if (!isRunning) return;

  let floor;
  if (Math.random() < LOBBY_BIAS && (floorPassengers[1] || []).length < MAX_WAIT_PER_FLOOR) {
    floor = 1; // ロビー（1F）は人が多い
  } else {
    const candidateFloors = [];
    for (let f = 1; f <= FLOORS; f++) {
      if ((floorPassengers[f] || []).length < MAX_WAIT_PER_FLOOR) candidateFloors.push(f);
    }
    if (candidateFloors.length === 0) return;
    floor = candidateFloors[Math.floor(Math.random() * candidateFloors.length)];
  }

  const dest = randomDest(floor);
  const isVip = Math.random() < VIP_CHANCE;

  const p = {
    id: ++passengerIdCounter,
    floor,
    dest,
    stress: 0,
    maxStress: isVip ? WAIT_PATIENCE_MS * VIP_PATIENCE_RATE : WAIT_PATIENCE_MS,
    isVip,
    icon: isVip
      ? VIP_ICONS[Math.floor(Math.random() * VIP_ICONS.length)]
      : PASSENGER_ICONS[Math.floor(Math.random() * PASSENGER_ICONS.length)]
  };

  floorPassengers[floor].push(p);
  renderFloorPassengers(floor);
}

function randomDest(from) {
  // 上層階発は1F行きが出やすい（帰宅ラッシュ風）
  if (from !== 1 && Math.random() < LOBBY_BIAS) return 1;
  let d;
  do {
    d = Math.floor(Math.random() * FLOORS) + 1;
  } while (d === from);
  return d;
}

function tickStress() {
  if (!isRunning) return;

  for (let f = 1; f <= FLOORS; f++) {
    const leaving = [];

    floorPassengers[f].forEach(p => {
      p.stress += STRESS_TICK_MS;
      if (p.stress >= p.maxStress) leaving.push(p);
    });

    // 待たせすぎた客は怒って帰る＝ミス
    if (leaving.length) {
      const leavingIds = new Set(leaving.map(p => p.id));
      floorPassengers[f] = floorPassengers[f].filter(p => !leavingIds.has(p.id));
      renderFloorPassengers(f);
      addMiss(f, leaving.length);
    }

    // チップは作り直さず、ストレスバーと状態クラスだけ更新する
    floorPassengers[f].slice(0, MAX_VISIBLE_PER_FLOOR).forEach(updatePaxChip);
  }
}

/* ───────────── 描画：建物の待ち客 ─────────────
   innerHTMLでの全再構築は出現アニメーションの再生や
   降車アニメ用チップの破棄を毎tick引き起こすため、
   チップ要素は客ごとに使い回し、増減した分だけDOMを更新する */

// 行き先階を表示して「まとめて運ぶ」判断材料にする
function createPaxChip(p) {
  const dir = paxDir(p);
  const chip = document.createElement('div');
  chip.className = `pax-chip${p.isVip ? ' vip' : ''}`;
  chip.id = `chip-${p.id}`;
  chip.innerHTML = `
    <span class="pax-icon">${p.icon}</span>
    <div class="dest-badge ${dir > 0 ? 'up' : 'down'}">${p.dest}F</div>
    <div class="stress-bar"><div class="stress-fill"></div></div>
  `;
  return chip;
}

function updatePaxChip(p) {
  const chip = document.getElementById(`chip-${p.id}`);
  if (!chip) return;

  const pct = Math.min(100, (p.stress / p.maxStress) * 100);
  chip.querySelector('.stress-fill').style.width = `${pct}%`;
  chip.classList.toggle('stressed', pct >= 55 && pct < 70);
  chip.classList.toggle('angry', pct >= 70);
  chip.classList.toggle('raging', pct >= 90);
}

function renderFloorPassengers(floor) {
  const fp = document.getElementById(`fp-${floor}`);
  if (!fp) return;

  const passengers = floorPassengers[floor] || [];
  const visible = passengers.slice(0, MAX_VISIBLE_PER_FLOOR);
  const visibleIds = new Set(visible.map(p => `chip-${p.id}`));

  // いなくなった客のチップだけ取り除く（降車アニメ用チップは対象外）
  for (const el of Array.from(fp.children)) {
    if (el.classList.contains('drop-anim-chip')) continue;
    if (el.classList.contains('floor-wait-more')) { el.remove(); continue; }
    if (!visibleIds.has(el.id)) el.remove();
  }

  // 新しく見える客のチップを末尾に追加（配列は到着順なので順序が保たれる）
  visible.forEach(p => {
    if (!document.getElementById(`chip-${p.id}`)) {
      fp.appendChild(createPaxChip(p));
    }
    updatePaxChip(p);
  });

  const hiddenCount = passengers.length - visible.length;
  if (hiddenCount > 0) {
    const more = document.createElement('div');
    more.className = 'floor-wait-more';
    more.textContent = `+${hiddenCount}`;
    fp.appendChild(more);
  }
}

/* ───────────── 描画：行き先マーカー・号機カード ───────────── */

// シャフト上に「その号機がどこへ向かっているか」を常時表示する
function updateTargetMarker(e) {
  const t = e.pendingTarget != null ? e.pendingTarget : e.target;
  for (let f = 1; f <= FLOORS; f++) {
    const cell = document.getElementById(`cell-${e.i}-${f}`);
    if (cell) cell.classList.toggle('target', t === f);
  }
  document.getElementById(`elv-target-${e.i}`).textContent = t != null ? `▸${t}` : '';
}

function renderCard(e, opts = {}) {
  const entering = new Set(opts.entering || []);
  const slots = document.getElementById(`card-slots-${e.i}`);
  let html = '';

  for (let i = 0; i < MAX_CAPACITY; i++) {
    const p = e.pax[i];
    if (p) {
      const cls = entering.has(p.id) ? ' entering' : '';
      html += `
        <div class="card-slot filled${p.isVip ? ' vip' : ''}${cls}">
          <div class="cs-icon">${p.icon}</div>
          <div class="cs-dest">${p.dest}F</div>
        </div>`;
    } else {
      html += `<div class="card-slot empty"></div>`;
    }
  }
  slots.innerHTML = html;

  const cap = document.getElementById(`card-cap-${e.i}`);
  cap.textContent = `${e.pax.length} / ${MAX_CAPACITY}`;
  cap.classList.toggle('full', e.pax.length >= MAX_CAPACITY);

  const dirEl = document.getElementById(`card-dir-${e.i}`);
  dirEl.classList.remove('up', 'down', 'none');
  if (e.state === 'moving' && e.dir > 0) { dirEl.textContent = '▲ 上り'; dirEl.classList.add('up'); }
  else if (e.state === 'moving' && e.dir < 0) { dirEl.textContent = '▼ 下り'; dirEl.classList.add('down'); }
  else if (e.state === 'doors') { dirEl.textContent = '🚪 乗降'; dirEl.classList.add('none'); }
  else { dirEl.textContent = '停車'; dirEl.classList.add('none'); }
}

function setStatus(e, txt) {
  document.getElementById(`card-status-${e.i}`).textContent = txt;
}

/* ───────────── 演出 ───────────── */

// 降車があった号機を一瞬光らせる
function flashElevator(e) {
  const el = document.getElementById(`elv-${e.i}`);
  el.classList.remove('flash');
  void el.offsetWidth; // reflow でアニメーション再生
  el.classList.add('flash');
}

// 建物内の該当階の横に得点ポップを出す。コンボが乗るほど派手になる
function showFloorPop(floor, mainTxt, subTxt, isMiss = false, comboLv = 0) {
  const outer = document.getElementById('building-outer');
  const pop = document.createElement('div');
  pop.className = 'floor-pop' + (isMiss ? ' miss' : '');
  if (!isMiss) {
    if (comboLv >= 8) pop.classList.add('pop-lv3');
    else if (comboLv >= 4) pop.classList.add('pop-lv2');
  }
  pop.innerHTML = subTxt
    ? `<span class="fp-main">${mainTxt}</span><span class="fp-sub">${subTxt}</span>`
    : `<span class="fp-main">${mainTxt}</span>`;
  pop.style.top = `${(FLOORS - floor) * FLOOR_H + 4}px`;
  outer.appendChild(pop);
  setTimeout(() => pop.remove(), 1000);
}

/* ───────────── 起動 ───────────── */

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('retry-btn').addEventListener('click', startGame);

buildShaftCells();
showStart();
