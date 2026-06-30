const canvas = document.getElementById("cakeCanvas");
const ctx = canvas.getContext("2d");

const judgeButton = document.getElementById("judgeButton");
const clearButton = document.getElementById("clearButton");
const undoButton = document.getElementById("undoButton");

const resultCard = document.getElementById("resultCard");
const rankBadge = document.getElementById("rankBadge");
const balanceScore = document.getElementById("balanceScore");
const delinquencyScore = document.getElementById("delinquencyScore");
const areaCount = document.getElementById("areaCount");
const cutCountDisplay = document.getElementById("cutCount");
const resultCutCount = document.getElementById("resultCutCount");
const areaList = document.getElementById("areaList");
const comment = document.getElementById("comment");

const STROKE_WIDTH = 12;
const MIN_CUT_PATH_LENGTH = STROKE_WIDTH * 1.5;
const MIN_CUT_EXTENT = STROKE_WIDTH;
const ANALYZE_SIZE = 360;

// 0.15%未満のエリアは、線の隙間などで発生した微小ノイズとして無視する
const NOISE_AREA_PERCENT_THRESHOLD = 0.15;

// 番号ラベル配置用の定数
// ANALYZE_SIZE上の座標で扱う
const LABEL_CLEARANCE_MAX = 34;
const LABEL_CLEARANCE_STEP = 2;
const LABEL_MIN_DISTANCE = 36;

let dpr = window.devicePixelRatio || 1;
let canvasSize = 560;
let strokes = [];
let currentStroke = null;
let isDrawing = false;
let cutCount = 0;
let resultOverlay = null;
let resultLabels = [];
let resultIsPerfect = false;

const regionColors = [
    [255, 83, 83, 135],
    [49, 145, 255, 135],
    [45, 190, 92, 135],
    [255, 184, 42, 145],
    [156, 102, 255, 135],
    [255, 92, 181, 135],
    [24, 196, 187, 135],
    [178, 111, 50, 135],
    [90, 90, 90, 135],
    [255, 128, 64, 135],
    [91, 111, 255, 135],
    [115, 190, 40, 135]
];

function setupCanvas() {
    const previousSize = canvasSize;
    const rect = canvas.getBoundingClientRect();
    canvasSize = Math.max(280, Math.floor(rect.width));
    dpr = window.devicePixelRatio || 1;

    // リサイズ時に、描いた線の相対位置が崩れないようにする
    if (previousSize && previousSize !== canvasSize) {
        const ratio = canvasSize / previousSize;
        scaleStrokes(ratio);
    }

    canvas.width = Math.floor(canvasSize * dpr);
    canvas.height = Math.floor(canvasSize * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawAll();
}

function scaleStrokes(ratio) {
    const scaleStroke = (stroke) => {
        if (!stroke) return stroke;
        return stroke.map((point) => ({
            x: point.x * ratio,
            y: point.y * ratio
        }));
    };

    strokes = strokes.map(scaleStroke);

    if (currentStroke) {
        currentStroke = scaleStroke(currentStroke);
    }
}

function getCakeGeometry(size = canvasSize) {
    const center = size / 2;
    const radius = size * 0.39;
    return { center, radius };
}

function drawAll() {
    ctx.clearRect(0, 0, canvasSize, canvasSize);
    drawCakeBase();

    if (resultOverlay) {
        ctx.drawImage(resultOverlay, 0, 0, canvasSize, canvasSize);
    }

    drawStrokes();
    drawAreaLabels();
    drawPerfectEffect();
}

function drawCakeBase() {
    const { center, radius } = getCakeGeometry();

    ctx.save();

    ctx.fillStyle = "#fffdf9";
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#ffe3b3";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#c89858";
    ctx.stroke();

    ctx.restore();
}

function drawStrokes() {
    ctx.save();
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#6b3d20";

    for (const stroke of strokes) {
        drawStrokePath(ctx, stroke);
    }

    if (currentStroke) {
        drawStrokePath(ctx, currentStroke);
    }

    ctx.restore();
}

function drawStrokePath(targetCtx, stroke) {
    if (!stroke || stroke.length < 2) return;

    targetCtx.beginPath();
    targetCtx.moveTo(stroke[0].x, stroke[0].y);

    for (let i = 1; i < stroke.length; i++) {
        targetCtx.lineTo(stroke[i].x, stroke[i].y);
    }

    targetCtx.stroke();
}

function getStrokeMetrics(stroke) {
    if (!stroke || stroke.length < 2) {
        return { pathLength: 0, extent: 0 };
    }

    let pathLength = 0;
    let minX = stroke[0].x;
    let minY = stroke[0].y;
    let maxX = stroke[0].x;
    let maxY = stroke[0].y;

    for (let i = 1; i < stroke.length; i++) {
        const point = stroke[i];
        const previousPoint = stroke[i - 1];

        pathLength += Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y);
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    }

    return {
        pathLength,
        extent: Math.hypot(maxX - minX, maxY - minY)
    };
}

function isCountableStroke(stroke) {
    const metrics = getStrokeMetrics(stroke);
    return metrics.pathLength >= MIN_CUT_PATH_LENGTH && metrics.extent >= MIN_CUT_EXTENT;
}

function distancePointToSegment(point, segmentStart, segmentEnd) {
    const dx = segmentEnd.x - segmentStart.x;
    const dy = segmentEnd.y - segmentStart.y;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
        return Math.hypot(point.x - segmentStart.x, point.y - segmentStart.y);
    }

    let t = ((point.x - segmentStart.x) * dx + (point.y - segmentStart.y) * dy) / lengthSquared;
    t = Math.min(1, Math.max(0, t));

    return Math.hypot(
        point.x - (segmentStart.x + dx * t),
        point.y - (segmentStart.y + dy * t)
    );
}

// 線がケーキ（円）に触れているか。線の太さの分だけ判定を広げる
function strokeTouchesCake(stroke) {
    if (!stroke || stroke.length < 2) return false;

    const { center, radius } = getCakeGeometry();
    const centerPoint = { x: center, y: center };
    const reach = radius + STROKE_WIDTH / 2;

    for (let i = 1; i < stroke.length; i++) {
        if (distancePointToSegment(centerPoint, stroke[i - 1], stroke[i]) <= reach) {
            return true;
        }
    }

    return false;
}

function updateCutCount() {
    // ケーキに触れていない線（円の外の落書き）はカット回数に入れない
    cutCount = strokes.filter(strokeTouchesCake).length;
    const text = `${cutCount}回`;

    if (cutCountDisplay) {
        cutCountDisplay.textContent = text;
    }

    if (resultCutCount) {
        resultCutCount.textContent = text;
    }
}

function drawAreaLabels() {
    if (!resultLabels.length) return;

    const scale = canvasSize / ANALYZE_SIZE;

    for (const label of resultLabels) {
        const x = label.x * scale;
        const y = label.y * scale;
        const radius = Math.max(17, canvasSize * 0.035);

        ctx.save();

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = label.cssColor;
        ctx.fill();

        ctx.lineWidth = 2;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.font = `700 ${Math.max(16, canvasSize * 0.04)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(label.number), x, y + 1);

        ctx.restore();
    }
}

function drawPerfectEffect() {
    if (!resultIsPerfect) return;

    const { center, radius } = getCakeGeometry();
    const textY = Math.max(30, center - radius - canvasSize * 0.045);

    ctx.save();

    ctx.font = `700 ${Math.max(22, canvasSize * 0.055)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#c96f4a";
    ctx.fillText("PERFECT!", center, textY);

    ctx.restore();
}

function getPointerPosition(event) {
    const rect = canvas.getBoundingClientRect();

    return {
        x: ((event.clientX - rect.left) / rect.width) * canvasSize,
        y: ((event.clientY - rect.top) / rect.height) * canvasSize
    };
}

function clearResultDisplay() {
    resultOverlay = null;
    resultLabels = [];
    resultIsPerfect = false;
    resultCard.classList.remove("perfect");
    resultCard.classList.add("hidden");
}

function startDrawing(event) {
    // マウスは左クリックのみ受け付ける（右クリック等では描かない）。
    // タッチ・ペンは button が 0 以外（-1 など）になる環境があるため弾かない。
    if (event.pointerType === "mouse" && event.button !== 0) return;

    event.preventDefault();

    isDrawing = true;
    canvas.setPointerCapture(event.pointerId);
    const point = getPointerPosition(event);
    currentStroke = [point];

    drawAll();
}

function continueDrawing(event) {
    if (!isDrawing || !currentStroke) return;
    event.preventDefault();

    const point = getPointerPosition(event);
    const lastPoint = currentStroke[currentStroke.length - 1];
    const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);

    if (distance >= 2) {
        // クリックしただけでは判定結果を消さず、実際に線を引き始めた時点で消す
        if (currentStroke.length === 1) {
            clearResultDisplay();
        }

        currentStroke.push(point);
        drawAll();
    }
}

function endDrawing(event) {
    if (!isDrawing) return;
    event.preventDefault();

    isDrawing = false;

    if (isCountableStroke(currentStroke)) {
        strokes.push(currentStroke);
        updateCutCount();
    }

    currentStroke = null;

    try {
        canvas.releasePointerCapture(event.pointerId);
    } catch {
        // pointer capture がない環境でも処理を止めない
    }

    drawAll();
}

function clearCanvas() {
    strokes = [];
    currentStroke = null;
    updateCutCount();
    clearResultDisplay();
    drawAll();
}

function undoStroke() {
    strokes.pop();
    updateCutCount();
    clearResultDisplay();
    drawAll();
}

function analyzeCake() {
    const offscreen = document.createElement("canvas");
    offscreen.width = ANALYZE_SIZE;
    offscreen.height = ANALYZE_SIZE;

    const offCtx = offscreen.getContext("2d", { willReadFrequently: true });
    const scale = ANALYZE_SIZE / canvasSize;
    const { center, radius } = getCakeGeometry(ANALYZE_SIZE);

    offCtx.clearRect(0, 0, ANALYZE_SIZE, ANALYZE_SIZE);

    offCtx.save();
    offCtx.scale(scale, scale);
    offCtx.lineWidth = STROKE_WIDTH;
    offCtx.lineCap = "round";
    offCtx.lineJoin = "round";
    offCtx.strokeStyle = "#000000";

    for (const stroke of strokes) {
        drawStrokePath(offCtx, stroke);
    }

    offCtx.restore();

    const imageData = offCtx.getImageData(0, 0, ANALYZE_SIZE, ANALYZE_SIZE);
    const data = imageData.data;

    const totalPixels = ANALYZE_SIZE * ANALYZE_SIZE;
    const visited = new Uint8Array(totalPixels);
    const wall = new Uint8Array(totalPixels);
    const inside = new Uint8Array(totalPixels);
    const regionMap = new Int32Array(totalPixels);
    regionMap.fill(-1);

    for (let y = 0; y < ANALYZE_SIZE; y++) {
        for (let x = 0; x < ANALYZE_SIZE; x++) {
            const index = y * ANALYZE_SIZE + x;
            const dx = x - center;
            const dy = y - center;
            const isInsideCircle = dx * dx + dy * dy <= radius * radius;

            if (!isInsideCircle) continue;

            inside[index] = 1;

            const alpha = data[index * 4 + 3];
            if (alpha > 20) {
                wall[index] = 1;
            }
        }
    }

    const rawRegions = findRegions(inside, wall, visited, regionMap);
    rawRegions.sort((a, b) => b.pixels - a.pixels);

    const rawAreaPixels = rawRegions.reduce((sum, region) => sum + region.pixels, 0);
    const regions = filterNoiseRegions(rawRegions, rawAreaPixels);
    regions.sort((a, b) => b.pixels - a.pixels);

    const validAreaPixels = regions.reduce((sum, region) => sum + region.pixels, 0);
    const regionIdToRank = new Map();

    regions.forEach((region, index) => {
        regionIdToRank.set(region.id, index);
    });

    const overlay = createRegionOverlay(regionMap, regionIdToRank);
    const labels = createSmartLabels(regions, regionMap);
    const labelByRegionId = new Map();

    labels.forEach((label) => {
        labelByRegionId.set(label.regionId, label);
    });

    const areas = regions.map((region, index) => {
        const percentage = validAreaPixels === 0 ? 0 : (region.pixels / validAreaPixels) * 100;
        const color = regionColors[index % regionColors.length];
        const label = labelByRegionId.get(region.id);

        return {
            number: index + 1,
            percentage,
            color,
            cssColor: toCssColor(color),
            centerX: label ? label.x : region.centroidX,
            centerY: label ? label.y : region.centroidY
        };
    });

    const isPerfect = isPerfectResult(areas);
    const delinquency = isPerfect ? 0 : calculateDelinquency(areas);
    const balance = Math.max(0, 100 - delinquency);
    const rank = getRank(delinquency, isPerfect);
    const resultComment = getComment(delinquency, areas.length, isPerfect);

    return {
        areas,
        labels,
        overlay,
        delinquency,
        balance,
        rank,
        cutCount,
        comment: resultComment,
        isPerfect
    };
}

function filterNoiseRegions(regions, rawAreaPixels) {
    if (!rawAreaPixels) return [];

    return regions.filter((region) => {
        const percentage = (region.pixels / rawAreaPixels) * 100;
        return percentage >= NOISE_AREA_PERCENT_THRESHOLD;
    });
}

function findRegions(inside, wall, visited, regionMap) {
    const regions = [];
    const directions = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
    ];

    for (let y = 0; y < ANALYZE_SIZE; y++) {
        for (let x = 0; x < ANALYZE_SIZE; x++) {
            const startIndex = y * ANALYZE_SIZE + x;

            if (!inside[startIndex] || wall[startIndex] || visited[startIndex]) {
                continue;
            }

            const regionId = regions.length;
            const queue = [startIndex];
            visited[startIndex] = 1;

            let count = 0;
            let sumX = 0;
            let sumY = 0;
            let minX = x;
            let maxX = x;
            let minY = y;
            let maxY = y;
            let cursor = 0;

            while (cursor < queue.length) {
                const current = queue[cursor++];
                const cx = current % ANALYZE_SIZE;
                const cy = Math.floor(current / ANALYZE_SIZE);

                count++;
                sumX += cx;
                sumY += cy;
                minX = Math.min(minX, cx);
                maxX = Math.max(maxX, cx);
                minY = Math.min(minY, cy);
                maxY = Math.max(maxY, cy);

                regionMap[current] = regionId;

                for (const [dx, dy] of directions) {
                    const nx = cx + dx;
                    const ny = cy + dy;

                    if (nx < 0 || ny < 0 || nx >= ANALYZE_SIZE || ny >= ANALYZE_SIZE) {
                        continue;
                    }

                    const nextIndex = ny * ANALYZE_SIZE + nx;

                    if (
                        inside[nextIndex] &&
                        !wall[nextIndex] &&
                        !visited[nextIndex]
                    ) {
                        visited[nextIndex] = 1;
                        queue.push(nextIndex);
                    }
                }
            }

            regions.push({
                id: regionId,
                pixels: count,
                centroidX: sumX / count,
                centroidY: sumY / count,
                minX,
                maxX,
                minY,
                maxY
            });
        }
    }

    return regions;
}

function createRegionOverlay(regionMap, regionIdToRank) {
    const overlay = document.createElement("canvas");
    overlay.width = ANALYZE_SIZE;
    overlay.height = ANALYZE_SIZE;

    const overlayCtx = overlay.getContext("2d");
    const overlayImage = overlayCtx.createImageData(ANALYZE_SIZE, ANALYZE_SIZE);
    const overlayData = overlayImage.data;

    for (let i = 0; i < regionMap.length; i++) {
        const regionId = regionMap[i];
        if (regionId < 0) continue;
        if (!regionIdToRank.has(regionId)) continue;

        const rank = regionIdToRank.get(regionId);
        const color = regionColors[rank % regionColors.length];

        overlayData[i * 4] = color[0];
        overlayData[i * 4 + 1] = color[1];
        overlayData[i * 4 + 2] = color[2];
        overlayData[i * 4 + 3] = color[3];
    }

    overlayCtx.putImageData(overlayImage, 0, 0);

    return overlay;
}

function createSmartLabels(regions, regionMap) {
    const labels = [];

    regions.forEach((region, index) => {
        const color = regionColors[index % regionColors.length];
        const labelPoint = findBestLabelPoint(region, regionMap, labels);

        labels.push({
            regionId: region.id,
            number: index + 1,
            x: labelPoint.x,
            y: labelPoint.y,
            cssColor: toCssColor(color)
        });
    });

    return labels;
}

function findBestLabelPoint(region, regionMap, existingLabels) {
    // 面積が大きいエリアは粗めに、小さいエリアは細かく探索する
    const step = getLabelSearchStep(region.pixels);

    let bestPoint = null;
    let bestScore = -Infinity;

    for (let y = region.minY; y <= region.maxY; y += step) {
        for (let x = region.minX; x <= region.maxX; x += step) {
            const index = y * ANALYZE_SIZE + x;

            if (regionMap[index] !== region.id) {
                continue;
            }

            const score = scoreLabelCandidate(x, y, region, regionMap, existingLabels);

            if (score > bestScore) {
                bestScore = score;
                bestPoint = { x, y };
            }
        }
    }

    // 粗い探索で見つからない場合の保険
    if (!bestPoint) {
        bestPoint = findFallbackLabelPoint(region, regionMap);
    }

    return bestPoint;
}

function getLabelSearchStep(pixelCount) {
    if (pixelCount < 800) return 1;
    if (pixelCount < 3000) return 2;
    if (pixelCount < 12000) return 3;
    return 4;
}

function scoreLabelCandidate(x, y, region, regionMap, existingLabels) {
    const clearance = estimateRegionClearance(x, y, region.id, regionMap);
    const labelDistanceScore = getLabelDistanceScore(x, y, existingLabels);
    const centroidDistance = Math.hypot(x - region.centroidX, y - region.centroidY);
    const bboxCenterX = (region.minX + region.maxX) / 2;
    const bboxCenterY = (region.minY + region.maxY) / 2;
    const bboxCenterDistance = Math.hypot(x - bboxCenterX, y - bboxCenterY);

    // clearance:
    //   線や外周、他エリアからどれだけ離れているか。
    //   ◎の外側エリアでは、中心ではなくドーナツ部分の真ん中が高得点になりやすい。
    //
    // labelDistanceScore:
    //   すでに置いた番号からどれだけ離れているか。
    //   内包エリアの番号と重なりにくくするためにかなり強めに効かせる。
    //
    // centroidDistance:
    //   平均座標から遠すぎる場所を少しだけ避ける。
    //   ただし◎では平均座標が破綻しやすいので、弱めにしている。
    //
    // bboxCenterDistance:
    //   エリアの外接矩形の中心から遠すぎる場所を少しだけ避ける。
    //   これも弱め。
    return (
        clearance * 18 +
        labelDistanceScore * 3.2 -
        centroidDistance * 0.035 -
        bboxCenterDistance * 0.015
    );
}

function estimateRegionClearance(x, y, regionId, regionMap) {
    let bestRadius = 0;

    for (let radius = LABEL_CLEARANCE_STEP; radius <= LABEL_CLEARANCE_MAX; radius += LABEL_CLEARANCE_STEP) {
        if (isCircleAroundPointInsideRegion(x, y, radius, regionId, regionMap)) {
            bestRadius = radius;
        } else {
            break;
        }
    }

    return bestRadius;
}

function isCircleAroundPointInsideRegion(x, y, radius, regionId, regionMap) {
    // 多めにサンプルして、境界や他エリアに近い場所を避ける
    const samples = 16;

    for (let i = 0; i < samples; i++) {
        const angle = (Math.PI * 2 * i) / samples;
        const px = Math.round(x + Math.cos(angle) * radius);
        const py = Math.round(y + Math.sin(angle) * radius);

        if (px < 0 || py < 0 || px >= ANALYZE_SIZE || py >= ANALYZE_SIZE) {
            return false;
        }

        const index = py * ANALYZE_SIZE + px;

        if (regionMap[index] !== regionId) {
            return false;
        }
    }

    return true;
}

function getLabelDistanceScore(x, y, existingLabels) {
    if (!existingLabels.length) {
        return LABEL_MIN_DISTANCE * 2;
    }

    let nearestDistance = Infinity;

    for (const label of existingLabels) {
        const distance = Math.hypot(x - label.x, y - label.y);
        nearestDistance = Math.min(nearestDistance, distance);
    }

    if (nearestDistance < LABEL_MIN_DISTANCE) {
        // 被りそうな場所はかなり強く減点
        return nearestDistance - (LABEL_MIN_DISTANCE - nearestDistance) * 5;
    }

    return Math.min(nearestDistance, LABEL_MIN_DISTANCE * 2);
}

function findFallbackLabelPoint(region, regionMap) {
    let bestPoint = null;
    let bestDistance = Infinity;

    for (let y = region.minY; y <= region.maxY; y++) {
        for (let x = region.minX; x <= region.maxX; x++) {
            const index = y * ANALYZE_SIZE + x;

            if (regionMap[index] !== region.id) {
                continue;
            }

            const distance = Math.hypot(x - region.centroidX, y - region.centroidY);

            if (distance < bestDistance) {
                bestDistance = distance;
                bestPoint = { x, y };
            }
        }
    }

    return bestPoint || {
        x: region.centroidX,
        y: region.centroidY
    };
}

function calculateDelinquency(areas) {
    if (areas.length !== 3) {
        return 100;
    }

    const ideal = 100 / 3;
    const totalDeviation = areas.reduce((sum, area) => {
        return sum + Math.abs(area.percentage - ideal);
    }, 0);

    return clamp(Math.round((totalDeviation / 133.333) * 100), 0, 100);
}

function isPerfectResult(areas) {
    if (areas.length !== 3) {
        return false;
    }

    // 厳しめ条件：
    // 実際の内部値ではなく、画面表示と同じ小数1桁表示で
    // 33.3 / 33.3 / 33.3 が揃ったときだけパーフェクト。
    return areas.every((area) => area.percentage.toFixed(1) === "33.3");
}

function getRank(delinquency, isPerfect = false) {
    if (isPerfect) return "SSS";
    if (delinquency <= 5) return "S";
    if (delinquency <= 15) return "A";
    if (delinquency <= 30) return "B";
    if (delinquency <= 55) return "C";
    return "D";
}

function getComment(delinquency, count, isPerfect = false) {
    if (isPerfect) {
        return "33.3%が3つ。文句のつけようがない3等分です。";
    }

    if (count !== 3) {
        return getWrongAreaCountComment(count);
    }

    if (delinquency <= 5) {
        return "ほぼ完璧です。あなたが切れば、ケーキの前はいつも平和です。";
    }

    if (delinquency <= 15) {
        return "きれいな3等分です。これなら誰も文句を言いません。";
    }

    if (delinquency <= 30) {
        return "3等分です。ただ、よく見ると少しだけ個性が出ています。";
    }

    if (delinquency <= 55) {
        return "大・中・小が揃いました。取る順番はじゃんけんで決めてください。";
    }

    return "3つに分かれてはいますが、もう等分とは呼べません。切り直しをおすすめします。";
}

function getWrongAreaCountComment(count) {
    if (count === 0) {
        return "エリアが見つかりません。まずはケーキに線を引いてみてください。";
    }

    if (count === 1) {
        return "まだ1つのままです。線がケーキを端から端まで横切っていないようです。";
    }

    if (count === 2) {
        return "2等分です。きれいですが、お題は3等分です。";
    }

    if (count === 4) {
        return "4等分です。1つ多い。お題は3等分です。";
    }

    if (count >= 8) {
        return `${count}個に分かれました。もはやみじん切りです。`;
    }

    return `${count}等分です。お題の「3」をもう一度思い出してください。`;
}

function showResult(result) {
    resultOverlay = result.overlay;
    resultLabels = result.labels;
    resultIsPerfect = result.isPerfect;
    drawAll();

    resultCard.classList.remove("hidden");
    resultCard.classList.toggle("perfect", result.isPerfect);

    rankBadge.textContent = result.rank;
    balanceScore.textContent = `${result.balance}%`;
    delinquencyScore.textContent = `${result.delinquency}%`;
    areaCount.textContent = `${result.areas.length}個`;
    resultCutCount.textContent = `${result.cutCount}回`;
    comment.textContent = result.comment;

    if (result.areas.length !== 3) {
        comment.classList.add("danger");
    } else {
        comment.classList.remove("danger");
    }

    areaList.innerHTML = "";

    result.areas.forEach((area) => {
        const li = document.createElement("li");

        const number = document.createElement("span");
        number.className = "area-number";
        number.textContent = area.number;
        number.style.backgroundColor = area.cssColor;

        const text = document.createElement("span");
        text.className = "area-text";
        text.textContent = `エリア${area.number}`;

        const percent = document.createElement("span");
        percent.className = "area-percent";
        percent.textContent = `${area.percentage.toFixed(1)}%`;

        li.appendChild(number);
        li.appendChild(text);
        li.appendChild(percent);
        areaList.appendChild(li);
    });

    if (result.areas.length === 0) {
        const li = document.createElement("li");
        li.textContent = "エリアを検出できませんでした。";
        areaList.appendChild(li);
    }

    resultCard.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
    });
}

function judge() {
    const result = analyzeCake();
    showResult(result);
}

function toCssColor(color) {
    return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3] / 255})`;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

canvas.addEventListener("pointerdown", startDrawing);
canvas.addEventListener("pointermove", continueDrawing);
canvas.addEventListener("pointerup", endDrawing);
canvas.addEventListener("pointercancel", endDrawing);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
canvas.addEventListener("pointerleave", (event) => {
    if (isDrawing) {
        endDrawing(event);
    }
});

judgeButton.addEventListener("click", judge);
clearButton.addEventListener("click", clearCanvas);
undoButton.addEventListener("click", undoStroke);

window.addEventListener("resize", () => {
    setupCanvas();
});

setupCanvas();
