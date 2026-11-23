/* =========================================================
   ③ あわあわ潜水艇 — ワンボタン距離チャレンジ（3コース制）
   スペース（またはクリック）を おしている間 浮上、はなすと 沈む。
   - 潜水艇は自動で右へ進む。距離（m）がスコア
   - コースは easy(やさしい海) / normal(ふしぎな洞窟) / hard(深海チャレンジ)
   - 地形は「通路の中心線」を傾きの上限つきで作り、通れる幅を常に確保（完全ランダムにしない）
   - ?seed=123 で地形を固定（テスト用）。通常は毎回ランダム
   - テスト用: Arcade.debug.game._test
   - R4: 深海チャレンジ(hard)は 1000m ごとの エリア制（HARD_AREAS）。エリアが かわるたびに 一段 むずかしくなり、
     エリア2〜5 で 新しい しかけが 1つずつ（あべこべ海流・うずまき・さかなの むれ・おちてくる岩）、
     エリア6〜（5000m〜）は カオスゾーン（ぜんぶ まぜる・じぐざぐ・とげとげ・くらい海）。9000m までは かならず通れる広さ、10000m 付近から 通れない所が 出てくる（無限には 進めない）
     やさしい海 / ふしぎな洞窟 と、深海チャレンジの エリア1（〜1000m）は 何も変えていない（乱数の使いかたも同じ）
   ========================================================= */
(function () {
  'use strict';

  const A = window.Arcade;

  /* ================= 定数 ================= */
  const W = 1920, H = 1080, STEP = 1 / 120;
  const SURF_Y = 96;             // 海面（これより上に出るとアウト）
  const SUB_X = 520;             // 画面上の潜水艇の x（左 1/4 くらい）
  const PX_PER_M = 50;           // 50px = 1m
  const SAMPLE = 16;             // 地形のサンプル間隔(px)
  const X0 = -1600;              // 地形の最初のサンプルの x
  const OPEN_TOP = -300;         // 「天井なし」（開けた海）
  const TOP_MIN = 160, BOT_MAX = 1010; // 洞窟の天井/床が動ける範囲

  // 物理（単位: px, 秒）。目標速度に「加速度の上限つき」で近づく = なめらかな慣性
  // ※ 操作感は R1 から変えない（3コース共通）
  const PHYS = {
    up: 400,        // おしている間の目標上昇速度
    down: 360,      // はなしている間の目標沈下速度
    vmax: 620,      // 上下速度の上限
    k: 5.5,         // 目標速度への追従の速さ（大きいほど慣性が弱い）
    amax: 2600,     // 加速度の上限
    updraft: 420,   // 泡の上昇流：目標速度を上へずらす量（はなすと -60 = ふわっと浮く）
    current: 280,   // 下向きの海流：目標速度を下へずらす量（おしても -120 = ゆっくり）
    edge: 90,       // 流れの入口/出口でなめらかに強さが変わる幅
  };

  // 当たり判定（見た目より小さめ・やさしめ）
  const SUBC = [[-40, 4, 36], [0, 0, 42], [40, 4, 36]];  // 潜水艇: 円3つ [dx, dy, r]
  const SUB_HW = 76;                                     // 判定の半幅
  const JB_DY = -16, JB_R = 40, JT_DY = 50, JT_R = 24;   // クラゲ: かさ と 足
  const J_UP = 56, J_DN = 74;                            // クラゲの判定の上下の広がり
  const J_SPAN = J_UP + J_DN;                            // クラゲの判定の高さ（振れ幅は別）
  const ROCK_HIT = 0.86;                                 // 岩: 見た目の半径に対する判定の割合
  // R4 の しかけ
  const VORT_RC = 44, VORT_R = 300;                      // うず: まん中（当たる）の半径 / すいこむ範囲
  const FISH_RF = 24, FISH_ROW = 17, FISH_WIG = 8;       // さかな: 1ぴきの判定 / 2列の上下の はなれ / ゆれ
  const FISH_LH = FISH_ROW + FISH_WIG + FISH_RF;         // さかなの むれの 帯の 半分の太さ（判定）
  const FISH_SP = 72;                                    // さかなの 前後の間隔

  /* ================= 小さな道具 ================= */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { return 0.5 - 0.5 * Math.cos(Math.PI * t); }
  function mod(a, n) { return ((a % n) + n) % n; }
  function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  // [[x,値],...] を なめらかに つなぐ（距離 x に対する難易度カーブ）
  function curve(pts, x) {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (x <= b[0]) return lerp(a[1], b[1], smooth((x - a[0]) / Math.max(1, b[0] - a[0])));
    }
    return pts[pts.length - 1][1];
  }

  /* =========================================================
     コース（1-1 / 1-2 / 1-3）
     すべて「距離 x(px) に対するカーブ」と「ステージ表」で性格を決める。50px = 1m
     need: そのステージで 必ず 1回は出す種類（初登場の順番）
     w   : 重み（同じ種類の連続は避ける。cave だけ例外）
     ========================================================= */
  const COURSES = {
    // ① やさしい海 — R1 の難易度を維持。広い海から はじまり、ギミックを 1つずつ覚える
    easy: {
      id: 'easy', badge: '1-1', label: 'やさしい海', short: 'やさしい', tag: 'しょきゅう', col: '#19a0cc',
      openStart: 2000, openEnd: 7200, caveLen: 2200, caveC: 560, progEnd: 40000,
      speed: [[0, 360], [15000, 360], [30000, 450], [50000, 530], [85000, 600]],
      gap: [[0, 640], [7200, 640], [16200, 488], [25000, 425], [40000, 365], [62000, 325], [95000, 302]],
      slope: [[0, 0.13], [7200, 0.13], [16200, 0.18], [25000, 0.20], [40000, 0.245], [62000, 0.27], [95000, 0.29]],
      clear: [[0, 380], [22000, 370], [40000, 325], [62000, 298], [95000, 280]],
      jAmp: [[0, 50], [24000, 58], [44000, 76], [80000, 84]],
      jPer: [[0, 4.2], [24000, 3.9], [44000, 3.2], [80000, 2.9]],
      rAmp: [[0, 0]], rPer: [[0, 3.6]],
      stages: [
        { until: 16200, need: ['up'], w: { cave: 0.9, up: 1.0 } },
        { until: 27000, need: ['down', 'jelly'], w: { cave: 0.8, up: 0.9, down: 1.1, jelly: 1.3 } },
        { until: 45000, need: ['rock'], w: { cave: 0.6, up: 0.8, down: 0.8, jelly: 0.9, rock: 1.0, jelly2: 0.4, upRock: 0.5, downJelly: 0.5 } },
        { until: 1e9, need: [], w: { cave: 0.5, up: 0.7, down: 0.7, jelly: 0.8, rock: 0.9, rock3: 0.8, jelly2: 0.8, upRock: 0.9, downJelly: 0.9 } },
      ],
      demoX: 8600,
    },
    // ② ふしぎな洞窟 — すぐ洞窟。上下にゆれるクラゲ＋2つの組み合わせが中心
    normal: {
      id: 'normal', badge: '1-2', label: 'ふしぎな洞窟', short: 'ふしぎ', tag: 'ちゅうきゅう', col: '#7a4dbf',
      openStart: 2000, openEnd: 2600, caveLen: 1500, caveC: 545, progEnd: 22000,
      speed: [[0, 390], [8000, 390], [22000, 495], [48000, 570]],
      gap: [[0, 560], [4100, 535], [9000, 445], [16000, 388], [30000, 333], [60000, 305]],
      slope: [[0, 0.15], [9000, 0.195], [16000, 0.23], [30000, 0.26], [60000, 0.27]],
      clear: [[0, 345], [14000, 298], [34000, 266]],
      jAmp: [[0, 60], [15000, 82], [40000, 96]],
      jPer: [[0, 3.8], [15000, 3.1], [40000, 2.8]],
      rAmp: [[0, 0]], rPer: [[0, 3.4]],
      stages: [
        { until: 4600, need: ['up'], w: { cave: 0.6, up: 1.0 } },
        { until: 9000, need: ['down'], w: { cave: 0.5, up: 0.8, down: 1.0 } },
        { until: 14000, need: ['jelly'], w: { cave: 0.4, up: 0.7, down: 0.8, jelly: 1.2 } },
        { until: 22000, need: ['rock'], w: { cave: 0.35, up: 0.7, down: 0.7, jelly: 1.0, rock: 1.0, upRock: 0.8, downJelly: 0.8 } },
        { until: 1e9, need: [], w: { cave: 0.3, up: 0.6, down: 0.6, jelly: 0.8, rock: 0.8, jelly2: 0.8, rock3: 0.6, upRock: 1.0, downJelly: 1.0 } },
      ],
      demoX: 9000,
    },
    // ③ 深海チャレンジ — 狭い／動く岩／入れかわる海流／3つ同時
    hard: {
      id: 'hard', badge: '1-3', label: '深海チャレンジ', short: 'しんかい', tag: 'じょうきゅう', col: '#d0408f',
      openStart: 1500, openEnd: 1500, caveLen: 1300, caveC: 540, progEnd: 14000,
      // 上級は 長く進んでも 少しずつ難しくしつづける（うまい人でも 際限なく進めないように）
      speed: [[0, 420], [5000, 475], [15000, 550], [38000, 610], [90000, 645]],
      gap: [[0, 480], [3000, 428], [8000, 368], [17000, 324], [42000, 300], [90000, 288]],
      slope: [[0, 0.19], [8000, 0.23], [20000, 0.26], [50000, 0.27]],
      clear: [[0, 300], [8500, 266], [27000, 246], [70000, 242]],
      jAmp: [[0, 75], [15000, 95], [38000, 108], [80000, 118]],
      jPer: [[0, 3.2], [15000, 2.8], [38000, 2.5], [80000, 2.3]],
      rAmp: [[0, 0], [3000, 44], [15000, 70], [38000, 84], [80000, 92]],
      rPer: [[0, 3.4], [15000, 3.0], [38000, 2.7], [80000, 2.5]],
      stages: [
        { until: 3200, need: ['up'], w: { cave: 0.6, up: 1.0 } },
        { until: 7000, need: ['alt', 'jelly'], w: { cave: 0.3, alt: 1.0, jelly: 1.0, downJelly: 0.8 } },
        { until: 12000, need: ['rock'], w: { cave: 0.3, rock: 1.0, upRock: 1.0, downJelly: 0.9, jelly2: 0.7, alt: 0.8, upTight: 0.6 } },
        { until: 50000, need: ['triple'], w: { cave: 0.25, upRock: 1.0, downJelly: 1.0, jelly2: 0.9, rock3: 0.9, alt: 1.0, upTight: 0.8, triple: 1.3 } },
        // ---- R4: 1000m ごとの エリア。エリアの はじめに 門（ひと息）→ その エリアの 新しい しかけ（HARD_AREAS）----
        { until: 100000, need: ['gate2', 'flip'], w: { cave: 0.2, upRock: 1.0, downJelly: 1.0, jelly2: 0.9, rock3: 0.9, alt: 1.0, upTight: 0.8, triple: 1.3, flip: 1.0, flipRock: 0.6 } },
        { until: 150000, need: ['gate3', 'vortex'], w: { cave: 0.15, upRock: 1.0, downJelly: 1.0, jelly2: 0.8, rock3: 0.9, alt: 1.0, upTight: 0.8, triple: 1.3, flip: 0.6, flipRock: 0.8, vortex: 1.1 } },
        { until: 200000, need: ['gate4', 'fish'], w: { cave: 0.1, upRock: 1.0, downJelly: 1.0, jelly2: 0.7, rock3: 0.9, alt: 1.0, upTight: 0.8, triple: 1.3, flipRock: 0.9, vortex: 0.8, vortex2: 0.6, fish: 1.1 } },
        { until: 250000, need: ['gate5', 'drop'], w: { cave: 0.1, upRock: 1.0, downJelly: 1.0, jelly2: 0.6, rock3: 0.8, alt: 1.0, upTight: 0.8, triple: 1.3, flipRock: 0.9, vortex2: 0.8, fish: 0.7, fishRock: 0.8, drop: 1.1, drop2: 0.7 } },
        // ---- エリア6〜: カオスゾーン（ぜんぶ まぜる・じぐざぐ・とげとげ・くらい）----
        { until: 300000, need: ['gate6'], w: { zig: 1.2, cave: 0.1, triple: 0.8, rock3: 0.6, jelly2: 0.5, alt: 0.5, flipRock: 0.9, flipZig: 0.8, vortex2: 0.9, fish: 0.6, fishRock: 0.9, drop2: 0.9 } },
        { until: 350000, need: ['gate7'], w: { zig: 1.3, triple: 0.8, rock3: 0.6, jelly2: 0.4, alt: 0.4, flipRock: 1.0, flipZig: 1.0, vortex2: 1.0, fishRock: 1.0, drop2: 1.0, drop3: 0.6 } },
        { until: 1e9, need: ['gate8'], w: { zig: 1.4, triple: 0.8, rock3: 0.5, jelly2: 0.3, alt: 0.3, flipRock: 1.0, flipZig: 1.1, vortex2: 1.0, fishRock: 1.1, drop2: 0.9, drop3: 0.9 } },
      ],
      late: null,     // R4: HARD_AREAS から 下で つくる
      demoX: 9000,
    },
  };
  const COURSE_IDS = ['easy', 'normal', 'hard'];
  function courseOf(id) { return COURSES[id] || COURSES.easy; }

  /* ================= 難易度（コース × 距離 x で決まる） ================= */
  /* ---------- R4: 深海チャレンジの エリア（1000m ごと）----------
     エリアが かわると 一段 むずかしくなり、エリアの中でも 少しずつ 上がる。エリア1（〜1000m）は 元のまま。
     add: 元のカーブへの 足し算 [エリアの はじめ, おわり]（speed/gap/clear/slope/jAmp/jPer/rAmp/rPer）
          jag（かべの とげ）・pull（うずの すいこむ強さ）・fishK（さかなの はやさ）は そのままの値
     look: 見た目（sea＝海に かさねる色、pal＝かべの色、cb＝カオスの背景、dark＝くらさ） */
  const HARD_AREAS = [
    { n: 2, x: 50000, name: 'ふかい あおの海', gim: 'あべこべ海流', col: '#1f6fd0',
      add: { speed: [45, 50], gap: [-10, -12], clear: [-8, -9], pull: [200, 200], fishK: [0.6, 0.6] },
      look: { sea: [8, 36, 110, 0.24], pal: { cf: [150, 96, 80, 1], cd: [132, 82, 68, 1], ch: [220, 160, 130, 0.9], ol: [60, 34, 48, 1], ff: [190, 128, 84, 1], fd: [170, 110, 70, 1], fh: [236, 200, 150, 1] } } },
    { n: 3, x: 100000, name: 'うずまきの海', gim: 'うずまき', col: '#7a3fc0',
      add: { speed: [105, 110], gap: [-22, -24], clear: [-16, -17], pull: [200, 210], fishK: [0.6, 0.6] },
      look: { sea: [44, 16, 110, 0.34], pal: { cf: [122, 80, 112, 1], cd: [106, 66, 98, 1], ch: [236, 170, 220, 0.9], ol: [48, 22, 52, 1], ff: [152, 98, 122, 1], fd: [134, 84, 108, 1], fh: [240, 190, 222, 1] } } },
    { n: 4, x: 150000, name: 'さかなの海', gim: 'さかなの むれ', col: '#138a8a',
      add: { speed: [165, 170], gap: [-34, -36], clear: [-24, -25], slope: [-0.005, -0.005], pull: [220, 225], fishK: [0.6, 0.65] },
      look: { sea: [0, 50, 64, 0.44], pal: { cf: [64, 104, 100, 1], cd: [52, 88, 84, 1], ch: [150, 230, 200, 0.9], ol: [18, 40, 44, 1], ff: [86, 124, 104, 1], fd: [70, 106, 88, 1], fh: [170, 236, 200, 1] } } },
    { n: 5, x: 200000, name: 'いわの しんかい', gim: 'おちてくる岩', col: '#4a4aa0',
      add: { speed: [225, 230], gap: [-48, -50], clear: [-32, -34], slope: [-0.02, -0.02], pull: [235, 240], fishK: [0.7, 0.72] },
      look: { sea: [6, 8, 40, 0.56], pal: { cf: [76, 70, 96, 1], cd: [62, 58, 82, 1], ch: [190, 176, 255, 0.9], ol: [16, 12, 30, 1], ff: [96, 86, 114, 1], fd: [80, 72, 98, 1], fh: [200, 186, 255, 1] } } },
    { n: 6, x: 250000, name: 'カオスゾーン', chaos: true, col: '#d0103a',
      add: { speed: [295, 310], gap: [-64, -68], clear: [-40, -42], slope: [-0.04, -0.045], jAmp: [6, 8], jPer: [-0.2, -0.25], rAmp: [6, 8], rPer: [-0.2, -0.25], jag: [24, 30], pull: [255, 260], fishK: [0.8, 0.82] },
      look: { pal: { cf: [74, 30, 82, 1], cd: [56, 20, 64, 1], ch: [255, 84, 176, 0.95], ol: [22, 6, 28, 1], ff: [92, 34, 74, 1], fd: [70, 22, 58, 1], fh: [255, 96, 172, 1] }, cb: [[74, 26, 82], [58, 20, 80], [28, 10, 54]], dark: 0.42 } },
    { n: 7, x: 300000, name: 'もっと カオス', chaos: true, col: '#c0102a',
      add: { speed: [385, 405], gap: [-78, -84], clear: [-48, -50], slope: [-0.06, -0.065], jAmp: [10, 12], jPer: [-0.3, -0.35], rAmp: [10, 12], rPer: [-0.3, -0.35], jag: [36, 40], pull: [275, 280], fishK: [0.9, 0.92] },
      look: { pal: { cf: [92, 22, 42, 1], cd: [74, 16, 34, 1], ch: [255, 112, 92, 0.95], ol: [26, 4, 10, 1], ff: [112, 28, 50, 1], fd: [92, 22, 40, 1], fh: [255, 124, 104, 1] }, cb: [[92, 16, 36], [66, 10, 30], [28, 4, 16]], dark: 0.55 } },
    { n: 8, x: 350000, name: 'しんかいの はて', chaos: true, col: '#5a2aa0',
      add: { speed: [500, 900], gap: [-92, -160], clear: [-56, -60], slope: [-0.085, -0.125], jAmp: [12, 14], jPer: [-0.4, -0.45], rAmp: [12, 14], rPer: [-0.4, -0.45], jag: [44, 48], pull: [290, 300], fishK: [1.0, 1.0] },
      look: { pal: { cf: [36, 22, 52, 1], cd: [28, 16, 42, 1], ch: [176, 126, 255, 0.95], ol: [8, 2, 14, 1], ff: [46, 28, 62, 1], fd: [36, 22, 50, 1], fh: [186, 136, 255, 1] }, cb: [[32, 16, 50], [22, 10, 40], [8, 2, 16]], dark: 0.65 } },
  ];
  // エリアの境目の 20m 先から 700px かけて 一段 上がる（〜1000m の 地形は 元のまま）。最後の エリアは 5000m かけて 上がりつづける
  const AREA_LAG = 1000, AREA_RAMP = 700;
  function areaCurve(key) {
    const A = HARD_AREAS, pts = [];
    const abs = key === 'jag' || key === 'pull' || key === 'fishK';
    const val = function (a) { return a.add[key] || [0, 0]; };
    pts.push([A[0].x + AREA_LAG, abs ? val(A[0])[0] : 0]);
    for (let i = 0; i < A.length; i++) {
      const v = val(A[i]);
      pts.push([A[i].x + AREA_LAG + AREA_RAMP, v[0]]);
      pts.push([i + 1 < A.length ? A[i + 1].x + AREA_LAG : A[i].x + 250000, v[1]]);
    }
    return pts;
  }
  COURSES.hard.late = { from: HARD_AREAS[0].x, speedTail: 0.003 };   // speedTail: 12000m より先も 1m ごとに 0.15px/s ずつ 速くなる（一定には しない）
  ['speed', 'gap', 'clear', 'slope', 'jAmp', 'jPer', 'rAmp', 'rPer', 'jag', 'pull', 'fishK'].forEach(function (k) { COURSES.hard.late[k] = areaCurve(k); });
  // いま どの エリアか（1000m ごとの 境目。lead px 手前から 次の エリアと みなす）
  function areaIndex(w, x, lead) {
    let n = 1;
    for (let i = 0; i < HARD_AREAS.length; i++) { if (x >= HARD_AREAS[i].x - (lead || 0)) n = HARD_AREAS[i].n; else break; }
    return n;
  }
  function areaDef(n) { return n >= 2 ? HARD_AREAS[Math.min(n, 8) - 2] : null; }

  // R4: late を持つコース（深海チャレンジ）だけ 1000m から先に 上のせ。ほかのコースは 元の値を そのまま返す
  function lateAdd(w, k, x) { const L = w.c.late; return L[k] ? curve(L[k], x) : 0; }
  function lateSpeed(w, x) {
    const L = w.c.late, p = L.speed, last = p[p.length - 1];
    return curve(p, x) + (x > last[0] ? (x - last[0]) * L.speedTail : 0);
  }
  function progAt(w, x) { return clamp01(x / w.c.progEnd); }          // そのコースの進み具合 0〜1
  function speedAt(w, x) { const v = curve(w.c.speed, x); return w.c.late ? v + lateSpeed(w, x) : v; }   // 横スクロール速度
  function gapAt(w, x) { const v = curve(w.c.gap, x); return w.c.late ? v + lateAdd(w, 'gap', x) + jagRoom(w, x) : v; }      // 通路の基本の広さ
  function slopeAt(w, x) { const v = curve(w.c.slope, x); return w.c.late ? v + lateAdd(w, 'slope', x) : v; }   // 中心線の平均の傾きの上限
  function clearAt(w, x) { const v = curve(w.c.clear, x); return w.c.late ? v + lateAdd(w, 'clear', x) + jagRoom(w, x) : v; } // 障害物の反対側に必ず残す すきま
  function jellyAmp(w, x) { const v = curve(w.c.jAmp, x); return w.c.late ? v + lateAdd(w, 'jAmp', x) : v; }
  function jellyPer(w, x) { const v = curve(w.c.jPer, x); return w.c.late ? v + lateAdd(w, 'jPer', x) : v; }
  function rockAmp(w, x) { const v = curve(w.c.rAmp, x); return w.c.late ? v + lateAdd(w, 'rAmp', x) : v; }   // 岩の上下移動（上級だけ 0 でない）
  function rockPer(w, x) { const v = curve(w.c.rPer, x); return w.c.late ? v + lateAdd(w, 'rPer', x) : v; }

  /* ---------- R4: カオスゾーンの とげとげの かべ ----------
     入口（w.chaosX）から先は 天井と床に 三角の とげを足す（地形の配列に 直接 入るので 当たり判定も同じ）。
     とげの ぶん（jagRoom）だけ 通路と すきまを 広げて作るので、通れる帯は せまくなりすぎない */
  const JAG_CELL = 104;
  function jagAmp(w, x) { return w.chaosX && x >= w.chaosX ? curve(w.c.late.jag, x) : 0; }
  function jagRoom(w, x) { return w.chaosX && x >= w.chaosX ? 1.15 * jagAmp(w, x) : 0; }
  function jagAt(w, x, salt) {
    const A = jagAmp(w, x);
    if (A <= 0) return 0;
    const k = Math.floor(x / JAG_CELL), u = x / JAG_CELL - k;
    const h = hash(k * 1.73 + salt);
    const tri = 1 - Math.abs(2 * u - 1);
    return A * (h < 0.22 ? 0.15 : 0.45 + 0.55 * hash(k * 2.9 + salt + 5)) * tri;
  }

  /* ================= 世界（地形・障害物・潜水艇） ================= */
  function makeWorld(seed, courseId) {
    const c = courseOf(courseId);
    const w = {
      seed: seed >>> 0,
      c: c,
      rnd: A.rng(seed >>> 0),
      ctrl: [], top: [], bot: [], n: 0, ci: 0,
      zones: [], obs: [], signs: [], notes: [],
      genX: 0, lastC: 545, lastG: 0, cave: false, lastType: '', first: {}, seen: {}, noted: {}, segs: 0, caveX: 0,
      sub: { x: 0, y: 540, vy: 0, ang: 0 },
      speed: 0, mul: 1, t: 0,
      // R4（深海チャレンジの 1000m〜）: エリアの門 / あべこべ海流の区間 / うずの数 / 進んだ距離（さかな・落ちる岩の動きの基準）/ カオスゾーンの入口
      areas: [], flips: [], nVort: 0, px: 0, chaosX: 0,
    };
    w.ctrl.push({ x: X0, top: OPEN_TOP, bot: 982 });
    w.ctrl.push({ x: c.openStart, top: OPEN_TOP, bot: 982 });
    w.genX = c.openStart;
    return w;
  }

  function cRange(G) {
    const lo = TOP_MIN + G / 2, hi = BOT_MAX - G / 2;
    if (lo > hi) { const m = (TOP_MIN + BOT_MAX) / 2; return [m, m]; }   // 通路が広すぎるときの保険
    return [lo, hi];
  }
  function addCtrl(w, x, C, G) {
    w.ctrl.push({ x: x, top: C - G / 2, bot: C + G / 2 });
    w.genX = x; w.lastC = C; w.lastG = G;
  }
  // 中心線を C へ動かす。傾きが上限を超えないよう、必要なら距離をのばす
  function moveTo(w, C, G, minDx) {
    const s = slopeAt(w, w.genX);
    const dx = Math.max(minDx, Math.abs(C - w.lastC) / s);
    addCtrl(w, w.genX + dx, C, G);
  }
  // 新しいギミックの説明バナー（1コースにつき 1回だけ）
  function noteOnce(w, kind, x) {
    if (w.noted[kind]) return;
    w.noted[kind] = true;
    w.notes.push({ x: Math.max(240, x), kind: kind });
  }
  // 制御点の補間（任意の x。障害物の配置用）
  function evalAt(w, x) {
    const c = w.ctrl;
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m].x <= x) lo = m; else hi = m; }
    const a = c[lo], b = c[hi];
    const t = smooth(clamp01((x - a.x) / Math.max(1, b.x - a.x)));
    return [lerp(a.top, b.top, t), lerp(a.bot, b.bot, t)];
  }
  function insertObs(w, o) {
    const obs = w.obs;
    let i = obs.length;
    while (i > 0 && obs[i - 1].x > o.x) i--;
    obs.splice(i, 0, o);
  }
  // 岩。上級では ゆっくり上下に動く（amp）。動く範囲ぶん かべ側に寄せて置く
  function addRock(w, x, side, E, amp) {
    const R = Math.max(80 + w.rnd() * 30, (E + 50) / 2);
    amp = amp === undefined ? rockAmp(w, x) : amp;
    const c = evalAt(w, x);
    const top = Math.max(c[0], SURF_Y);
    const y = side === 'top' ? top + E - R - amp : c[1] - E + R + amp;
    insertObs(w, { kind: 'rock', x: x, y: y, r: R, side: side, seed: w.rnd(), amp: amp, per: rockPer(w, x), ph: w.rnd() * Math.PI * 2 });
    noteOnce(w, amp > 8 ? 'moverock' : 'rock', x - 1250);
  }
  function addJelly(w, x, side, amp) {
    const c = evalAt(w, x);
    const top = Math.max(c[0], SURF_Y), bot = c[1];
    const y = side === 'top' ? top + 12 + J_UP + amp : bot - 12 - J_DN - amp;
    insertObs(w, { kind: 'jelly', x: x, y: y, amp: amp, per: jellyPer(w, x), ph: w.rnd() * Math.PI * 2, side: side, hue: w.rnd() < 0.5 ? 0 : 1 });
    noteOnce(w, 'jelly', x - 1250);
  }
  // 岩が通路に出っぱる量（E）と、そのとき必要な通路の広さ
  // amp は区間のあたまで決めてしまう（置く場所で変えると すきまが足りなくなる）
  function rockExtra(w, x, first) {
    const E = (first ? 112 : 124 + w.rnd() * 26) + 22 * progAt(w, x);
    const amp = rockAmp(w, x + 900);
    return { E: E, amp: amp, need: clearAt(w, x + 900) + E + amp + 40 + (first ? 40 : 0) };
  }
  function jellyExtra(w, x, first) {
    const amp = first ? Math.min(46, jellyAmp(w, x)) : jellyAmp(w, x + 900);
    return { amp: amp, need: clearAt(w, x + 900) + J_SPAN + 2 * amp + 52 + (first ? 40 : 0) };
  }

  /* ---------- R4 の しかけ（深海チャレンジの 2000m〜）----------
     どれも「通れる帯」(bandAt) に 動く範囲・来る範囲ぜんぶを 入れて、反対がわに clearAt 以上を 残す */
  // うずまき: かべの近くに うず。まん中に当たると アウト。近くを通ると うずの がわへ すいこまれる
  function addVortex(w, x, side, S) {
    const c = evalAt(w, x);
    const top = Math.max(c[0], SURF_Y);
    const y = side === 'top' ? top + 22 + VORT_RC : c[1] - 22 - VORT_RC;
    insertObs(w, { kind: 'vortex', x: x, y: y, r: VORT_RC, R: VORT_R, S: S, side: side, spin: w.rnd() < 0.5 ? 1 : -1, ph: w.rnd() * Math.PI * 2 });
    w.nVort++;
    noteOnce(w, 'vortex', x - 1350);
  }
  // さかなの むれ: かべぞいの 1本の みちを 右から つっこんでくる。
  // 動きは 時間ではなく「潜水艇が 進んだ距離 px」で決める（どこで すれちがうか xm が 決まっている → 通れる帯で あつかえる）
  //   先頭の x = xm + k × (xm − px)  … 潜水艇が xm に来たとき ちょうど xm（スクロールの k 倍の速さで 向かってくる）
  function addFish(w, xm, side, k, n) {
    const c = evalAt(w, xm);
    const top = Math.max(c[0], SURF_Y);
    const y = side === 'top' ? top + 6 + FISH_LH : c[1] - 6 - FISH_LH;
    const ext = (n - 1) * FISH_SP / (1 + k);              // すれちがう あいだに 潜水艇が進む距離
    insertObs(w, { kind: 'fish', x: xm + ext / 2, xm: xm, y: y, side: side, k: k, n: n, hw: ext / 2 + 64, ph: w.rnd() * Math.PI * 2, hue: w.rnd() < 0.5 ? 0 : 1 });
    noteOnce(w, 'fish', xm - 1800);
  }
  function fishPos(o, px, j) {
    return [o.xm + o.k * (o.xm - px) + j * FISH_SP, o.y + (j % 2 ? FISH_ROW : -FISH_ROW) + Math.sin(px * 0.006 + j * 1.9 + o.ph) * FISH_WIG];
  }
  // おちてくる岩: 天井に うまっている岩が、潜水艇が近づくと 床へ おちる。着地は 潜水艇が来る 0.6秒以上 前（落ちている岩には 当たらない）
  function addDrop(w, x, E) {
    const R = Math.max(80 + w.rnd() * 30, (E + 50) / 2);
    const c = evalAt(w, x);
    const sp = speedAt(w, x);
    const xe = x - (SUB_HW + R * ROCK_HIT + 0.62 * sp);   // 潜水艇が ここまで来たら 着地ずみ
    const xs = xe - 0.5 * sp;                              // ここで 落ちはじめる
    insertObs(w, { kind: 'drop', x: x, y: c[1] - E + R, y0: Math.max(c[0], SURF_Y) - R * 0.3, r: R, side: 'bot', seed: w.rnd(), xs: xs, xe: xe, amp: 0 });
    noteOnce(w, 'drop', xs - 1500);
  }
  function dropY(o, px) { const u = clamp01((px - o.xs) / (o.xe - o.xs)); return o.y0 + (o.y - o.y0) * u * u; }
  // あべこべ海流の中か
  function flipAt(w, x) {
    const z = w.flips;
    let lo = 0, hi = z.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (z[m].x0 <= x) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans >= 0 && x < z[ans].x1;
  }
  // うずの すいこみ: 目標の上下速度を うずの がわへ ずらす量(px/s)。強さは 上下の能力(400/360)より 小さい = かならず にげられる
  function pullAt(w, x, y) {
    let v = 0;
    const obs = w.obs;
    for (let i = lowerObs(w, x - VORT_R); i < obs.length && obs[i].x <= x + VORT_R; i++) {
      const o = obs[i];
      if (o.kind !== 'vortex') continue;
      const dx = x - o.x, dy = o.y - y, d = Math.sqrt(dx * dx + dy * dy);
      if (d >= o.R) continue;
      v += o.S * clamp01(1 - (d - o.r) / (o.R - o.r)) * clamp(dy / 70, -1, 1);
    }
    return v;
  }
  function lateCurve(w, k, x) { return curve(w.c.late[k], x); }

  function weighted(w, tbl, last) {
    let sum = 0, k;
    for (k in tbl) if (k === 'cave' || k !== last) sum += tbl[k];
    let r = w.rnd() * sum;
    for (k in tbl) {
      if (k !== 'cave' && k === last) continue;
      r -= tbl[k];
      if (r <= 0) return k;
    }
    return 'cave';
  }
  function stageOf(w, x) {
    const st = w.c.stages;
    for (let i = 0; i < st.length; i++) if (x < st[i].until) return st[i];
    return st[st.length - 1];
  }
  function pickType(w, x) {
    const all = w.c.stages, st = stageOf(w, x);
    // ここまでのステージの「必ず出す種類」で まだ出ていないものを 順番に出す
    // （区間が長くてステージを飛びこしても、初登場の順番は守られる）
    for (let i = 0; i < all.length; i++) {
      const s = all[i];
      for (let j = 0; j < s.need.length; j++) if (!w.seen[s.need[j]]) return s.need[j];
      if (s === st) break;
    }
    return weighted(w, st.w, w.lastType);
  }

  const SEG = {
    // ふつうの洞窟（ゆるやかに上下）
    cave1: function (w) { SEG.cave(w, 1); },
    cave: function (w, count) {
      const n = count || 2 + Math.floor(w.rnd() * 2);
      for (let i = 0; i < n; i++) {
        const dx = 520 + w.rnd() * 300;
        const nx = w.genX + dx;
        const G = gapAt(w, nx);
        const rg = cRange(G);
        let C = w.lastC + (w.rnd() * 2 - 1) * slopeAt(w, nx) * dx;
        const mid = (rg[0] + rg[1]) / 2;
        if (C < rg[0] + 40 || C > rg[1] - 40) C = lerp(C, mid, 0.45);
        moveTo(w, clamp(C, rg[0], rg[1]), G, dx);
      }
    },
    // 泡の上昇流（通路はゆるく上り。はなしていても ふわっと浮く）
    // opt: {rock:true 中に岩, jelly:true 出口にクラゲ, tight:true 広げない(こまかい押し加減)}
    up: function (w, opt) {
      opt = opt || {};
      const x = w.genX, p = progAt(w, x);
      const first = !w.first.up; w.first.up = true;
      let G = gapAt(w, x) + (first ? 140 : opt.tight ? 10 : 60);
      let rk = null, jl = null;
      if (opt.rock) { rk = rockExtra(w, x, !w.first.rock); w.first.rock = true; G = Math.max(G, rk.need); }
      if (opt.jelly) { jl = jellyExtra(w, x, !w.first.jelly); w.first.jelly = true; G = Math.max(G, jl.need); }
      let Lz = first ? 560 : (opt.tight ? 820 + w.rnd() * 260 : 540 + w.rnd() * 200) + p * 200;
      // 中に置く物の数で 長さを確保する（物どうしが 近づきすぎないように）
      if (rk && jl) Lz = Math.max(Lz, 1300); else if (rk || jl) Lz = Math.max(Lz, 900);
      const rise = 0.12 * Lz;
      const rg = cRange(G);
      const C1 = clamp(w.lastC + (w.rnd() * 2 - 1) * 50, Math.min(rg[1], rg[0] + rise), rg[1]);
      moveTo(w, C1, G, 700);
      const zx = w.genX;
      w.signs.push({ x: zx - 560, type: 'up' });
      if (first) noteOnce(w, 'up', zx - 1150);
      addCtrl(w, zx + Lz, C1 - rise, G);
      w.zones.push({ type: 'up', x0: zx, x1: zx + Lz });
      // ★上昇流の中では 下がれない（はなしても -60px/s で浮く）ので、障害物は かならず「下がわ」
      if (rk) addRock(w, zx + Lz * (jl ? 0.3 : 0.45), 'bot', rk.E, rk.amp);
      if (jl) addJelly(w, zx + Lz * (rk ? 0.72 : 0.6), 'bot', jl.amp);
      if (rk || jl) addCtrl(w, zx + Lz + 280, C1 - rise, G);   // 障害物のあとは 少しそのままの広さを保つ
      moveTo(w, C1 - rise, gapAt(w, w.genX), 480);
    },
    // 下向きの海流（通路はゆるく下り。おしても ゆっくりしか上がらない）
    down: function (w, opt) {
      opt = opt || {};
      const x = w.genX, p = progAt(w, x);
      const first = !w.first.down; w.first.down = true;
      let G = gapAt(w, x) + (first ? 140 : opt.tight ? 10 : 60);
      let rk = null, jl = null;
      if (opt.jelly) { jl = jellyExtra(w, x, !w.first.jelly); w.first.jelly = true; G = Math.max(G, jl.need); }
      if (opt.rock) { rk = rockExtra(w, x, !w.first.rock); w.first.rock = true; G = Math.max(G, rk.need); }
      let Lz = first ? 600 : (opt.tight ? 820 + w.rnd() * 260 : 580 + w.rnd() * 220) + p * 200;
      if (rk && jl) Lz = Math.max(Lz, 1300); else if (rk || jl) Lz = Math.max(Lz, 900);
      const drop = 0.08 * Lz;
      const rg = cRange(G);
      const C1 = clamp(w.lastC + (w.rnd() * 2 - 1) * 50, rg[0], Math.max(rg[0], rg[1] - drop));
      moveTo(w, C1, G, 700);
      const zx = w.genX;
      w.signs.push({ x: zx - 560, type: 'down' });
      if (first) noteOnce(w, 'down', zx - 1150);
      addCtrl(w, zx + Lz, C1 + drop, G);
      w.zones.push({ type: 'down', x0: zx, x1: zx + Lz });
      // ★下向きの海流の中では 速く上がれないので、障害物は かならず「上がわ」
      if (jl) addJelly(w, zx + Lz * (rk ? 0.3 : 0.45), 'top', jl.amp);
      if (rk) addRock(w, zx + Lz * (jl ? 0.72 : 0.6), 'top', rk.E, rk.amp);
      if (rk || jl) addCtrl(w, zx + Lz + 280, C1 + drop, G);
      moveTo(w, C1 + drop, gapAt(w, w.genX), 480);
    },
    // クラゲ（通路を少し広げ、片側に寄せる。反対側に十分な すきま）
    jelly: function (w, count) {
      const x = w.genX, p = progAt(w, x);
      const first = !w.first.jelly; w.first.jelly = true;
      count = count || 1;
      const jl = jellyExtra(w, x, first);
      const G = Math.max(gapAt(w, x), jl.need);
      const rg = cRange(G);
      const C1 = clamp(w.lastC, rg[0], rg[1]);
      moveTo(w, C1, G, 560);
      const sx = w.genX;
      // 上下 交互に置くので、反対がわへ 移れる時間（約1.4秒）を スクロール速度から確保する
      const sep = speedAt(w, x) * (1.9 - 0.5 * p);
      let side = w.rnd() < 0.5 ? 'top' : 'bot';
      addCtrl(w, sx + 600 + (count - 1) * sep, C1, G);
      for (let i = 0; i < count; i++) {
        addJelly(w, sx + 300 + i * sep, side, jl.amp);
        side = side === 'top' ? 'bot' : 'top';
      }
      moveTo(w, C1, gapAt(w, w.genX), 560);
    },
    // 岩（かべから つき出る。上下 交互。上級では ゆっくり動く）
    rock: function (w, count) {
      const x = w.genX, p = progAt(w, x);
      const first = !w.first.rock; w.first.rock = true;
      count = count || (first ? 1 : 2);
      const rk = rockExtra(w, x, first);
      const G = Math.max(gapAt(w, x), rk.need);
      const rg = cRange(G);
      const C1 = clamp(w.lastC, rg[0], rg[1]);
      moveTo(w, C1, G, 560);
      const sx = w.genX;
      const sep = speedAt(w, x) * (1.7 - 0.4 * p);
      let side = w.rnd() < 0.5 ? 'top' : 'bot';
      addCtrl(w, sx + 500 + (count - 1) * sep, C1, G);
      for (let i = 0; i < count; i++) {
        addRock(w, sx + 250 + i * sep, side, rk.E, rk.amp);
        side = side === 'top' ? 'bot' : 'top';
      }
      moveTo(w, C1, gapAt(w, w.genX), 520);
    },
    // 入れかわる海流（上級）: 上昇流と下降流が となりあう。あわでは はなす、あおでは おす
    alt: function (w) {
      const x = w.genX, p = progAt(w, x);
      const first = !w.first.alt; w.first.alt = true;
      const n = first ? 3 : 3 + (w.rnd() < 0.4 ? 1 : 0);
      const L = (first ? 470 : 430 - 60 * p);
      const G = Math.max(gapAt(w, x) + 130, clearAt(w, x) + 150);
      const rg = cRange(G);
      const C1 = clamp(w.lastC, rg[0], rg[1]);
      moveTo(w, C1, G, 640);
      const zx = w.genX;
      w.signs.push({ x: zx - 420, type: 'up' });
      if (first) noteOnce(w, 'alt', zx - 1250);
      for (let i = 0; i < n; i++) w.zones.push({ type: i % 2 ? 'down' : 'up', x0: zx + i * L, x1: zx + (i + 1) * L });
      addCtrl(w, zx + n * L, C1, G);          // 中心線は平ら（流れの切りかえに集中できるように）
      moveTo(w, C1, gapAt(w, w.genX), 520);
    },
    // 3つ同時（上級）: 流れ ＋ 岩 ＋ クラゲ
    triple: function (w) {
      if (w.rnd() < 0.5) SEG.up(w, { rock: true, jelly: true });
      else SEG.down(w, { jelly: true, rock: true });
    },
    rock3: function (w) { SEG.rock(w, 3); },
    jelly2: function (w) { SEG.jelly(w, 2); },
    upRock: function (w) { SEG.up(w, { rock: true }); },
    upTight: function (w) { SEG.up(w, { tight: true }); },
    downJelly: function (w) { SEG.down(w, { jelly: true }); },

    /* ---------- R4（深海チャレンジの 2000m〜）---------- */
    // あべこべ海流: 中では おす と はなす が ぎゃく（おす＝しずむ、はなす＝うく）。上下の速さは ふだんと同じ
    // opt: {rock:true 中に岩（上下どちらでもよい）, zig:true 中で じぐざぐ}
    flip: function (w, opt) {
      opt = opt || {};
      const x = w.genX;
      const first = !w.first.flip; w.first.flip = true;
      let G = gapAt(w, x) + (first ? 170 : opt.zig ? 20 : 40);
      let rk = null;
      if (opt.rock) { rk = rockExtra(w, x, false); G = Math.max(G, rk.need); }
      const Lz = first ? 1500 : opt.zig ? 1400 + w.rnd() * 400 : rk ? 1000 + w.rnd() * 300 : 800 + w.rnd() * 500;
      const rg = cRange(G);
      const C1 = clamp(w.lastC, rg[0], rg[1]);
      moveTo(w, C1, G, first ? 760 : 620);
      const zx = w.genX;
      w.signs.push({ x: zx - 520, type: 'flip' });
      if (first) noteOnce(w, 'flip', zx - 1350);
      w.flips.push({ x0: zx, x1: zx + Lz });
      if (first) {
        // はじめては ゆるい 坂を 1つだけ（ぎゃくの 操作を ためせるように）
        const C2 = clamp(C1 + (C1 > (rg[0] + rg[1]) / 2 ? -1 : 1) * 70, rg[0], rg[1]);
        addCtrl(w, zx + 350, C1, G);
        addCtrl(w, zx + 1000, C2, G);
        addCtrl(w, zx + Lz, C2, G);
      } else if (opt.zig) {
        let C = C1, dir = w.rnd() < 0.5 ? -1 : 1;
        const n = 3, dx = Lz / n;
        for (let i = 0; i < n; i++) {
          let Cn = C + dir * slopeAt(w, w.genX) * dx * 0.7;
          if (Cn < rg[0] || Cn > rg[1]) { dir = -dir; Cn = C + dir * slopeAt(w, w.genX) * dx * 0.7; }
          Cn = clamp(Cn, rg[0], rg[1]);
          addCtrl(w, w.genX + dx, Cn, G);
          C = Cn; dir = -dir;
        }
      } else {
        addCtrl(w, zx + Lz, C1, G);
        if (rk) {
          addRock(w, zx + Lz * 0.55, w.rnd() < 0.5 ? 'top' : 'bot', rk.E, rk.amp);
          addCtrl(w, zx + Lz + 280, C1, G);
        }
      }
      moveTo(w, w.lastC, gapAt(w, w.genX), 520);
    },
    // うずまき（1つ か 上下 交互に 2つ）
    vortex: function (w, count) {
      const x = w.genX;
      const first = !w.first.vortex; w.first.vortex = true;
      count = count || 1;
      const S = lateCurve(w, 'pull', x) * (first ? 0.85 : 1);
      const G = Math.max(gapAt(w, x) + 30, 22 + 2 * VORT_RC + clearAt(w, x + 900) + 30 + (first ? 80 : 0));
      const rg = cRange(G);
      const C1 = clamp(w.lastC, rg[0], rg[1]);
      moveTo(w, C1, G, 620);
      const sx = w.genX;
      const sep = speedAt(w, x) * 1.5;
      w.signs.push({ x: sx - 380, type: 'vortex' });
      addCtrl(w, sx + 760 + (count - 1) * sep, C1, G);
      let side = w.rnd() < 0.5 ? 'top' : 'bot';
      for (let i = 0; i < count; i++) {
        addVortex(w, sx + 380 + i * sep, side, S);
        side = side === 'top' ? 'bot' : 'top';
      }
      moveTo(w, C1, gapAt(w, w.genX), 560);
    },
    // さかなの むれ（opt.rock: すれちがった あとに 反対がわの 岩）
    fish: function (w, opt) {
      opt = opt || {};
      const x = w.genX;
      const first = !w.first.fish; w.first.fish = true;
      const side = w.rnd() < 0.5 ? 'top' : 'bot';
      const k = lateCurve(w, 'fishK', x) * (first ? 0.85 : 1);
      const n = first ? 4 : 5;
      const LT = 2 * FISH_LH + 6;
      let G = Math.max(gapAt(w, x) + LT * 0.5 + (first ? 60 : 10), clearAt(w, x + 900) + LT + 12 + (first ? 50 : 0));
      let rk = null;
      if (opt.rock) { rk = rockExtra(w, x, false); G = Math.max(G, rk.need); }
      // さかなが 来る がわの かべは そのまま、反対がわへ 広げる（いまの高さのままだと むれに ぶつかる）
      const top0 = w.lastC - w.lastG / 2, bot0 = w.lastC + w.lastG / 2;
      const rg = cRange(G);
      const C1 = clamp(side === 'top' ? top0 + G / 2 : bot0 - G / 2, rg[0], rg[1]);
      moveTo(w, C1, G, 640);
      const sx = w.genX;
      const xm = sx + 420;
      const sep = speedAt(w, x) * 1.35;
      w.signs.push({ x: sx - 300, type: 'fish' });
      addCtrl(w, xm + 520 + (rk ? sep : 0), C1, G);
      addFish(w, xm, side, k, n);
      if (rk) {
        addRock(w, xm + sep, side === 'top' ? 'bot' : 'top', rk.E, rk.amp);
        addCtrl(w, w.genX + 280, C1, G);
      }
      moveTo(w, C1, gapAt(w, w.genX), 560);
    },
    // おちてくる岩（count: 落ちる岩（床がわ）と 天井の岩を 交互に）
    drop: function (w, count) {
      const x = w.genX;
      const first = !w.first.drop; w.first.drop = true;
      count = count || 1;
      const rk = rockExtra(w, x, first);
      const G = Math.max(gapAt(w, x) + (first ? 80 : 20), count > 1 ? rk.need : rk.need - rk.amp - 10);
      const rg = cRange(G);
      const C1 = clamp(w.lastC, rg[0], rg[1]);
      moveTo(w, C1, G, 600);
      const sx = w.genX;
      const sep = speedAt(w, x) * 1.35;
      w.signs.push({ x: sx - 260, type: 'drop' });
      addCtrl(w, sx + 520 + (count - 1) * sep, C1, G);
      for (let i = 0; i < count; i++) {
        if (i % 2 === 0) addDrop(w, sx + 300 + i * sep, rk.E);
        else addRock(w, sx + 300 + i * sep, 'top', rk.E, rk.amp);
      }
      moveTo(w, C1, gapAt(w, w.genX), 520);
    },
    // エリアの 門（ひと息つける 広い場所。ここから 色・むずかしさが かわる。エリア6 = カオスゾーンの入口）
    gate: function (w, n) {
      const x = w.genX;
      const G = gapAt(w, x) + (n >= 6 ? 190 : 150);
      const rg = cRange(G), q = (rg[1] - rg[0]) * 0.25;
      const C1 = clamp(w.lastC, rg[0] + q, rg[1] - q);
      moveTo(w, C1, G, 760);
      const gx = w.genX;
      w.areas.push({ n: n, x: gx });
      if (n === 6) w.chaosX = gx;
      addCtrl(w, gx + 700, C1, G);
      moveTo(w, C1, gapAt(w, w.genX), 640);
    },
    gate2: function (w) { SEG.gate(w, 2); },
    gate3: function (w) { SEG.gate(w, 3); },
    gate4: function (w) { SEG.gate(w, 4); },
    gate5: function (w) { SEG.gate(w, 5); },
    gate6: function (w) { SEG.gate(w, 6); },
    gate7: function (w) { SEG.gate(w, 7); },
    gate8: function (w) { SEG.gate(w, 8); },
    // じぐざぐ（カオスゾーン）: みじかい 上り下りを 何回も。ときどき ふくらむ
    zig: function (w) {
      const n = 3 + Math.floor(w.rnd() * 3);
      let dir = w.rnd() < 0.5 ? -1 : 1;
      for (let i = 0; i < n; i++) {
        const dx = 380 + w.rnd() * 220;
        const nx = w.genX + dx;
        const G = gapAt(w, nx) + (w.rnd() < 0.3 ? 70 : 0);
        const rg = cRange(G);
        let C = w.lastC + dir * slopeAt(w, w.genX) * dx * (0.75 + 0.25 * w.rnd());
        if (C < rg[0] || C > rg[1]) { dir = -dir; C = w.lastC + dir * slopeAt(w, w.genX) * dx * 0.8; }
        moveTo(w, clamp(C, rg[0], rg[1]), G, dx);
        dir = -dir;
      }
    },
    flipRock: function (w) { SEG.flip(w, { rock: true }); },
    flipZig: function (w) { SEG.flip(w, { zig: true }); },
    vortex2: function (w) { SEG.vortex(w, 2); },
    fishRock: function (w) { SEG.fish(w, { rock: true }); },
    drop2: function (w) { SEG.drop(w, 2); },
    drop3: function (w) { SEG.drop(w, 3); },
  };

  function genSegment(w) {
    const c = w.c, x = w.genX;
    if (x < c.openEnd - 1200) {            // 広い海（天井なし・海底はなだらか）
      let L = 1100 + w.rnd() * 500;
      if (c.openEnd - 1200 - (x + L) < 700) L = c.openEnd - 1200 - x;   // 入口がちょうど来るよう区切る
      const b = x < 2600 ? 972 + w.rnd() * 18 : 900 + w.rnd() * 85;
      w.ctrl.push({ x: x + L, top: OPEN_TOP, bot: b });
      w.genX = x + L; w.lastC = (SURF_Y + b) / 2;
      return;
    }
    if (!w.cave) {                         // 洞窟の入口（天井が上から ゆっくり下りてくる）
      w.cave = true;
      w.caveX = x;
      addCtrl(w, x + c.caveLen, c.caveC, gapAt(w, c.openEnd));
      noteOnce(w, 'cave', x - 300);
      return;
    }
    if (c.late) {                          // R4: エリアの バナーは 1000m ごとの 境目 ちょうどで
      for (let i = 0; i < HARD_AREAS.length; i++) if (x >= HARD_AREAS[i].x - 4000) noteOnce(w, 'area' + HARD_AREAS[i].n, HARD_AREAS[i].x);
    }
    const type = pickType(w, x);
    w.segs++;
    w.lastType = type;
    w.seen[type] = true;
    SEG[type](w);
  }

  function ensure(w, xMax) {
    while (w.genX < xMax + 3000) genSegment(w);
    const c = w.ctrl;
    while (X0 + w.n * SAMPLE <= xMax + SAMPLE) {
      const x = X0 + w.n * SAMPLE;
      while (w.ci < c.length - 2 && c[w.ci + 1].x <= x) w.ci++;
      const a = c[w.ci], b = c[w.ci + 1];
      const t = smooth(clamp01((x - a.x) / Math.max(1, b.x - a.x)));
      w.top[w.n] = lerp(a.top, b.top, t);
      w.bot[w.n] = lerp(a.bot, b.bot, t);
      if (w.chaosX && x >= w.chaosX) {     // R4: カオスゾーンの とげとげ
        w.top[w.n] += jagAt(w, x, 0);
        w.bot[w.n] -= jagAt(w, x + JAG_CELL * 0.5, 0.37);
      }
      w.n++;
    }
  }

  function terr(arr, w, x) {
    const f = (x - X0) / SAMPLE;
    let i = Math.floor(f);
    if (i < 0) i = 0;
    if (i > w.n - 2) i = w.n - 2;
    const t = f - i;
    return arr[i] + (arr[i + 1] - arr[i]) * t;
  }
  function topAt(w, x) { return terr(w.top, w, x); }
  function botAt(w, x) { return terr(w.bot, w, x); }
  function effTop(w, x) { return Math.max(SURF_Y, topAt(w, x)); }

  // 流れ: -1 = 泡の上昇流, +1 = 下向きの海流, 0 = なし
  function zoneAt(w, x) {
    const z = w.zones;
    let lo = 0, hi = z.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (z[m].x0 <= x) { ans = m; lo = m + 1; } else hi = m - 1; }
    if (ans >= 0 && x < z[ans].x1) return z[ans];
    return null;
  }
  function flowAt(w, x) {
    const z = zoneAt(w, x);
    if (!z) return 0;
    const f = smooth(clamp01((x - z.x0) / PHYS.edge)) * smooth(clamp01((z.x1 - x) / PHYS.edge));
    return z.type === 'up' ? -f : f;
  }

  function lowerObs(w, v) {
    const o = w.obs;
    let lo = 0, hi = o.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (o[m].x < v) lo = m + 1; else hi = m; }
    return lo;
  }
  function jellyY(o, t) { return o.y + o.amp * Math.sin(t * Math.PI * 2 / o.per + o.ph); }
  function rockY(o, t) { return o.amp ? o.y + o.amp * Math.sin(t * Math.PI * 2 / o.per + o.ph) : o.y; }

  // ある x での「通れる帯」[上, 下]（動く物は 動く範囲ぜんぶを避ける）
  function bandAt(w, x) {
    let lo = effTop(w, x), hi = botAt(w, x);
    const obs = w.obs;
    for (let i = lowerObs(w, x - 200); i < obs.length && obs[i].x <= x + 200; i++) {
      const o = obs[i], dx = x - o.x;
      if (o.kind === 'rock') {
        const r = o.r * ROCK_HIT;
        if (dx <= -r || dx >= r) continue;
        const h = Math.sqrt(r * r - dx * dx) + (o.amp || 0);
        if (o.side === 'top') lo = Math.max(lo, o.y + h); else hi = Math.min(hi, o.y - h);
      } else if (o.kind !== 'jelly') {
        // R4: うず（まん中）/ 落ちてくる岩（着地したあとの 位置）/ さかなの むれ（すれちがう 範囲の 帯ぜんぶ）
        let edge;
        if (o.kind === 'fish') {
          if (dx <= -o.hw || dx >= o.hw) continue;
          edge = o.side === 'top' ? o.y + FISH_LH : o.y - FISH_LH;
        } else {
          const r = o.kind === 'drop' ? o.r * ROCK_HIT : o.r;
          if (dx <= -r || dx >= r) continue;
          const h = Math.sqrt(r * r - dx * dx);
          edge = o.side === 'top' ? o.y + h : o.y - h;
        }
        if (o.side === 'top') lo = Math.max(lo, edge); else hi = Math.min(hi, edge);
      } else {
        let up = 1e9, dn = -1e9;
        if (dx > -JB_R && dx < JB_R) { const h = Math.sqrt(JB_R * JB_R - dx * dx); up = Math.min(up, JB_DY - h); dn = Math.max(dn, JB_DY + h); }
        if (dx > -JT_R && dx < JT_R) { const h = Math.sqrt(JT_R * JT_R - dx * dx); up = Math.min(up, JT_DY - h); dn = Math.max(dn, JT_DY + h); }
        if (dn < -1e8) continue;
        if (o.side === 'top') lo = Math.max(lo, o.y + o.amp + dn); else hi = Math.min(hi, o.y - o.amp + up);
      }
    }
    return [lo, hi];
  }
  // 潜水艇の幅ぶんを考えた帯
  function spanBand(w, x) {
    let lo = -1e9, hi = 1e9;
    for (let dx = -SUB_HW; dx <= SUB_HW; dx += 19) {
      const b = bandAt(w, x + dx);
      if (b[0] > lo) lo = b[0];
      if (b[1] < hi) hi = b[1];
    }
    return [lo, hi];
  }

  /* ---------- 物理 ---------- */
  function stepSub(w, press, dt) {
    const s = w.sub;
    if (w.flips.length && flipAt(w, s.x)) press = !press;   // R4: あべこべ海流
    const f = flowAt(w, s.x);
    let vt = press ? -PHYS.up : PHYS.down;
    vt += f < 0 ? PHYS.updraft * f : PHYS.current * f;
    if (w.nVort) vt += pullAt(w, s.x, s.y);                  // R4: うずの すいこみ
    vt = clamp(vt, -PHYS.vmax, PHYS.vmax);
    const a = clamp((vt - s.vy) * PHYS.k, -PHYS.amax, PHYS.amax);
    s.vy = clamp(s.vy + a * dt, -PHYS.vmax, PHYS.vmax);
    s.y += s.vy * dt;
    w.speed = speedAt(w, s.x) * w.mul;
    s.x += w.speed * dt;
    w.px = s.x;
    const at = clamp(s.vy / PHYS.vmax * 0.34, -0.34, 0.34);
    s.ang += (at - s.ang) * Math.min(1, dt * 10);
    w.t += dt;
  }

  function subCircle(s, c) {
    const ca = Math.cos(s.ang), sa = Math.sin(s.ang);
    return [s.x + c[0] * ca - c[1] * sa, s.y + c[0] * sa + c[1] * ca, c[2]];
  }

  function hitTest(w) {
    const s = w.sub;
    for (let k = 0; k < SUBC.length; k++) {
      const c = subCircle(s, SUBC[k]);
      const cx = c[0], cy = c[1], r = c[2];
      for (let dx = -r; dx <= r; dx += 6) {
        const h = Math.sqrt(r * r - dx * dx), xx = cx + dx;
        const tp = topAt(w, xx);
        if (cy - h < Math.max(SURF_Y, tp)) return { kind: tp < SURF_Y ? 'surface' : 'ceiling', x: xx, y: cy - h };
        if (cy + h > botAt(w, xx)) return { kind: tp < SURF_Y - 60 ? 'seabed' : 'floor', x: xx, y: cy + h };
      }
    }
    const obs = w.obs;
    for (let i = lowerObs(w, s.x - 260); i < obs.length && obs[i].x <= s.x + 260; i++) {
      const o = obs[i];
      for (let k = 0; k < SUBC.length; k++) {
        const c = subCircle(s, SUBC[k]);
        if (o.kind === 'rock') {
          const ry = rockY(o, w.t);
          const rr = o.r * ROCK_HIT + c[2];
          const dx = c[0] - o.x, dy = c[1] - ry;
          if (dx * dx + dy * dy < rr * rr) return { kind: 'rock', x: (c[0] + o.x) / 2, y: (c[1] + ry) / 2, o: o };
        } else if (o.kind !== 'jelly') {
          // R4 の しかけ
          if (o.kind === 'fish') {
            for (let j = 0; j < o.n; j++) {
              const p = fishPos(o, w.px, j);
              const rr = FISH_RF + c[2], dx = c[0] - p[0], dy = c[1] - p[1];
              if (dx * dx + dy * dy < rr * rr) return { kind: 'fish', x: (c[0] + p[0]) / 2, y: (c[1] + p[1]) / 2, o: o };
            }
          } else {
            const oy = o.kind === 'drop' ? dropY(o, w.px) : o.y;
            const rr = (o.kind === 'drop' ? o.r * ROCK_HIT : o.r) + c[2];
            const dx = c[0] - o.x, dy = c[1] - oy;
            if (dx * dx + dy * dy < rr * rr) return { kind: o.kind, x: (c[0] + o.x) / 2, y: (c[1] + oy) / 2, o: o };
          }
        } else {
          const jy = jellyY(o, w.t);
          const parts = [[jy + JB_DY, JB_R], [jy + JT_DY, JT_R]];
          for (let p = 0; p < 2; p++) {
            const rr = parts[p][1] + c[2];
            const dx = c[0] - o.x, dy = c[1] - parts[p][0];
            if (dx * dx + dy * dy < rr * rr) return { kind: 'jelly', x: (c[0] + o.x) / 2, y: (c[1] + parts[p][0]) / 2, o: o };
          }
        }
      }
    }
    return null;
  }

  /* ---------- 自動操縦（デモ・テスト用） ----------
     先の「通れる帯」の共通部分をねらい、おす/はなす のどちらが近づくかを
     いまの流れを ふくめた予測で選ぶ（流れの中でも まともに飛べる） */
  const BOT_L = [0.06, 0.16, 0.28, 0.42, 0.58, 0.75];
  // 近いほうから「通れる帯」を かさねていき、両立できなくなる手前までの まんなかをねらう
  function aimY(w, x0, v) {
    let lo = -1e9, hi = 1e9;
    for (let i = 0; i < BOT_L.length; i++) {
      const b = spanBand(w, x0 + v * BOT_L[i]);
      const nlo = Math.max(lo, b[0]), nhi = Math.min(hi, b[1]);
      if (nhi - nlo < 70) break;
      lo = nlo; hi = nhi;
    }
    if (lo < -1e8) { const b = spanBand(w, x0); return (b[0] + b[1]) / 2; }
    return (lo + hi) / 2;
  }
  // t 秒後の高さの予測（目標速度へ 時定数 1/k で近づくモデル）
  function predictY(s, press, f, t, pv) {
    let vt = press ? -PHYS.up : PHYS.down;
    vt += f < 0 ? PHYS.updraft * f : PHYS.current * f;
    if (pv) vt += pv;                                        // R4: うずの すいこみ
    vt = clamp(vt, -PHYS.vmax, PHYS.vmax);
    const tau = 1 / PHYS.k;
    return s.y + vt * t + (s.vy - vt) * tau * (1 - Math.exp(-t / tau));
  }
  // 返すのは「うきたい(true) / しずみたい(false)」。あべこべ海流での キーの おす・はなす は botPress などで ぎゃくにする
  function decide(w, off) {
    const s = w.sub, v = Math.max(200, w.speed || speedAt(w, s.x));
    const tgt = aimY(w, s.x, v) + (off || 0);
    const f = flowAt(w, s.x);
    const pv = w.nVort ? pullAt(w, s.x, s.y) : 0;
    return Math.abs(predictY(s, true, f, 0.3, pv) - tgt) < Math.abs(predictY(s, false, f, 0.3, pv) - tgt);
  }
  function botPress(w) { const p = decide(w, 0); return w.flips.length && flipAt(w, w.sub.x) ? !p : p; }

  function jumpTo(w, x) {
    ensure(w, x + 2600);
    w.sub.x = x;
    w.px = x;
    const b = spanBand(w, x);
    w.sub.y = (b[0] + b[1]) / 2;
    w.speed = speedAt(w, x);
  }

  /* ---------- 1回分の走り（世界 ＋ 演出の状態） ---------- */
  function newRun(seed, startX, courseId) {
    const w = makeWorld(seed, courseId);
    if (startX) jumpTo(w, startX); else ensure(w, 2600);
    return { w: w, parts: [], T: 0, press: false, prop: 0, bubT: 0, crashT: -1, hit: null, bounceVx: 0, mode: 'ready' };
  }

  function addPart(run, x, y, vx, vy, r, life, kind) {
    if (run.parts.length > 240) run.parts.shift();
    run.parts.push({ x: x, y: y, vx: vx, vy: vy, r: r, life: 0, max: life, kind: kind || 0 });
  }
  // dir: -1 = 上へ（床にぶつかった）, 1 = 下へ（天井）, 0 = まわりへ
  function burst(run, x, y, n, dir) {
    for (let i = 0; i < n; i++) {
      const a = dir ? (dir < 0 ? -Math.PI : 0) + rand(0.15, Math.PI - 0.15) : Math.random() * Math.PI * 2, sp = rand(120, 340);
      addPart(run, x, y, Math.cos(a) * sp, Math.sin(a) * sp - 60, rand(5, 15), rand(1.0, 1.8), 1);
    }
  }
  function fxStep(run, dt, moving) {
    run.T += dt;
    const s = run.w.sub;
    run.prop += dt * (run.crashT >= 0 ? 3 : moving ? (run.press ? 30 : 19) : 9);
    if (run.crashT < 0) {
      run.bubT -= dt;
      if (run.bubT <= 0) {
        run.bubT = !moving ? 0.28 : run.press ? 0.045 : 0.13;
        const a = s.ang;
        const px = s.x - 128 * Math.cos(a), py = s.y - 128 * Math.sin(a) + 2;
        addPart(run, px + rand(-6, 6), py + rand(-10, 10), rand(-40, 10), rand(-70, -20), rand(3, run.press ? 9 : 6), rand(0.9, 1.5));
      }
    } else run.crashT += dt;
    const ps = run.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life += dt;
      if (p.kind === 1) { const d = Math.pow(0.08, dt); p.vx *= d; p.vy = p.vy * d - 90 * dt; }
      else p.vy -= 40 * dt;
      p.x += p.vx * dt + Math.sin(p.life * 7 + p.r) * 0.5;
      p.y += p.vy * dt;
      if (p.life > p.max || p.y < SURF_Y) ps.splice(i, 1);
    }
  }

  /* =========================================================
     描画
     ========================================================= */
  const OL = '#5a3a18';          // 潜水艇の線
  const ROCK_OL = '#4d2a3a';     // かべ・岩の線

  function cloud(g, x, y, s) {
    g.beginPath();
    g.arc(x, y, 26 * s, 0, 7);
    g.arc(x + 30 * s, y - 12 * s, 32 * s, 0, 7);
    g.arc(x + 64 * s, y, 26 * s, 0, 7);
    g.fill();
  }
  function waveY(wx, T) { return SURF_Y + Math.sin(wx * 0.011 + T * 1.8) * 5 + Math.sin(wx * 0.027 - T * 1.2) * 2.5; }

  function fishShape(g, x, y, s) {
    g.beginPath();
    g.ellipse(x, y, 18 * s, 9 * s, 0, 0, 7);
    g.moveTo(x + 14 * s, y);
    g.lineTo(x + 30 * s, y - 9 * s);
    g.lineTo(x + 30 * s, y + 9 * s);
    g.closePath();
    g.fill();
  }
  function seaweed(g, x, y, h, T, col) {
    g.strokeStyle = col;
    g.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      const bx = x + k * 16 - 16;
      g.lineWidth = 12 - k * 2;
      g.beginPath();
      g.moveTo(bx, y);
      for (let s = 1; s <= 6; s++) {
        const u = s / 6;
        g.lineTo(bx + Math.sin(T * 1.2 + u * 4 + k) * 16 * u, y - h * u * (1 - k * 0.15));
      }
      g.stroke();
    }
  }
  // えだサンゴ（太い線を丸くつなぐ）
  function coral(g, x, y, s, col, seed) {
    const k = s / 100;
    g.strokeStyle = col;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.lineWidth = 20 * k;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x - 4 * k, y - 70 * k, x + 6 * k, y - 120 * k);
    g.moveTo(x, y - 40 * k);
    g.quadraticCurveTo(x - 50 * k, y - 60 * k, x - 52 * k, y - 110 * k + seed * 20 * k);
    g.moveTo(x + 2 * k, y - 60 * k);
    g.quadraticCurveTo(x + 50 * k, y - 70 * k, x + 54 * k, y - 140 * k + seed * 30 * k);
    g.moveTo(x - 30 * k, y - 70 * k);
    g.lineTo(x - 70 * k, y - 80 * k);
    g.stroke();
    g.fillStyle = col;
    [[6, -120], [-52, -110 + seed * 20], [54, -140 + seed * 30], [-70, -80]].forEach(function (p) {
      g.beginPath(); g.arc(x + p[0] * k, y + p[1] * k, 14 * k, 0, 7); g.fill();
    });
  }
  // うしろの岩（遠くの まるい岩）
  function farRock(g, x, y, s, col) {
    g.fillStyle = col;
    g.beginPath();
    g.ellipse(x, y, 90 * s, 60 * s, 0, Math.PI, 0);
    g.ellipse(x + 70 * s, y, 60 * s, 40 * s, 0, Math.PI, 0);
    g.fill();
  }

  // 背景（淡く・低コントラスト。当たらないもの）
  function drawBack(g, camX, T, vw, lite) {
    // 空
    const sky = g.createLinearGradient(0, 0, 0, SURF_Y);
    sky.addColorStop(0, '#bfeaff');
    sky.addColorStop(1, '#f0fbff');
    g.fillStyle = sky;
    g.fillRect(0, 0, vw, SURF_Y + 14);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    for (let i = 0; i < 5; i++) cloud(g, mod(i * 520 + 160 - camX * 0.05 - T * 8, vw + 300) - 150, 38 + (i % 2) * 16, 0.55 + 0.12 * (i % 3));
    // 海
    const sea = g.createLinearGradient(0, SURF_Y, 0, H);
    sea.addColorStop(0, '#93e8f8');
    sea.addColorStop(0.35, '#5cc7ec');
    sea.addColorStop(1, '#3191d2');
    g.fillStyle = sea;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= vw + 40; x += 40) g.lineTo(x, waveY(x + camX, T));
    g.lineTo(vw + 40, H);
    g.closePath();
    g.fill();
    // 光の筋
    const rg = g.createLinearGradient(0, SURF_Y, 0, 960);
    rg.addColorStop(0, 'rgba(255,255,255,0.30)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    for (let i = 0; i < 7; i++) {
      const bx = mod(i * 330 + 120 - camX * 0.07, vw + 600) - 300 + Math.sin(T * 0.35 + i * 1.9) * 40;
      const w0 = 50 + (i % 3) * 30, w1 = 180 + (i % 2) * 120;
      g.beginPath();
      g.moveTo(bx, SURF_Y);
      g.lineTo(bx + w0, SURF_Y);
      g.lineTo(bx + w0 + 260 + w1, 960);
      g.lineTo(bx + 260, 960);
      g.closePath();
      g.fill();
    }
    // 遠くの岩影
    g.fillStyle = 'rgba(30,108,172,0.30)';
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= vw + 40; x += 40) {
      const u = (x + camX * 0.16) * 0.0021;
      g.lineTo(x, 790 - 130 * (0.5 + 0.3 * Math.sin(u) + 0.2 * Math.sin(u * 2.7 + 1.3) + 0.12 * Math.sin(u * 6.1)));
    }
    g.lineTo(vw + 40, H);
    g.fill();
    // 魚の群れ（淡い）
    g.fillStyle = 'rgba(22,84,148,0.24)';
    for (let s = 0; s < 3; s++) {
      const bx = mod(s * 820 + 300 - T * (36 + s * 8) - camX * 0.3, vw + 900) - 450;
      const by = 270 + s * 190 + Math.sin(T * 0.5 + s * 2) * 30;
      for (let f = 0; f < 7; f++) {
        fishShape(g, bx + (f % 3) * 48 + Math.floor(f / 3) * 24 + Math.sin(T * 2 + f) * 4, by + Math.floor(f / 3) * 30 - (f % 3) * 8 + Math.sin(T * 1.7 + f * 1.3) * 3, 1 - (f % 2) * 0.2);
      }
    }
    // 中景: 海藻とサンゴ（淡い）
    {
      const par = 0.4, sp = 230;
      const k0 = Math.floor((camX * par - 200) / sp), k1 = Math.ceil((camX * par + vw + 200) / sp);
      for (let k = k0; k <= k1; k++) {
        const h = hash(k);
        const x = k * sp - camX * par + h * 120;
        if (h < 0.5) seaweed(g, x, 1090, 150 + hash(k + 7) * 170, T + k, 'rgba(42,150,140,0.34)');
        else if (h < 0.85) coral(g, x, 1085, 95 + hash(k + 3) * 60, h > 0.7 ? '#6f9fd2' : '#62a9c4', hash(k + 11));
        else farRock(g, x, 1085, 1 + hash(k + 5) * 0.6, '#4f95c6');
      }
    }
    // ただよう泡
    g.strokeStyle = 'rgba(255,255,255,0.42)';
    g.lineWidth = 2.5;
    const nb = lite ? 12 : 26;
    g.beginPath();
    for (let i = 0; i < nb; i++) {
      const range = H - SURF_Y;
      const y = H - mod(T * (26 + hash(i + 50) * 40) + hash(i + 70) * range, range);
      const x = mod(hash(i + 90) * (vw + 200) - camX * 0.45 + Math.sin(T + i) * 10, vw + 200) - 100;
      const r = 3 + hash(i + 110) * 6;
      g.moveTo(x + r, y);
      g.arc(x, y, r, 0, 7);
    }
    g.stroke();
  }

  function bubble(g, x, y, r, a) {
    g.fillStyle = 'rgba(255,255,255,' + (0.18 * a) + ')';
    g.strokeStyle = 'rgba(255,255,255,' + (0.85 * a) + ')';
    g.lineWidth = Math.max(2, r * 0.22);
    g.beginPath();
    g.arc(x, y, r, 0, 7);
    g.fill();
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,' + (0.9 * a) + ')';
    g.beginPath();
    g.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, 7);
    g.fill();
  }
  function chevron(g, x, y, s, dir) {
    g.beginPath();
    g.moveTo(x - 26 * s, y + 14 * s * dir);
    g.lineTo(x, y - 14 * s * dir);
    g.lineTo(x + 26 * s, y + 14 * s * dir);
    g.stroke();
  }

  // 流れのゾーン（泡の上昇流 = 白い泡の柱＋上矢印 / 下向き海流 = 青い流線＋下矢印）
  function drawZones(g, w, camX, T, vw) {
    const zs = w.zones;
    for (let zi = 0; zi < zs.length; zi++) {
      const z = zs[zi];
      if (z.x1 < camX - 60 || z.x0 > camX + vw + 60) continue;
      const x0 = z.x0 - camX, x1 = z.x1 - camX, wd = x1 - x0;
      const seed = z.x0 * 0.013;
      g.save();
      if (z.type === 'up') {
        const cg = g.createLinearGradient(x0 - 50, 0, x1 + 50, 0);
        cg.addColorStop(0, 'rgba(230,253,255,0)');
        cg.addColorStop(0.16, 'rgba(230,253,255,0.36)');
        cg.addColorStop(0.84, 'rgba(230,253,255,0.36)');
        cg.addColorStop(1, 'rgba(230,253,255,0)');
        g.fillStyle = cg;
        g.fillRect(x0 - 50, 0, wd + 100, H);
        const n = Math.floor(wd / 18);
        const body = new Path2D(), shine = new Path2D();
        for (let i = 0; i < n; i++) {
          const sp = 150 + hash(seed + i * 3.1) * 140;
          const by = H - mod(T * sp + hash(seed + i * 7.7) * H, H - SURF_Y);
          const bx = x0 + 10 + hash(seed + i * 1.3) * (wd - 20) + Math.sin(T * 3 + i) * 5;
          const r = 5 + hash(seed + i * 5.3) * 11;
          body.moveTo(bx + r, by);
          body.arc(bx, by, r, 0, 7);
          shine.moveTo(bx - r * 0.35 + r * 0.25, by - r * 0.35);
          shine.arc(bx - r * 0.35, by - r * 0.35, r * 0.25, 0, 7);
        }
        g.fillStyle = 'rgba(255,255,255,0.16)';
        g.fill(body);
        g.strokeStyle = 'rgba(255,255,255,0.8)';
        g.lineWidth = 2.6;
        g.stroke(body);
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.fill(shine);
        g.lineCap = 'round';
        g.lineJoin = 'round';
        const cols = wd > 560 ? [0.25, 0.75] : [0.5];
        for (let c = 0; c < cols.length; c++) {
          for (let r = 0; r < 6; r++) {
            const y = mod(-T * 190 + r * 220 + c * 110, H + 220) - 110;
            g.strokeStyle = 'rgba(40,170,215,0.55)';
            g.lineWidth = 18;
            chevron(g, x0 + cols[c] * wd, y, 1.4, 1);
            g.strokeStyle = 'rgba(255,255,255,0.95)';
            g.lineWidth = 9;
            chevron(g, x0 + cols[c] * wd, y, 1.4, 1);
          }
        }
      } else {
        const cg = g.createLinearGradient(x0 - 50, 0, x1 + 50, 0);
        cg.addColorStop(0, 'rgba(30,70,200,0)');
        cg.addColorStop(0.16, 'rgba(30,70,200,0.24)');
        cg.addColorStop(0.84, 'rgba(30,70,200,0.24)');
        cg.addColorStop(1, 'rgba(30,70,200,0)');
        g.fillStyle = cg;
        g.fillRect(x0 - 50, 0, wd + 100, H);
        g.lineCap = 'round';
        const nl = Math.max(3, Math.floor(wd / 70));
        g.setLineDash([70, 46]);
        for (let i = 0; i < nl; i++) {
          const lx = x0 + (i + 0.5) / nl * wd;
          g.lineDashOffset = -T * (280 + (i % 3) * 40) - i * 37;
          g.strokeStyle = i % 2 ? 'rgba(200,225,255,0.55)' : 'rgba(30,80,215,0.55)';
          g.lineWidth = i % 2 ? 4 : 7;
          g.beginPath();
          for (let y = 0; y <= H; y += 40) {
            const xx = lx + Math.sin(y * 0.012 + i * 1.7 + T * 0.8) * 12;
            if (y === 0) g.moveTo(xx, y); else g.lineTo(xx, y);
          }
          g.stroke();
        }
        g.setLineDash([]);
        g.lineJoin = 'round';
        const cols = wd > 600 ? [0.25, 0.75] : [0.5];
        for (let c = 0; c < cols.length; c++) {
          for (let r = 0; r < 6; r++) {
            const y = mod(T * 200 + r * 220 + c * 110, H + 220) - 110;
            g.strokeStyle = 'rgba(255,255,255,0.9)';
            g.lineWidth = 18;
            chevron(g, x0 + cols[c] * wd, y, 1.4, -1);
            g.strokeStyle = '#2a58d8';
            g.lineWidth = 9;
            chevron(g, x0 + cols[c] * wd, y, 1.4, -1);
          }
        }
      }
      g.restore();
    }
  }

  // cont = true のときは いまのパスに つなげる（多角形の一部）
  function edgePath(g, arr, i0, i1, camX, off, cont) {
    for (let i = i0; i <= i1; i++) {
      const x = X0 + i * SAMPLE - camX;
      if (i === i0 && !cont) g.moveTo(x, arr[i] + off); else g.lineTo(x, arr[i] + off);
    }
  }

  function starfish(g, x, y, r, a) {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.45 : r;
      const an = -Math.PI / 2 + i * Math.PI / 5;
      if (i === 0) g.moveTo(Math.cos(an) * rr, Math.sin(an) * rr); else g.lineTo(Math.cos(an) * rr, Math.sin(an) * rr);
    }
    g.closePath();
    g.fillStyle = '#ff8f6b';
    g.fill();
    g.strokeStyle = '#a8432e';
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = '#ffd0b8';
    g.beginPath();
    g.arc(0, 0, r * 0.18, 0, 7);
    g.fill();
    g.restore();
  }

  // 地形の色（R4: カオスゾーンでは 色を まぜて 変える）
  const PAL_N = { cf: [184, 118, 90, 1], cd: [163, 99, 75, 1], ch: [236, 170, 124, 0.9], ol: [77, 42, 58, 1], ff: [211, 146, 88, 1], fd: [191, 127, 72, 1], fh: [246, 212, 149, 1] };
  const PAL_DEF = { cf: '#b8765a', cd: '#a3634b', ch: 'rgba(236,170,124,0.9)', ol: ROCK_OL, ff: '#d39258', fd: '#bf7f48', fh: '#f6d495', star: true };
  // 地形（当たるもの: はっきりした色と ふちどり）
  function drawTerrain(g, w, camX, vw, pal) {
    const i0 = Math.max(0, Math.floor((camX - 40 - X0) / SAMPLE));
    const i1 = Math.min(w.n - 1, Math.ceil((camX + vw + 40 - X0) / SAMPLE));
    if (i1 <= i0) return;
    pal = pal || PAL_DEF;
    g.save();
    g.lineJoin = 'round';
    g.lineCap = 'round';
    // --- 天井 ---
    let anyTop = false;
    for (let i = i0; i <= i1; i++) if (w.top[i] > -30) { anyTop = true; break; }
    if (anyTop) {
      g.beginPath();
      g.moveTo(X0 + i0 * SAMPLE - camX, -40);
      edgePath(g, w.top, i0, i1, camX, 0, true);
      g.lineTo(X0 + i1 * SAMPLE - camX, -40);
      g.closePath();
      g.fillStyle = pal.cf;
      g.fill();
      g.fillStyle = pal.cd;
      g.beginPath();
      for (let i = Math.max(0, i0 - (i0 % 3)); i <= i1; i += 3) {
        if (hash(i) > 0.55) continue;
        const x = X0 + i * SAMPLE - camX + hash(i + 3) * 30;
        const y = w.top[i] - 44 - hash(i + 9) * 150;
        if (y < -40) continue;
        const rx = 12 + hash(i + 5) * 16;
        g.moveTo(x + rx, y);
        g.ellipse(x, y, rx, 8 + hash(i + 6) * 10, 0, 0, 7);
      }
      g.fill();
      g.beginPath();
      edgePath(g, w.top, i0, i1, camX, -11);
      g.strokeStyle = pal.ch;
      g.lineWidth = 8;
      g.stroke();
      g.beginPath();
      edgePath(g, w.top, i0, i1, camX, 0);
      g.strokeStyle = pal.ol;
      g.lineWidth = 8;
      g.stroke();
    }
    // --- 床（海底） ---
    g.beginPath();
    g.moveTo(X0 + i0 * SAMPLE - camX, H + 40);
    edgePath(g, w.bot, i0, i1, camX, 0, true);
    g.lineTo(X0 + i1 * SAMPLE - camX, H + 40);
    g.closePath();
    g.fillStyle = pal.ff;
    g.fill();
    g.fillStyle = pal.fd;
    g.beginPath();
    for (let i = Math.max(0, i0 - (i0 % 3)); i <= i1; i += 3) {
      if (hash(i + 0.5) > 0.5) continue;
      const x = X0 + i * SAMPLE - camX + hash(i + 2) * 30;
      const y = w.bot[i] + 44 + hash(i + 8) * 120;
      if (y > H + 40) continue;
      const rx = 12 + hash(i + 4) * 16;
      g.moveTo(x + rx, y);
      g.ellipse(x, y, rx, 7 + hash(i + 7) * 9, 0, 0, 7);
    }
    g.fill();
    g.beginPath();
    edgePath(g, w.bot, i0, i1, camX, 10);
    g.strokeStyle = pal.fh;
    g.lineWidth = 16;
    g.stroke();
    g.beginPath();
    edgePath(g, w.bot, i0, i1, camX, 0);
    g.strokeStyle = pal.ol;
    g.lineWidth = 8;
    g.stroke();
    // かべの小物（ヒトデ）
    if (pal.star) for (let i = i0 - (i0 % 23); i <= i1; i += 23) {
      if (i < 0 || hash(i * 1.7) > 0.45) continue;
      starfish(g, X0 + i * SAMPLE - camX, w.bot[i] + 16, 15, hash(i) * 6);
    }
    g.restore();
  }

  /* ---------- R4 の しかけの 絵 ---------- */
  // 上下が 入れかわる マーク（まるい 2本の 矢印）
  function swapIcon(g, x, y, s, rot, col) {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.scale(s, s);
    g.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      g.strokeStyle = pass ? col : 'rgba(255,255,255,0.9)';
      g.fillStyle = g.strokeStyle;
      g.lineWidth = pass ? 8 : 16;
      for (let k = 0; k < 2; k++) {
        const a0 = k * Math.PI + 0.35, a1 = k * Math.PI + 2.55;
        g.beginPath(); g.arc(0, 0, 32, a0, a1); g.stroke();
        const hx = Math.cos(a1) * 32, hy = Math.sin(a1) * 32, ta = a1 + Math.PI / 2;
        const hs = pass ? 15 : 21;
        g.beginPath();
        g.moveTo(hx + Math.cos(ta) * hs, hy + Math.sin(ta) * hs);
        g.lineTo(hx + Math.cos(ta + 2.3) * hs, hy + Math.sin(ta + 2.3) * hs);
        g.lineTo(hx + Math.cos(ta - 2.3) * hs, hy + Math.sin(ta - 2.3) * hs);
        g.closePath();
        g.fill();
      }
    }
    g.restore();
  }
  // あべこべ海流の区間（むらさきの帯・入口と出口の点線・まわる マーク）
  function drawFlips(g, w, camX, T, vw) {
    const zs = w.flips;
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i];
      if (z.x1 < camX - 60 || z.x0 > camX + vw + 60) continue;
      const x0 = z.x0 - camX, x1 = z.x1 - camX, wd = x1 - x0;
      g.save();
      const cg = g.createLinearGradient(x0 - 40, 0, x1 + 40, 0);
      cg.addColorStop(0, 'rgba(214,70,230,0)');
      cg.addColorStop(0.07, 'rgba(214,70,230,0.28)');
      cg.addColorStop(0.93, 'rgba(214,70,230,0.28)');
      cg.addColorStop(1, 'rgba(214,70,230,0)');
      g.fillStyle = cg;
      g.fillRect(x0 - 40, 0, wd + 80, H);
      g.setLineDash([30, 20]);
      g.lineDashOffset = -T * 70;
      g.beginPath();
      g.moveTo(x0, 0); g.lineTo(x0, H);
      g.moveTo(x1, 0); g.lineTo(x1, H);
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 10;
      g.stroke();
      g.strokeStyle = '#c43ad6';
      g.lineWidth = 5;
      g.stroke();
      g.setLineDash([]);
      const cols = Math.max(1, Math.round(wd / 460));
      for (let c = 0; c < cols; c++) {
        const cx = x0 + (c + 0.5) / cols * wd;
        for (let r = 0; r < 4; r++) {
          const cy = mod(r * 300 + T * 46 + c * 150, H + 200) - 100;
          swapIcon(g, cx, cy, 0.95, T * 1.6 + r * 1.3 + c, 'rgba(196,58,214,0.85)');
        }
      }
      g.restore();
    }
  }
  // うずまき（まわりの うすい円 = すいこむ範囲、まん中の くらい円 = 当たると アウト）
  function drawVortex(g, x, y, o, T) {
    g.save();
    g.translate(x, y);
    const gr = g.createRadialGradient(0, 0, o.r, 0, 0, o.R);
    gr.addColorStop(0, 'rgba(150,70,225,0.36)');
    gr.addColorStop(1, 'rgba(150,70,225,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(0, 0, o.R, 0, 7); g.fill();
    const rot = T * 2.4 * o.spin + o.ph;
    g.lineCap = 'round';
    g.beginPath();
    for (let a = 0; a < 4; a++) {
      for (let i = 0; i <= 16; i++) {
        const u = i / 16, rr = o.r + 6 + u * (o.R * 0.84 - o.r - 6);
        const an = rot + a * Math.PI / 2 + u * 2.4 * o.spin;
        if (i === 0) g.moveTo(Math.cos(an) * rr, Math.sin(an) * rr); else g.lineTo(Math.cos(an) * rr, Math.sin(an) * rr);
      }
    }
    g.strokeStyle = 'rgba(240,222,255,0.55)';
    g.lineWidth = 9;
    g.stroke();
    // すいこまれる つぶ
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const u = mod(T * 0.5 + i / 10, 1), rr = o.r + (o.R * 0.86 - o.r) * (1 - u), an = rot * 1.2 + i * 2.39 + u * 3 * o.spin;
      const px = Math.cos(an) * rr, py = Math.sin(an) * rr, pr = 3 + 4 * (1 - u);
      g.moveTo(px + pr, py); g.arc(px, py, pr, 0, 7);
    }
    g.fill();
    // まん中
    const cg = g.createRadialGradient(0, 0, 4, 0, 0, o.r + 8);
    cg.addColorStop(0, '#12021f');
    cg.addColorStop(0.68, '#3c0f60');
    cg.addColorStop(1, '#9440d8');
    g.fillStyle = cg;
    g.beginPath(); g.arc(0, 0, o.r + 6, 0, 7); g.fill();
    g.strokeStyle = '#f4dcff';
    g.lineWidth = 6;
    g.stroke();
    g.rotate(rot * 1.7);
    g.beginPath();
    for (let i = 0; i <= 22; i++) { const an = i * 0.55, rr = 3 + i * 1.6; if (i === 0) g.moveTo(rr, 0); else g.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); }
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 4;
    g.stroke();
    g.restore();
  }
  // さかな 1ぴき（左むき）
  function drawFish1(g, x, y, hue, T, k) {
    g.save();
    g.translate(x, y);
    g.lineJoin = 'round';
    const body = hue ? '#2f63c4' : '#e0503c', dark = hue ? '#15306a' : '#7a1f14', fin = hue ? '#6f9cf0' : '#ff9a6a';
    // 速さの線
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 4;
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < 3; i++) { const yy = -14 + i * 14, l = 40 + 24 * ((i + k) % 2); g.moveTo(70, yy); g.lineTo(70 + l, yy); }
    g.stroke();
    const sw = Math.sin(T * 14 + k) * 6;
    g.beginPath();
    g.moveTo(30, 0);
    g.lineTo(64, -20 + sw); g.lineTo(58, 0); g.lineTo(64, 20 + sw);
    g.closePath();
    g.fillStyle = fin; g.fill();
    g.strokeStyle = dark; g.lineWidth = 4; g.stroke();
    g.beginPath();
    g.ellipse(0, 0, 38, 25, 0, 0, 7);
    g.fillStyle = body; g.fill();
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.ellipse(-4, 10, 24, 8, 0, 0, 7); g.fill();
    // め（つりめ）
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(-18, -6, 8, 0, 7); g.fill();
    g.fillStyle = '#1a1020';
    g.beginPath(); g.arc(-20, -5, 4, 0, 7); g.fill();
    g.strokeStyle = '#1a1020'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(-30, -18); g.lineTo(-10, -12); g.stroke();
    g.restore();
  }
  function drawFishSchool(g, o, camX, px, T, drift, vw) {
    for (let j = o.n - 1; j >= 0; j--) {
      const p = fishPos(o, px, j);
      const fx = p[0] - camX - drift;
      if (fx < -120 || fx > vw + 160) continue;
      drawFish1(g, fx, p[1], o.hue, T, j);
    }
  }
  // さかなが 来る 前の 予告（右はしの「！」と 来る みちの 赤い帯）
  function drawFishWarn(g, w, camX, vw, T) {
    const obs = w.obs, px = w.px, sp = Math.max(300, w.speed || speedAt(w, px));
    for (let i = lowerObs(w, camX); i < obs.length && obs[i].x < camX + vw + 4000; i++) {
      const o = obs[i];
      if (o.kind !== 'fish') continue;
      const lead = fishPos(o, px, 0)[0] - camX;
      if (lead <= vw - 20) continue;
      const tIn = (lead - vw) / ((1 + o.k) * sp);
      if (tIn > 1.8) continue;
      const a = 0.6 + 0.4 * Math.abs(Math.sin(T * 4));
      const lx = Math.min(Math.max(0, o.xm - camX - 80), vw - 420);   // すれちがう所が 画面の外でも 右はしに 帯を 見せる
      g.save();
      g.fillStyle = 'rgba(255,60,70,' + (0.2 * a).toFixed(3) + ')';
      g.fillRect(lx, o.y - FISH_LH, vw - lx, FISH_LH * 2);
      g.setLineDash([22, 14]);
      g.lineDashOffset = T * 120;
      g.strokeStyle = 'rgba(255,80,90,' + (0.75 * a).toFixed(3) + ')';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(lx, o.y - FISH_LH); g.lineTo(vw, o.y - FISH_LH);
      g.moveTo(lx, o.y + FISH_LH); g.lineTo(vw, o.y + FISH_LH);
      g.stroke();
      g.setLineDash([]);
      const mx = vw - 78, s = 1 + 0.08 * Math.sin(T * 8);
      g.translate(mx, o.y);
      g.scale(s, s);
      g.beginPath();
      g.moveTo(-74, 0); g.lineTo(-44, -26); g.lineTo(-44, 26); g.closePath();
      g.fillStyle = '#ff3b47'; g.fill();
      g.beginPath(); g.arc(0, 0, 44, 0, 7);
      g.fillStyle = '#ff3b47'; g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 7; g.stroke();
      A.text(g, '！', 2, 4, { size: 64, color: '#ffffff' });
      g.restore();
    }
  }
  // おちてくる岩（落ちる前は 天井で ゆれて、着地する場所を 点線の丸で 見せる）
  function drawDrop(g, o, camX, px, T) {
    const x = o.x - camX;
    if (px < o.xe) {
      const y = dropY(o, px);
      g.save();
      g.setLineDash([16, 12]);
      g.lineDashOffset = -T * 40;
      g.beginPath();
      g.moveTo(x, y + o.r * 0.9); g.lineTo(x, o.y - o.r * 0.95);
      g.strokeStyle = 'rgba(255,236,120,0.75)';
      g.lineWidth = 6;
      g.stroke();
      g.beginPath();
      g.arc(x, o.y, o.r * 0.95, 0, 7);
      g.strokeStyle = 'rgba(60,20,40,0.45)';
      g.lineWidth = 10;
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 5;
      g.stroke();
      g.restore();
      const near = px > o.xs - 1100 && px < o.xs;
      drawRock(g, x + (near ? Math.sin(T * 47) * 4 : 0), y, o.r, o.seed);
      if (near) {                       // ぱらぱら 小石
        g.fillStyle = 'rgba(120,80,60,0.85)';
        for (let i = 0; i < 4; i++) {
          const u = mod(T * 1.6 + i * 0.27, 1);
          g.beginPath(); g.arc(x - 40 + i * 26, y + o.r * 0.7 + u * 160, 5, 0, 7); g.fill();
        }
      }
    } else drawRock(g, x, o.y, o.r, o.seed);
  }
  // カオスゾーンの 入口の 文字
  function drawGates(g, w, camX, T) {
    for (let i = 0; i < HARD_AREAS.length; i++) {
      const d = HARD_AREAS[i], gx = d.x - camX, chaos = d.chaos;
      if (gx < -900 || gx > 2400) continue;
      const tp = effTop(w, d.x), bt = botAt(w, d.x);
      g.save();
      g.setLineDash([20, 16]);
      g.lineDashOffset = T * 50;
      g.beginPath(); g.moveTo(gx, tp); g.lineTo(gx, bt);
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 10; g.stroke();
      g.strokeStyle = d.col; g.lineWidth = 5; g.stroke();
      g.setLineDash([]);
      A.text(g, 'ここから エリア' + d.n, gx, tp + 46, { size: 36, color: '#ffffff', stroke: chaos ? '#8a0a30' : '#1a2a50', strokeWidth: 8 });
      A.text(g, d.name, gx, tp + 98, { size: 50, color: chaos ? '#ff4f7a' : '#ffffff', stroke: chaos ? '#2a0010' : d.col, strokeWidth: 10 });
      g.restore();
    }
  }
  // エリアの 見た目（いまの エリアと 1つ前を まぜる）。エリア1 と ほかのコースは null（元のまま かく）
  function rgbaStr(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a === undefined ? c[3] : a).toFixed(3) + ')'; }
  function mixArr(a, b, t) { const o = []; for (let i = 0; i < a.length; i++) o.push(lerp(a[i], b[i], t)); return o; }
  function mixPal(pa, pb, t) {
    const p = { star: t < 0.5 ? pa.star : pb.star };
    for (const k in PAL_N) p[k] = rgbaStr(mixArr(pa[k], pb[k], t));
    return p;
  }
  const LOOK1 = { sea: [0, 0, 0, 0], pal: Object.assign({ star: true }, PAL_N) };
  function lookOf(n) { const d = areaDef(n); return d ? { sea: d.look.sea || [0, 0, 0, 0], pal: Object.assign({ star: false }, d.look.pal), cb: d.look.cb, dark: d.look.dark || 0, chaos: !!d.chaos } : LOOK1; }
  function areaLook(w, xr) {
    if (!w.c.late || xr < HARD_AREAS[0].x - 700) return null;
    const n = areaIndex(w, xr, 700);
    const t = clamp01((xr - areaDef(n).x + 700) / 1600);
    const a = lookOf(n - 1), b = lookOf(n);
    const out = { n: n, pal: mixPal(a.pal, b.pal, t), chaosT: 0, cb: null, sea: null, dark: 0 };
    if (b.chaos && a.chaos) { out.chaosT = 1; out.cb = [0, 1, 2].map(function (i) { return mixArr(a.cb[i], b.cb[i], t); }); out.dark = lerp(a.dark, b.dark, t); }
    else if (b.chaos) { out.chaosT = t; out.cb = b.cb; out.sea = a.sea; out.dark = b.dark * t; }
    else out.sea = mixArr(a.sea, b.sea, t);
    return out;
  }
  // 海の色（エリア2〜5）と、カオスへ 入るときの 赤むらさき
  function drawSea(g, vw, L) {
    if (L.sea && L.sea[3] * (1 - L.chaosT) > 0.002) {
      g.fillStyle = rgbaStr(L.sea, L.sea[3] * (1 - L.chaosT));
      g.fillRect(0, 0, vw, H);
    }
    if (L.chaosT > 0.002) {
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, rgbaStr(L.cb[0], 0.85 * L.chaosT));
      gr.addColorStop(1, rgbaStr(L.cb[2], 0.92 * L.chaosT));
      g.fillStyle = gr;
      g.fillRect(0, 0, vw, H);
    }
  }
  // カオスゾーンの 背景（ふつうの背景は ほぼ 見えなくなるので かかずに 軽く かく）
  function drawChaosBack(g, camX, T, vw, cb) {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, rgbaStr(cb[0], 1));
    gr.addColorStop(0.4, rgbaStr(cb[1], 1));
    gr.addColorStop(1, rgbaStr(cb[2], 1));
    g.fillStyle = gr;
    g.fillRect(0, 0, vw, H);
    // 遠くの岩影
    g.fillStyle = 'rgba(10,0,24,0.35)';
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= vw + 40; x += 40) {
      const u = (x + camX * 0.16) * 0.0021;
      g.lineTo(x, 790 - 130 * (0.5 + 0.3 * Math.sin(u) + 0.2 * Math.sin(u * 2.7 + 1.3) + 0.12 * Math.sin(u * 6.1)));
    }
    g.lineTo(vw + 40, H);
    g.fill();
    // ただよう つぶ（ゆっくり）
    g.fillStyle = 'rgba(255,120,200,0.28)';
    g.beginPath();
    for (let i = 0; i < 18; i++) {
      const y = H - mod(T * (18 + hash(i + 50) * 30) + hash(i + 70) * H, H);
      const x = mod(hash(i + 90) * (vw + 200) - camX * 0.45, vw + 200) - 100;
      const r = 2 + hash(i + 110) * 4;
      g.moveTo(x + r, y);
      g.arc(x, y, r, 0, 7);
    }
    g.fill();
  }
  // くらい海（カオスゾーン）: 潜水艇の 前だけ 明るい
  function drawDark(g, w, camX, vw, a) {
    if (a <= 0.002) return;
    const s = w.sub, cx = s.x - camX + 240, cy = s.y;
    const gr = g.createRadialGradient(cx, cy, 300, cx, cy, 1150);
    gr.addColorStop(0, 'rgba(6,0,16,0)');
    gr.addColorStop(0.45, 'rgba(6,0,16,' + (0.5 * a).toFixed(3) + ')');
    gr.addColorStop(1, 'rgba(6,0,16,' + a.toFixed(3) + ')');
    g.fillStyle = gr;
    g.fillRect(0, 0, vw, H);
  }

  function drawSign(g, x, yb, type, T) {
    if (type !== 'up' && type !== 'down') { drawSign2(g, x, yb, type, T); return; }
    g.save();
    g.translate(x, yb + 6);
    g.rotate(Math.sin(T * 1.6 + x * 0.01) * 0.04);
    g.lineJoin = 'round';
    g.fillStyle = '#a7774c';
    g.strokeStyle = '#5b3a22';
    g.lineWidth = 4;
    g.beginPath();
    g.rect(-7, -82, 14, 82);
    g.fill();
    g.stroke();
    const up = type === 'up';
    g.beginPath();
    g.arc(0, -118, 44, 0, 7);
    g.fillStyle = up ? '#effdff' : '#e4ecff';
    g.fill();
    g.strokeStyle = up ? '#1aa5cc' : '#2a55cf';
    g.lineWidth = 8;
    g.stroke();
    // 矢印
    g.save();
    g.translate(0, -118);
    if (!up) g.rotate(Math.PI);
    g.beginPath();
    g.moveTo(0, -32); g.lineTo(24, -6); g.lineTo(9, -6); g.lineTo(9, 26); g.lineTo(-9, 26); g.lineTo(-9, -6); g.lineTo(-24, -6);
    g.closePath();
    g.fillStyle = up ? '#29b6e0' : '#2a55cf';
    g.fill();
    g.restore();
    if (up) {
      g.strokeStyle = '#29b6e0';
      g.lineWidth = 3;
      [[-26, -96, 6], [26, -132, 7], [24, -96, 5]].forEach(function (b) { g.beginPath(); g.arc(b[0], b[1], b[2], 0, 7); g.stroke(); });
    } else {
      g.strokeStyle = '#2a55cf';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(-30, -150); g.quadraticCurveTo(-22, -142, -30, -134);
      g.moveTo(30, -150); g.quadraticCurveTo(38, -142, 30, -134);
      g.stroke();
    }
    g.restore();
  }

  // R4 の しかけの 看板（あべこべ・うず・さかな・落ちる岩）
  const SIGN2 = { flip: ['#fbe6ff', '#b03ad8'], vortex: ['#efe4ff', '#6a2fb0'], fish: ['#ffe8e6', '#e0303c'], drop: ['#fff1df', '#8a5a3a'] };
  function drawSign2(g, x, yb, type, T) {
    const cc = SIGN2[type] || SIGN2.drop;
    g.save();
    g.translate(x, yb + 6);
    g.rotate(Math.sin(T * 1.6 + x * 0.01) * 0.04);
    g.lineJoin = 'round';
    g.fillStyle = '#a7774c';
    g.strokeStyle = '#5b3a22';
    g.lineWidth = 4;
    g.beginPath();
    g.rect(-7, -82, 14, 82);
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(0, -118, 44, 0, 7);
    g.fillStyle = cc[0];
    g.fill();
    g.strokeStyle = cc[1];
    g.lineWidth = 8;
    g.stroke();
    if (type === 'flip') swapIcon(g, 0, -118, 0.72, T * 1.2, cc[1]);
    else if (type === 'vortex') {
      g.beginPath();
      for (let i = 0; i <= 26; i++) { const an = i * 0.5 + T * 3, rr = 2 + i * 1.2; if (i === 0) g.moveTo(rr, -118); else g.lineTo(Math.cos(an) * rr, -118 + Math.sin(an) * rr); }
      g.strokeStyle = cc[1]; g.lineWidth = 6; g.lineCap = 'round'; g.stroke();
    } else if (type === 'fish') {
      g.save(); g.translate(-4, -118); g.scale(0.62, 0.62); drawFish1(g, 0, 0, 0, T, 0); g.restore();
      A.text(g, '！', 30, -150, { size: 40, color: cc[1], stroke: '#fff', strokeWidth: 6 });
    } else {
      drawRock(g, 0, -132, 18, 0.3);
      g.beginPath(); g.moveTo(0, -110); g.lineTo(0, -88);
      g.moveTo(-10, -98); g.lineTo(0, -86); g.lineTo(10, -98);
      g.strokeStyle = cc[1]; g.lineWidth = 6; g.lineCap = 'round'; g.stroke();
    }
    g.restore();
  }

  function drawRock(g, x, y, R, seed) {
    g.save();
    g.translate(x, y);
    g.beginPath();
    for (let i = 0; i <= 28; i++) {
      const a = i / 28 * Math.PI * 2;
      const r = R * (1 + 0.06 * Math.sin(a * 3 + seed * 10) + 0.04 * Math.sin(a * 5 + seed * 7));
      if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r); else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    const gr = g.createRadialGradient(-R * 0.35, -R * 0.35, R * 0.1, 0, 0, R * 1.05);
    gr.addColorStop(0, '#c9b2c4');
    gr.addColorStop(1, '#7f6380');
    g.fillStyle = gr;
    g.fill();
    g.lineJoin = 'round';
    g.strokeStyle = ROCK_OL;
    g.lineWidth = 8;
    g.stroke();
    g.fillStyle = 'rgba(90,60,90,0.35)';
    [[0.3, 0.25, 0.16], [-0.25, 0.4, 0.11], [0.45, -0.2, 0.09]].forEach(function (s) { g.beginPath(); g.arc(s[0] * R, s[1] * R, s[2] * R, 0, 7); g.fill(); });
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.beginPath();
    g.ellipse(-R * 0.38, -R * 0.42, R * 0.22, R * 0.11, -0.6, 0, 7);
    g.fill();
    g.restore();
  }

  function drawJelly(g, x, y, T, hue, ph) {
    const pulse = Math.sin(T * 3 + ph);
    const pink = hue === 0;
    g.save();
    g.translate(x, y);
    g.fillStyle = pink ? 'rgba(255,160,215,0.22)' : 'rgba(200,160,255,0.22)';
    g.beginPath();
    g.arc(0, 4, 88, 0, 7);
    g.fill();
    // あし
    g.lineCap = 'round';
    for (let k = 0; k < 5; k++) {
      const tx = -36 + k * 18;
      g.beginPath();
      for (let s = 0; s <= 10; s++) {
        const u = s / 10;
        const px = tx + Math.sin(T * 3 + k * 1.3 + u * 6 + ph) * 7 * u;
        const py = 10 + u * (78 + (k % 2) * 8);
        if (s === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.strokeStyle = pink ? '#c2337f' : '#6f39c0';
      g.lineWidth = 11;
      g.stroke();
      g.strokeStyle = pink ? '#ff9fd2' : '#c7a4ff';
      g.lineWidth = 6;
      g.stroke();
    }
    // かさ
    g.save();
    g.scale(1 + 0.05 * pulse, 1 - 0.05 * pulse);
    g.beginPath();
    g.moveTo(-60, 14);
    g.bezierCurveTo(-64, -78, 64, -78, 60, 14);
    for (let k = 0; k < 4; k++) {
      const x1 = 60 - k * 30;
      g.quadraticCurveTo(x1 - 15, 26, x1 - 30, 14);
    }
    g.closePath();
    const gr = g.createRadialGradient(-14, -34, 6, 0, -10, 76);
    gr.addColorStop(0, pink ? '#ffe3f3' : '#f0e4ff');
    gr.addColorStop(1, pink ? '#ff83c3' : '#ad82ff');
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = pink ? '#c2337f' : '#6f39c0';
    g.lineWidth = 6;
    g.lineJoin = 'round';
    g.stroke();
    // かお
    g.fillStyle = '#4a2140';
    g.beginPath(); g.ellipse(-17, -14, 5, 7, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(17, -14, 5, 7, 0, 0, 7); g.fill();
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(-15, -17, 2, 0, 7); g.fill();
    g.beginPath(); g.arc(19, -17, 2, 0, 7); g.fill();
    g.strokeStyle = '#4a2140';
    g.lineWidth = 3.5;
    g.beginPath(); g.arc(0, -6, 8, 0.2, Math.PI - 0.2); g.stroke();
    g.fillStyle = 'rgba(255,90,150,0.45)';
    g.beginPath(); g.ellipse(-30, -4, 8, 5, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(30, -4, 8, 5, 0, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.lineWidth = 6;
    g.beginPath(); g.arc(-4, -18, 40, Math.PI * 1.15, Math.PI * 1.42); g.stroke();
    g.restore();
    g.restore();
  }

  // 潜水艇（o: ang, face, prop, sq, T, lamp, scale）
  function drawSub(g, x, y, o) {
    g.save();
    g.translate(x, y);
    if (o.scale) g.scale(o.scale, o.scale);
    g.rotate(o.ang || 0);
    if (o.sq) g.scale(1 + o.sq, 1 - o.sq);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    // ライトの光
    if (o.lamp) {
      const lg = g.createLinearGradient(96, 0, 430, 0);
      lg.addColorStop(0, 'rgba(255,252,210,0.42)');
      lg.addColorStop(1, 'rgba(255,252,210,0)');
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(94, 6); g.lineTo(430, -64); g.lineTo(430, 90);
      g.closePath();
      g.fill();
    }
    // せんぼうきょう
    g.beginPath();
    g.moveTo(-8, -62); g.lineTo(-8, -96); g.lineTo(14, -96);
    g.strokeStyle = OL; g.lineWidth = 15; g.stroke();
    g.strokeStyle = '#ffb52e'; g.lineWidth = 7; g.stroke();
    g.beginPath(); g.arc(17, -96, 8, 0, 7);
    g.fillStyle = '#c7f2ff'; g.fill();
    g.strokeStyle = OL; g.lineWidth = 4; g.stroke();
    // とう
    A.roundRect(g, -46, -80, 70, 42, 15);
    g.fillStyle = '#ffd03a'; g.fill();
    g.strokeStyle = OL; g.lineWidth = 6; g.stroke();
    // おびれ
    g.fillStyle = '#ff9b2e';
    g.beginPath();
    g.moveTo(-74, -18); g.lineTo(-108, -50); g.quadraticCurveTo(-122, -46, -116, -28); g.lineTo(-92, 0);
    g.closePath(); g.fill(); g.strokeStyle = OL; g.lineWidth = 5; g.stroke();
    g.beginPath();
    g.moveTo(-74, 26); g.lineTo(-108, 58); g.quadraticCurveTo(-122, 54, -116, 36); g.lineTo(-92, 8);
    g.closePath(); g.fill(); g.stroke();
    // プロペラ
    g.fillStyle = '#9aa9b8';
    g.fillRect(-122, -5, 30, 12);
    g.strokeRect(-122, -5, 30, 12);
    const c = Math.cos(o.prop || 0), c2 = Math.cos((o.prop || 0) + Math.PI / 2);
    g.fillStyle = '#ff7b45';
    g.beginPath(); g.ellipse(-126, 1 + 17 * c, 8, 17 * Math.abs(c) + 3, 0, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#ff9a5e';
    g.beginPath(); g.ellipse(-126, 1 - 17 * c2, 8, 17 * Math.abs(c2) + 3, 0, 0, 7); g.fill(); g.stroke();
    g.fillStyle = '#ffd03a';
    g.beginPath(); g.arc(-126, 1, 8, 0, 7); g.fill(); g.stroke();
    // からだ
    g.beginPath();
    g.ellipse(0, 4, 98, 60, 0, 0, Math.PI * 2);
    const bg = g.createLinearGradient(0, -56, 0, 64);
    bg.addColorStop(0, '#fff48e');
    bg.addColorStop(0.45, '#ffd43b');
    bg.addColorStop(1, '#f5ad1c');
    g.fillStyle = bg;
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = '#ff9a2e';
    g.fillRect(-110, 34, 220, 13);
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.beginPath(); g.ellipse(-34, -30, 46, 13, -0.18, 0, 7); g.fill();
    g.restore();
    g.strokeStyle = OL;
    g.lineWidth = 6;
    g.beginPath();
    g.ellipse(0, 4, 98, 60, 0, 0, Math.PI * 2);
    g.stroke();
    // リベット
    g.fillStyle = '#e08f12';
    for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(-70 + i * 18, 22 - Math.abs(i - 2) * 2, 3.2, 0, 7); g.fill(); }
    // ライト
    g.beginPath(); g.arc(92, 12, 9, 0, 7);
    g.fillStyle = '#fff8c8'; g.fill();
    g.strokeStyle = OL; g.lineWidth = 4; g.stroke();
    // まど
    const wx = 28, wy = -4;
    g.beginPath(); g.arc(wx, wy, 45, 0, 7);
    g.fillStyle = '#d9e2ec'; g.fill();
    g.strokeStyle = OL; g.lineWidth = 5; g.stroke();
    g.fillStyle = '#9aa9b8';
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + 0.4; g.beginPath(); g.arc(wx + Math.cos(a) * 40, wy + Math.sin(a) * 40, 2.6, 0, 7); g.fill(); }
    g.beginPath(); g.arc(wx, wy, 34, 0, 7);
    const gg = g.createRadialGradient(wx - 10, wy - 12, 4, wx, wy, 36);
    gg.addColorStop(0, '#f2fdff');
    gg.addColorStop(1, '#94d6f2');
    g.fillStyle = gg; g.fill();
    g.save();
    g.clip();
    drawCrew(g, wx, wy + 8, o.face || 'normal', o.T || 0);
    g.restore();
    g.beginPath(); g.arc(wx, wy, 34, 0, 7);
    g.strokeStyle = OL; g.lineWidth = 4; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 5;
    g.beginPath(); g.arc(wx, wy, 26, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
    g.restore();
  }

  // 乗員（まるい顔の 小さな船長）
  function drawCrew(g, x, y, face, T) {
    g.fillStyle = '#ffdcbf';
    g.beginPath(); g.arc(x, y, 24, 0, 7); g.fill();
    g.strokeStyle = '#a0603a'; g.lineWidth = 2.5; g.stroke();
    // ぼうし
    g.fillStyle = '#4aa3ff';
    g.beginPath(); g.arc(x, y - 6, 25, Math.PI * 1.08, Math.PI * 1.92); g.closePath(); g.fill();
    g.fillStyle = '#ffffff';
    g.fillRect(x - 24, y - 15, 48, 6);
    g.fillStyle = '#ffd03a';
    g.beginPath(); g.arc(x, y - 23, 4, 0, 7); g.fill();
    const ink = '#3b2630';
    g.strokeStyle = ink;
    g.fillStyle = ink;
    g.lineWidth = 3;
    const ex = 9, ey = y + 2;
    if (face === 'happy') {
      g.beginPath(); g.arc(x - ex, ey + 2, 5, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      g.beginPath(); g.arc(x + ex, ey + 2, 5, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      g.fillStyle = '#d9455f';
      g.beginPath(); g.moveTo(x - 8, y + 9); g.quadraticCurveTo(x, y + 22, x + 8, y + 9); g.closePath(); g.fill();
    } else if (face === 'worry') {
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(x - ex, ey, 6, 0, 7); g.fill(); g.stroke();
      g.beginPath(); g.arc(x + ex, ey, 6, 0, 7); g.fill(); g.stroke();
      g.fillStyle = ink;
      g.beginPath(); g.arc(x - ex, ey + 1, 2.6, 0, 7); g.fill();
      g.beginPath(); g.arc(x + ex, ey + 1, 2.6, 0, 7); g.fill();
      g.beginPath(); g.ellipse(x, y + 14, 3.5, 4.5, 0, 0, 7); g.fill();
      g.fillStyle = '#7fd3ff';
      const sy = y - 4 + (T * 30) % 8;
      g.beginPath(); g.moveTo(x + 20, sy - 7); g.quadraticCurveTo(x + 26, sy + 2, x + 20, sy + 4); g.quadraticCurveTo(x + 14, sy + 2, x + 20, sy - 7); g.fill();
    } else if (face === 'dizzy') {
      for (let s = -1; s <= 1; s += 2) {
        g.beginPath();
        for (let i = 0; i <= 20; i++) {
          const a = i * 0.7 + T * 8, r = i * 0.36;
          const px = x + s * ex + Math.cos(a) * r, py = ey + Math.sin(a) * r;
          if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.lineWidth = 2.6;
        g.stroke();
      }
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x - 8, y + 14);
      g.quadraticCurveTo(x - 4, y + 10, x, y + 14);
      g.quadraticCurveTo(x + 4, y + 18, x + 8, y + 14);
      g.stroke();
    } else {
      const blink = (T % 3.4) < 0.12;
      if (blink) {
        g.beginPath(); g.moveTo(x - ex - 4, ey); g.lineTo(x - ex + 4, ey); g.moveTo(x + ex - 4, ey); g.lineTo(x + ex + 4, ey); g.stroke();
      } else {
        g.beginPath(); g.arc(x - ex, ey, 3.6, 0, 7); g.fill();
        g.beginPath(); g.arc(x + ex, ey, 3.6, 0, 7); g.fill();
        g.fillStyle = '#fff';
        g.beginPath(); g.arc(x - ex + 1.2, ey - 1.3, 1.2, 0, 7); g.fill();
        g.beginPath(); g.arc(x + ex + 1.2, ey - 1.3, 1.2, 0, 7); g.fill();
      }
      g.beginPath(); g.arc(x, y + 9, 6, 0.25, Math.PI - 0.25); g.stroke();
    }
    g.fillStyle = 'rgba(255,110,140,0.45)';
    g.beginPath(); g.ellipse(x - 15, y + 9, 5, 3.4, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(x + 15, y + 9, 5, 3.4, 0, 0, 7); g.fill();
  }

  function star(g, x, y, r) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.45 : r, a = -Math.PI / 2 + i * Math.PI / 5;
      if (i === 0) g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.stroke();
  }

  function subFace(run) {
    const s = run.w.sub;
    if (run.crashT >= 0) return 'dizzy';
    if (run.mode === 'ready') return 'normal';
    if (run.press && s.vy < 120) return 'happy';
    if (s.vy > 170) return 'worry';
    return 'normal';
  }

  // テスト用の簡易プロファイラ（ふだんは null）
  let PROF = null;
  function pmark(name) {
    if (!PROF) return;
    const t = performance.now();
    PROF[name] = (PROF[name] || 0) + t - PROF._t;
    PROF._t = t;
  }
  // 世界をまるごと描く（ゲーム・デモ・サムネ共通）
  function drawWorld(g, run, camX, vw, o) {
    const w = run.w, T = run.T;
    o = o || {};
    if (PROF) PROF._t = performance.now();
    // R4: 深海チャレンジの エリア2〜 は エリアごとに 海と かべの色が かわる（エリア6〜 カオスゾーン: 赤むらさき＋くらい海）
    const late = w.c.late, xr = camX + SUB_X;
    const L = late ? areaLook(w, xr) : null;
    if (L && L.chaosT >= 1) drawChaosBack(g, camX, T, vw, L.cb);
    else {
      drawBack(g, camX, T, vw, o.lite);
      if (L) drawSea(g, vw, L);
    }
    pmark('back');
    drawZones(g, w, camX, T, vw);
    if (w.flips.length) drawFlips(g, w, camX, T, vw);
    pmark('zones');
    drawTerrain(g, w, camX, vw, L ? L.pal : null);
    pmark('terrain');
    for (let i = 0; i < w.signs.length; i++) {
      const sg = w.signs[i];
      if (sg.x < camX - 100 || sg.x > camX + vw + 100) continue;
      drawSign(g, sg.x - camX, botAt(w, sg.x), sg.type, T);
    }
    if (late && xr > late.from - 2400) drawGates(g, w, camX, T);
    // 自己ベストの線
    if (o.bestX > 0 && o.bestX > camX - 40 && o.bestX < camX + vw + 40) {
      const bx = o.bestX - camX, tp = effTop(w, o.bestX), bt = botAt(w, o.bestX);
      g.save();
      g.setLineDash([22, 16]);
      g.lineDashOffset = -T * 40;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 12;
      g.beginPath(); g.moveTo(bx, tp + 6); g.lineTo(bx, bt - 6); g.stroke();
      g.strokeStyle = '#ffbf1f';
      g.lineWidth = 6;
      g.stroke();
      g.setLineDash([]);
      const ly = tp + 52;
      g.fillStyle = '#ffcf33';
      A.roundRect(g, bx - 110, ly - 30, 220, 60, 30);
      g.fill();
      g.strokeStyle = '#b06a00';
      g.lineWidth = 5;
      g.stroke();
      A.text(g, 'じこベスト', bx, ly + 2, { size: 34, color: '#6b3d00' });
      g.restore();
    }
    pmark('signs+best');
    // R4: くらい海（カオスゾーン）。かべ・背景は くらく、しかけ・潜水艇は その上に かく（見のがさないように）
    if (L && L.dark > 0) drawDark(g, w, camX, vw, L.dark);
    // 障害物
    const obs = w.obs, om = late ? 340 : 200;
    const drift = run.crashT >= 0 ? run.crashT : 0;
    for (let i = lowerObs(w, camX - om); i < obs.length && obs[i].x < camX + vw + om; i++) {
      const ob = obs[i];
      if (ob.kind === 'vortex') drawVortex(g, ob.x - camX, ob.y, ob, T);
      else if (ob.kind === 'drop') drawDrop(g, ob, camX, w.px, T);
      else if (ob.kind === 'fish') drawFishSchool(g, ob, camX, w.px, T, drift * ob.k * Math.max(300, w.speed || 600), vw);
      else if (ob.kind === 'rock') {
        const ry = rockY(ob, w.t);
        if (ob.amp) {                       // 動く岩: 通路がわへ どこまで来るかを 点線で見せる
          const e = ob.side === 'top' ? ob.r * ROCK_HIT : -ob.r * ROCK_HIT;
          g.save();
          g.setLineDash([14, 12]);
          g.lineWidth = 7;
          g.strokeStyle = 'rgba(60,30,60,0.28)';
          g.beginPath();
          g.moveTo(ob.x - camX, ob.y - ob.amp + e);
          g.lineTo(ob.x - camX, ob.y + ob.amp + e);
          g.stroke();
          g.lineWidth = 3.5;
          g.strokeStyle = 'rgba(255,255,255,0.75)';
          g.stroke();
          g.restore();
        }
        drawRock(g, ob.x - camX, ry, ob.r, ob.seed);
      } else drawJelly(g, ob.x - camX, jellyY(ob, w.t), T, ob.hue, ob.ph);
    }
    pmark('obs');
    // 泡（潜水艇のうしろ・衝突）
    const ps = run.parts;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const a = clamp01(1 - p.life / p.max) * (p.kind === 1 ? 1 : 0.9);
      bubble(g, p.x - camX, p.y, p.r * (1 + p.life * 0.3), a);
    }
    // 潜水艇
    const s = w.sub;
    let ang = s.ang, sq = 0;
    if (run.crashT >= 0) {
      const e = Math.exp(-run.crashT * 2.6);
      sq = 0.13 * Math.sin(run.crashT * 18) * e;
      ang += 0.16 * Math.sin(run.crashT * 11) * e;
    }
    pmark('parts');
    drawSub(g, s.x - camX, s.y, { ang: ang, sq: sq, face: subFace(run), prop: run.prop, T: T, lamp: true });
    pmark('sub');
    // R4: あべこべ海流の中は 潜水艇の上に「あべこべ」
    if (w.flips.length && run.crashT < 0 && flipAt(w, s.x)) {
      const bx = s.x - camX, by = Math.max(150, s.y - 150);
      g.save();
      g.fillStyle = 'rgba(196,58,214,0.92)';
      A.roundRect(g, bx - 128, by - 34, 256, 68, 34);
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 5;
      g.stroke();
      A.text(g, 'あべこべ！', bx, by + 2, { size: 40, color: '#ffffff' });
      g.restore();
    }
    if (run.crashT >= 0) {
      g.save();
      // ぽわん（やわらかい輪が ひろがって消える）
      if (run.hit && run.crashT < 0.7) {
        const u = run.crashT / 0.7;
        g.strokeStyle = 'rgba(255,255,255,' + (0.8 * (1 - u)) + ')';
        g.lineWidth = 10 * (1 - u) + 2;
        g.beginPath();
        g.arc(run.hit.x - camX, run.hit.y, 30 + u * 110, 0, 7);
        g.stroke();
      }
      g.fillStyle = '#ffe14d';
      g.strokeStyle = '#c98a00';
      g.lineWidth = 3.5;
      g.lineJoin = 'round';
      for (let k = 0; k < 3; k++) {
        const a = run.T * 4 + k * 2.09;
        star(g, s.x - camX + 20 + Math.cos(a) * 78, s.y - 96 + Math.sin(a) * 18, 18);
      }
      g.restore();
    }
    // R4: さかなの予告（いちばん上に かく）
    if (late && xr > late.from) drawFishWarn(g, w, camX, vw, T);
    pmark('late');
  }

  /* ---------- 画面の文字・HUD ---------- */
  function drawKey(g, cx, cy, w, h, pressed) {
    const dy = pressed ? 9 : 0;
    g.fillStyle = '#8f84a8';
    A.roundRect(g, cx - w / 2, cy - h / 2 + 11, w, h, 22);
    g.fill();
    g.fillStyle = pressed ? '#ffe58a' : '#ffffff';
    A.roundRect(g, cx - w / 2, cy - h / 2 + dy, w, h, 22);
    g.fill();
    g.strokeStyle = '#4a3d63';
    g.lineWidth = 5;
    g.stroke();
    A.text(g, 'スペース', cx, cy + dy + 2, { size: 40, color: '#4a3d63' });
  }
  function drawArrow(g, cx, cy, dir, len, col) {
    g.save();
    g.translate(cx, cy);
    if (dir > 0) g.rotate(Math.PI);
    g.beginPath();
    g.moveTo(0, -len / 2);
    g.lineTo(42, -len / 2 + 46); g.lineTo(17, -len / 2 + 46); g.lineTo(17, len / 2);
    g.lineTo(-17, len / 2); g.lineTo(-17, -len / 2 + 46); g.lineTo(-42, -len / 2 + 46);
    g.closePath();
    g.fillStyle = col;
    g.fill();
    g.strokeStyle = '#4a3d63';
    g.lineWidth = 5;
    g.lineJoin = 'round';
    g.stroke();
    g.restore();
  }
  // 操作図「おして 浮上 ／ はなして 沈む」
  function drawGuide(g, alpha, press, T, showStart, c) {
    if (alpha <= 0.01) return;
    g.save();
    g.globalAlpha = alpha;
    const px = 740, py = 196, pw = 960, ph = showStart ? 650 : 500;
    // いま えらんでいる コース（待機中だけ）
    if (showStart && c) {
      const bw = 620, bx = px + pw / 2 - bw / 2, by = py - 108;
      g.fillStyle = c.col;
      A.roundRect(g, bx, by, bw, 84, 42);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 5;
      g.stroke();
      A.text(g, c.badge + ' ' + c.label, px + pw / 2, by + 44, { size: 44, color: '#ffffff' });
    }
    g.fillStyle = 'rgba(255,255,255,0.92)';
    A.roundRect(g, px, py, pw, ph, 50);
    g.fill();
    g.strokeStyle = '#e08a00';
    g.lineWidth = 6;
    g.stroke();
    const LX = px + 240, RX = px + 720;
    // いま している ほうを ほんのり光らせる（プレイ中）
    if (!showStart) {
      g.fillStyle = press ? 'rgba(255,214,70,0.35)' : 'rgba(90,170,255,0.25)';
      A.roundRect(g, (press ? px : px + pw / 2) + 18, py + 18, pw / 2 - 36, ph - 36, 36);
      g.fill();
    }
    g.strokeStyle = 'rgba(160,140,180,0.6)';
    g.lineWidth = 4;
    g.setLineDash([14, 12]);
    g.beginPath(); g.moveTo(px + pw / 2, py + 40); g.lineTo(px + pw / 2, py + 460); g.stroke();
    g.setLineDash([]);
    const bob = (T * 0.9) % 1;
    // ひだり: おして 浮上
    drawKey(g, LX, py + 76, 290, 86, true);
    drawArrow(g, LX - 80, py + 222, -1, 120, '#ffcf33');
    drawSub(g, LX + 80, py + 250 - bob * 60, { scale: 0.42, face: 'happy', prop: T * 30, T: T, ang: -0.25 });
    A.text(g, 'おして', LX, py + 335, { size: 52, color: '#4a3d63' });
    A.text(g, 'ふじょう', LX, py + 382, { size: 28, color: '#b06a00' });
    A.text(g, '浮上', LX, py + 436, { size: 84, color: '#e07800', stroke: '#fff', strokeWidth: 10 });
    // みぎ: はなして 沈む
    drawKey(g, RX, py + 76, 290, 86, false);
    drawArrow(g, RX - 80, py + 222, 1, 120, '#7cc4ff');
    drawSub(g, RX + 80, py + 190 + bob * 60, { scale: 0.42, face: 'worry', prop: T * 12, T: T, ang: 0.25 });
    A.text(g, 'はなして', RX, py + 335, { size: 52, color: '#4a3d63' });
    A.text(g, 'しずむ', RX, py + 382, { size: 28, color: '#2a6fc0' });
    A.text(g, '沈む', RX, py + 436, { size: 84, color: '#2a7fe0', stroke: '#fff', strokeWidth: 10 });
    if (showStart) {
      const sc = 1 + Math.sin(T * 4) * 0.035;
      g.save();
      g.translate(px + pw / 2, py + 548);
      g.scale(sc, sc);
      A.text(g, 'スペースで スタート！', 0, 0, { size: 66, color: '#e07800', stroke: '#fff', strokeWidth: 12, shadow: 'rgba(160,90,0,0.25)' });
      g.restore();
      A.text(g, '（クリックでも OK）', px + pw / 2, py + 612, { size: 34, color: '#7a6a8a' });
    }
    g.restore();
  }

  // きょりの HUD（いちばん大事な数字なので 大きく）
  function drawHud(g, meters, best, T, rec, c, area) {
    const PW = 496, PH = 232;
    g.save();
    g.fillStyle = 'rgba(255,255,255,0.93)';
    A.roundRect(g, 24, 18, PW, PH, 38);
    g.fill();
    g.strokeStyle = '#e08a00';
    g.lineWidth = 6;
    g.stroke();
    // コース名のチップ
    const cw = 258, cx = 24 + PW - cw - 20;
    const ad = area >= 2 ? areaDef(area) : null;          // R4: 深海チャレンジの エリア2〜 は エリアの 番号
    g.fillStyle = ad ? ad.col : c.col;
    A.roundRect(g, cx, 32, cw, 54, 27);
    g.fill();
    A.text(g, ad ? 'エリア' + area + (ad.chaos ? ' カオス' : '') : c.label, cx + cw / 2, 60, { size: ad && ad.chaos ? 30 : 32, color: '#ffffff' });
    A.text(g, 'きょり', 58, 60, { size: 36, align: 'left', color: '#b06a00' });
    g.font = A.font(108);
    const nw = g.measureText(String(meters)).width;
    A.text(g, String(meters), 58, 140, { size: 108, align: 'left', color: '#3b2f4a' });
    A.text(g, 'm', 58 + nw + 14, 160, { size: 52, align: 'left', color: '#3b2f4a' });
    // きろくを こえているときだけ出す。ベストの数字は出さない
    // （上手な人の記録を見て 小さい子が遠慮しないように）
    if (rec) A.text(g, 'しんきろく ちゅう！', 58, 216, { size: 34, align: 'left', color: '#e2517f' });
    g.restore();
  }

  const NOTE = {
    cave: ['どうくつに はいるよ！', 'かべに ぶつからないように すすもう', 'cave'],
    up: ['あわの のぼりながれ！', 'はなしても ふわっと うくよ（おしすぎ ちゅうい）', 'up'],
    down: ['したむきの ながれ！', 'しずみやすいよ。ながめに おそう', 'down'],
    jelly: ['クラゲが ゆらゆら！', 'あいている ほうを とおろう', 'jelly'],
    rock: ['いわに ちゅうい！', 'かべから 出ている ところを よけよう', 'rock'],
    moverock: ['いわが うごく！', 'てんせんの あいだを 上下するよ', 'rock'],
    alt: ['ながれが いれかわる！', 'あわでは はなす、あおでは おす', 'alt'],
    fast: ['スピード アップ！', 'ここからが ほんばん！', 'fast'],
    best: ['じこベスト こえた！', 'このまま どこまでも いこう！', 'best'],
    // R4（深海チャレンジの エリア2〜）
    flip: ['あべこべ海流！', 'むらさきの中は おす＝しずむ、はなす＝うく', 'flip'],
    vortex: ['うずまきに ちゅうい！', 'ちかくを とおると すいこまれるよ', 'vortex'],
    fish: ['さかなの むれが くる！', '「！」が 出た 高さから にげよう', 'fish'],
    drop: ['岩が おちてくる！', 'てんせんの まるに おちるよ', 'drop'],
  };
  const BANNER_COL = { up: '#1aa5cc', down: '#2a55cf', jelly: '#d0408f', rock: '#7a4d7e', cave: '#b8653a', alt: '#1f8bb8', fast: '#e07800', best: '#e0a000', flip: '#b03ad8', vortex: '#6a2fb0', fish: '#e0303c', drop: '#8a5a3a' };
  // エリアの バナー（エリア2〜5: 新しい しかけ / 6〜: カオス）
  HARD_AREAS.forEach(function (d) {
    const sub = d.n === 6 ? 'ぜんぶ まざって めちゃくちゃ むずかしい！' : d.n === 7 ? 'もっと はやく、もっと せまく！' : d.n === 8 ? 'ここまで きたら でんせつ！' : 'あたらしい しかけ：' + d.gim;
    NOTE['area' + d.n] = ['エリア' + d.n + ' ' + d.name + (d.chaos ? '！' : ''), sub, 'area' + d.n];
    BANNER_COL['area' + d.n] = d.col;
  });
  // 説明バナーを置く高さ。通路（と障害物）に かぶらない がわに出す
  function bannerY(w, camX) {
    let U = 1e9, D = -1e9;
    for (let x = camX + 260; x <= camX + 1860; x += 160) {
      const b = bandAt(w, x);
      if (b[0] < U) U = b[0];
      if (b[1] > D) D = b[1];
    }
    if (U >= 266) return 180;        // 通路の上に じゅうぶんな すき間 → 画面の上
    if (D <= 850) return 880;        // 下に すき間 → 画面の下
    return 180;
  }
  function drawBanner(g, b, T) {
    const life = b.t, dur = b.dur;
    const a = Math.min(1, life / 0.25, (dur - life) / 0.4);
    if (a <= 0) return;
    const n = NOTE[b.kind];
    const isChaos = b.kind === 'area6' || b.kind === 'area7' || b.kind === 'area8';
    const cx = 1160 + (isChaos ? Math.sin(life * 34) * 9 * Math.max(0, 1 - life / 1.2) : 0), cy = (b.y || 180) + (1 - Math.min(1, life / 0.25)) * -30;
    g.save();
    g.globalAlpha = a;
    g.fillStyle = 'rgba(255,255,255,0.93)';
    A.roundRect(g, cx - 480, cy - 66, 960, 132, 40);
    g.fill();
    const col = BANNER_COL[n[2]];
    g.strokeStyle = col;
    g.lineWidth = isChaos ? 12 : 7;
    g.stroke();
    // アイコン
    const ix = cx - 392, iy = cy;
    if (b.kind === 'up') { drawArrow(g, ix, iy, -1, 92, '#bff1ff'); }
    else if (b.kind === 'down') { drawArrow(g, ix, iy, 1, 92, '#9fb8ff'); }
    else if (b.kind === 'alt') { drawArrow(g, ix - 26, iy, -1, 88, '#bff1ff'); drawArrow(g, ix + 26, iy, 1, 88, '#9fb8ff'); }
    else if (b.kind === 'jelly') { g.save(); g.translate(ix, iy - 10); g.scale(0.56, 0.56); drawJelly(g, 0, 0, T, 0, 0); g.restore(); }
    else if (b.kind === 'rock' || b.kind === 'moverock') {
      if (b.kind === 'moverock') {
        g.save(); g.strokeStyle = 'rgba(120,90,130,0.5)'; g.setLineDash([10, 10]); g.lineWidth = 4;
        g.beginPath(); g.moveTo(ix, iy - 46); g.lineTo(ix, iy + 46); g.stroke(); g.restore();
        drawRock(g, ix, iy + Math.sin(T * 2.2) * 20, 40, 0.3);
      } else drawRock(g, ix, iy, 42, 0.3);
    }
    else if (b.kind === 'flip') swapIcon(g, ix, iy, 1.1, T * 1.5, '#b03ad8');
    else if (b.kind === 'vortex') drawVortex(g, ix, iy, { r: 26, R: 70, spin: 1, ph: 0 }, T);
    else if (b.kind === 'fish') { drawFish1(g, ix - 10, iy, 0, T, 0); }
    else if (b.kind === 'drop') {
      drawRock(g, ix, iy - 18 + mod(T * 0.9, 1) * 22, 34, 0.3);
      g.save(); g.setLineDash([8, 8]); g.strokeStyle = '#8a5a3a'; g.lineWidth = 5;
      g.beginPath(); g.ellipse(ix, iy + 48, 40, 10, 0, 0, 7); g.stroke(); g.restore();
    }
    else if (isChaos) {
      g.beginPath(); g.moveTo(ix, iy - 50); g.lineTo(ix + 52, iy + 42); g.lineTo(ix - 52, iy + 42); g.closePath();
      g.fillStyle = '#ffd21f'; g.fill(); g.strokeStyle = '#2a0010'; g.lineWidth = 7; g.lineJoin = 'round'; g.stroke();
      A.text(g, b.kind.slice(4), ix, iy + 16, { size: 50, color: '#2a0010' });
    }
    else if (b.kind.indexOf('area') === 0) {        // エリアの 番号
      g.beginPath(); g.arc(ix, iy, 48, 0, 7);
      g.fillStyle = col; g.fill(); g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.stroke();
      A.text(g, b.kind.slice(4), ix, iy + 4, { size: 60, color: '#ffffff' });
    }
    else if (b.kind === 'cave') { g.fillStyle = '#b8765a'; g.strokeStyle = ROCK_OL; g.lineWidth = 5; g.beginPath(); g.arc(ix, iy + 36, 52, Math.PI, 0); g.lineTo(ix + 26, iy + 36); g.arc(ix, iy + 36, 26, 0, Math.PI, true); g.closePath(); g.fill(); g.stroke(); }
    else { g.fillStyle = '#ffe14d'; g.strokeStyle = '#c98a00'; g.lineWidth = 4; star(g, ix, iy, 44); }
    A.text(g, n[0], cx + 46, cy - 24, { size: 50, color: col, stroke: '#fff', strokeWidth: 8 });
    A.text(g, n[1], cx + 46, cy + 34, { size: 34, color: '#4a3d63' });
    g.restore();
  }

  /* ---------- サムネイル用（メニューのカード）: 状態を持たない かんたんな場面 ---------- */
  function thumbCeil(x) { return 330 + 34 * Math.sin(x * 0.0042) + 16 * Math.sin(x * 0.011 + 1); }
  function thumbFloor(x) { return 822 + 26 * Math.sin(x * 0.0037 + 2) + 12 * Math.sin(x * 0.013); }
  function drawThumb(g, tw, th, t) {
    const sc = th / 600, vw = tw / sc;
    const camX = t * 150, P = 1800;
    g.save();
    g.fillStyle = '#5cc7ec';
    g.fillRect(0, 0, tw, th);
    g.scale(sc, sc);
    g.translate(0, -255);
    drawBack(g, camX, t, vw, true);
    // 泡の上昇流（くりかえし）
    const k0 = Math.floor((camX - 600) / P);
    const zones = [];
    for (let k = k0; k <= k0 + 2; k++) zones.push({ type: 'up', x0: k * P + 1250, x1: k * P + 1500 });
    drawZones(g, { zones: zones }, camX, t, vw);
    // 天井と床
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(-20, 0);
    for (let x = -20; x <= vw + 20; x += 24) g.lineTo(x, thumbCeil(x + camX));
    g.lineTo(vw + 20, 0);
    g.closePath();
    g.fillStyle = '#b8765a';
    g.fill();
    g.strokeStyle = ROCK_OL;
    g.lineWidth = 9;
    g.stroke();
    g.beginPath();
    g.moveTo(-20, H);
    for (let x = -20; x <= vw + 20; x += 24) g.lineTo(x, thumbFloor(x + camX));
    g.lineTo(vw + 20, H);
    g.closePath();
    g.fillStyle = '#d39258';
    g.fill();
    g.beginPath();
    for (let x = -20; x <= vw + 20; x += 24) { if (x === -20) g.moveTo(x, thumbFloor(x + camX) + 10); else g.lineTo(x, thumbFloor(x + camX) + 10); }
    g.strokeStyle = '#f6d495';
    g.lineWidth = 16;
    g.stroke();
    g.beginPath();
    for (let x = -20; x <= vw + 20; x += 24) { if (x === -20) g.moveTo(x, thumbFloor(x + camX)); else g.lineTo(x, thumbFloor(x + camX)); }
    g.strokeStyle = ROCK_OL;
    g.lineWidth = 9;
    g.stroke();
    for (let k = k0; k <= k0 + 2; k++) {
      const sx = k * P + 300 - camX;
      if (sx > -100 && sx < vw + 100) starfish(g, sx, thumbFloor(sx + camX) + 16, 18, k);
      // 天井の岩 と クラゲ
      const rx = k * P + 650 - camX;
      if (rx > -150 && rx < vw + 150) drawRock(g, rx, thumbCeil(rx + camX) + 12, 80, 0.4);
      const jx = k * P + 1750 - camX;
      if (jx > -150 && jx < vw + 150) drawJelly(g, jx, 440 + Math.sin(t * 1.6 + k) * 22, t, k & 1, k);
    }
    // 潜水艇（ゆらゆら。岩やクラゲが来たら 下をくぐる）
    const sy = function (tt) {
      const cx = tt * 150 + 300;
      let dodge = 0;
      [650, 1750].forEach(function (o) {
        const dx = mod(cx - o + P / 2, P) - P / 2;
        dodge += 95 * Math.exp(-(dx / 300) * (dx / 300));
      });
      return 596 + Math.sin(tt * 1.4) * 38 + dodge;
    };
    const y = sy(t), vy = (sy(t + 0.05) - sy(t - 0.05)) / 0.1 / 60;
    for (let i = 0; i < 10; i++) {
      const age = mod(t * 1.5 + i / 10, 1);
      bubble(g, 300 - 132 - age * 230, sy(t - age * 0.7) + 4 - age * 90 + Math.sin(i * 7) * 8, 4 + (i % 3) * 2.5 + age * 3, 1 - age);
    }
    drawSub(g, 300, y, { scale: 1.1, ang: clamp(vy * 0.2, -0.3, 0.3), face: vy < -0.2 ? 'happy' : vy > 0.6 ? 'worry' : 'normal', prop: t * 26, T: t, lamp: true });
    g.restore();
  }

  /* =========================================================
     登録
     ========================================================= */
  A.register({
    id: 'sub',
    order: 3,
    title: 'あわあわ潜水艇',
    shortTitle: '潜水艇',
    catch: 'おして 浮上、はなして 沈む。3つの海を どこまで いけるかな？',
    tags: ['1人', 'スペースキー', '3コース'],
    modesCompact: true,   // R4：コース3つを 1行に（あそびかた画面が 画面からはみ出していた）
    theme: { main: '#ffb928', dark: '#e08a00', light: '#fff3d6' },
    bgm: 'sub',
    howto: [
      { icon: '<span class="key wide">スペース</span>', html: 'おしている間 <b><ruby>浮上<rt>ふじょう</rt></ruby></b>、はなすと <b><ruby>沈<rt>しず</rt></ruby>む</b>' },
      { icon: '<svg viewBox="0 0 64 64"><circle cx="32" cy="34" r="22" fill="#ffd43b" stroke="#5a3a18" stroke-width="4"/><circle cx="38" cy="32" r="10" fill="#bff0ff" stroke="#5a3a18" stroke-width="3"/><path d="M6 10 L20 10 M6 54 L20 54" stroke="#b8765a" stroke-width="7" stroke-linecap="round"/></svg>', html: 'かべ・岩・クラゲを よけて <b>きょり</b>を きそう！' },
      { icon: '<svg viewBox="0 0 64 64"><rect x="8" y="6" width="22" height="52" rx="10" fill="#dff8ff" stroke="#1aa5cc" stroke-width="3"/><path d="M19 44 V18 M11 26 L19 17 L27 26" stroke="#1aa5cc" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="36" y="6" width="22" height="52" rx="10" fill="#dfe6ff" stroke="#2a55cf" stroke-width="3"/><path d="M47 18 V44 M39 36 L47 45 L55 36" stroke="#2a55cf" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>', html: '<b>あわ</b>で ふわっと うく、<b>あおい ながれ</b>で しずむ' },
      { icon: '<svg viewBox="0 0 64 64"><circle cx="14" cy="18" r="10" fill="#19a0cc"/><circle cx="32" cy="34" r="10" fill="#7a4dbf"/><circle cx="50" cy="50" r="10" fill="#d0408f"/><path d="M14 30 L32 22 M32 46 L50 38" stroke="#8a7a9a" stroke-width="4" stroke-linecap="round"/></svg>', html: 'コースは <b>3つ</b>。はじめては <b>やさしい海</b>から！' },
    ],
    modes: [
      { id: 'easy', label: 'やさしい海', sub: '1-1 しょきゅう', desc: 'ひろい海から スタート。あわ・ながれ・クラゲを 1つずつ おぼえよう', recommend: true },
      { id: 'normal', label: 'ふしぎな洞窟', sub: '1-2 ちゅうきゅう', desc: 'すこし せまい どうくつ。ゆれる クラゲと ながれが いっしょに でてくる' },
      { id: 'hard', label: '深海チャレンジ', sub: '1-3 じょうきゅう', desc: '1000mごとに エリアが かわって むずかしく！ 5000mから カオスゾーン' },
    ],
    // ランキングは コースごとに 完全に分ける（実装はエンジン側）
    rank: {
      boards: [
        { id: 'sub.easy', label: 'やさしい海', short: 'やさしい', unit: 'm' },
        { id: 'sub.normal', label: 'ふしぎな洞窟', short: 'ふしぎ', unit: 'm' },
        { id: 'sub.hard', label: '深海チャレンジ', short: 'しんかい', unit: 'm' },
      ],
      boardOf: function (opts) { return COURSES[opts && opts.mode] ? 'sub.' + opts.mode : null; },
    },
    best: {
      key: 'sub.best.easy', label: 'じこベスト', unit: 'm',
      keyOf: function (opts) { return 'sub.best.' + courseOf(opts && opts.mode).id; },
    },
    // メニューカード／あそびかた画面の記録表示（3コース分）
    bestHtml: function (store) {
      const parts = COURSE_IDS.map(function (k) {
        const v = Number(store.get('sub.best.' + k, 0)) || 0;
        return COURSES[k].short + ' <b>' + (v > 0 ? v + 'm' : '−') + '</b>';
      });
      return 'きろく：' + parts.join('　／　');
    },
    drawThumb: drawThumb,

    create: function (api) {
      const sp = api.params.get('seed');
      const fixedSeed = (sp !== null && sp !== '' && isFinite(Number(sp))) ? (Number(sp) >>> 0) : null;
      let mode = 'demo';            // demo（説明画面の裏）| ready | play | crash | over
      let course = COURSES.easy;    // いま遊んでいるコース
      let run = makeDemo();
      let best = 0;
      let botOn = false;
      let T = 0, playT = 0, finalM = 0, shake = 0;
      let camFreeze = null, banner = null, popups = [], lastM = 0, passedBest = false;
      let wasPress = false, bubSfxT = 0, lastFlow = 0, finished = false;

      function bestKey() { return 'sub.best.' + course.id; }
      function loadBest() { best = Number(api.store.get(bestKey(), 0)) || 0; }
      function makeDemo() {
        const c = COURSES.easy;
        const r = newRun((Math.random() * 1e9) >>> 0, c.demoX + Math.random() * 1500, c.id);
        r.mode = 'play';
        return r;
      }
      function meters() { return Math.max(0, Math.floor(run.w.sub.x / PX_PER_M)); }

      function begin() {
        if (mode !== 'ready') return;
        mode = 'play';
        run.mode = 'play';
        run.w.mul = 0;
        playT = 0;
        api.sfx('pop');
      }

      function bubbleSfx() {
        api.audio.tone({ f: 420 + Math.random() * 260, f2: 1000 + Math.random() * 500, dur: 0.08, type: 'sine', vol: 0.06 });
      }

      function crash(h) {
        mode = 'crash';
        run.crashT = 0;
        run.hit = h;
        finalM = meters();
        camFreeze = run.w.sub.x - SUB_X;
        shake = 1;
        api.sfx('crash');
        const s = run.w.sub;
        h.flow = flowAt(run.w, s.x);
        h.flip = run.w.flips.length > 0 && flipAt(run.w, s.x);      // R4
        h.chaos = run.w.chaosX > 0 && s.x >= run.w.chaosX;
        h.area = run.w.c.late ? areaIndex(run.w, s.x, 0) : 1;
        s.vy = (h.y < s.y ? 1 : -1) * 170;
        run.bounceVx = -150;
        burst(run, h.x, h.y, 28, h.o ? 0 : (h.y > s.y ? -1 : 1));
      }

      // 結果の小さい文字。big（きょり）と 同じ数字は 出さない
      function resultSub() {
        const k = run.hit ? run.hit.kind : '';
        const cause = { surface: '海面に とびだしちゃった！', ceiling: 'てんじょうに ぶつかった！', floor: 'ゆかに ぶつかった！', seabed: '海の そこに ついちゃった！', rock: '岩に ぶつかった！', jelly: 'クラゲに ぶつかった！', vortex: 'うずに すいこまれた！', fish: 'さかなの むれに ぶつかった！', drop: 'おちてきた 岩に ぶつかった！' }[k] || 'ぶつかった！';
        const f = run.hit && run.hit.flow ? run.hit.flow : 0;
        const high = k === 'surface' || k === 'ceiling';
        let tip;
        // R4: 深海チャレンジの しかけ・カオスゾーン
        const ar = run.hit && run.hit.area ? run.hit.area : 1;
        if (run.hit && run.hit.chaos) tip = 'カオスゾーン（エリア' + ar + '）まで いけた！ すごい！';
        else if (run.hit && run.hit.flip) tip = 'ヒント：むらさきの 中は おす と はなす が ぎゃく！';
        else if (k === 'vortex') tip = 'ヒント：うずの そばは すいこまれる。はなれて とおろう';
        else if (k === 'fish') tip = 'ヒント：「！」が 出たら その高さから にげよう';
        else if (k === 'drop') tip = 'ヒント：てんせんの まるに 岩が おちてくるよ';
        else if (f < -0.2 && high) tip = 'ヒント：あわの中では スペースを はなすと ちょうどいいよ';
        else if (f > 0.2 && !high && k !== 'jelly' && k !== 'rock') tip = 'ヒント：あおい ながれでは ながめに おそう';
        else if (k === 'jelly') tip = 'ヒント：クラゲの うごきを よく見て、あいている ほうへ';
        else if (k === 'rock') tip = 'ヒント：岩は はやめに よけよう（うごく岩は てんせんの中を 見る）';
        else if (finalM < 80 && high) tip = 'ヒント：おしっぱなしに しないで、ちょん ちょん と おそう';
        else if (finalM < 80) tip = 'ヒント：しずみそうに なったら はやめに おそう';
        else if (ar >= 2) tip = 'エリア' + ar + 'まで きたよ！ つぎは エリア' + (ar + 1) + 'へ！';
        else tip = 'つぎは どこまで 行けるかな？';
        return '<b>' + cause + '</b><br>' + tip;
      }

      function doFinish() {
        if (finished) return;
        finished = true;
        mode = 'over';
        const wasBest = best;
        api.finish({
          ribbon: 'けっか',
          score: finalM,
          headline: course.badge + ' ' + course.label,   // 数字は big だけに出す
          big: finalM + 'm',
          sub: resultSub(),
          delay: 500,
        });
        // コースごとの自己ベスト（エンジンが keyOf で保存するが、念のため ここでも そろえる）
        if (finalM > wasBest) { api.store.set(bestKey(), finalM); best = finalM; }
      }

      let bannerQ = [];
      function showBanner(kind) {
        const b = { kind: kind, t: 0, dur: kind === 'best' ? 2.4 : kind === 'area6' ? 4.2 : kind.indexOf('area') === 0 ? 3.6 : 3.2 };
        if (!banner) banner = b;
        else { bannerQ.push(b); banner.dur = Math.min(banner.dur, banner.t + 0.9); }
      }

      // R4: しかけの 音と 予告（深海チャレンジの 1500m〜だけ）。o.ev に「もう 鳴らした」を 記録
      let lastFlip = false;
      function lateEvents(w, s) {
        const fl = w.flips.length > 0 && flipAt(w, s.x);
        if (fl && !lastFlip) {
          api.audio.tone({ f: 330, f2: 660, dur: 0.16, type: 'triangle', vol: 0.12 });
          api.audio.tone({ f: 660, f2: 330, dur: 0.18, type: 'triangle', vol: 0.12, delay: 0.15 });
        }
        lastFlip = fl;
        const obs = w.obs, sp = Math.max(300, w.speed);
        for (let i = lowerObs(w, s.x - 400); i < obs.length && obs[i].x < s.x + 4500; i++) {
          const o = obs[i];
          if (o.kind === 'vortex') {
            if (!o.ev && o.x - s.x < o.R + 260) { o.ev = 1; api.audio.noise({ dur: 0.9, vol: 0.1, f: 260, f2: 900, q: 3 }); }
          } else if (o.kind === 'fish') {
            const lead = fishPos(o, s.x, 0)[0] - (s.x - SUB_X);
            if (!o.ev && lead - W < 1.8 * (1 + o.k) * sp) {
              o.ev = 1;
              api.audio.tone({ f: 1175, dur: 0.09, type: 'square', vol: 0.06 });
              api.audio.tone({ f: 1175, dur: 0.09, type: 'square', vol: 0.06, delay: 0.16 });
            }
          } else if (o.kind === 'drop') {
            if (!o.ev && s.x > o.xs - 1100) { o.ev = 1; api.audio.noise({ dur: 0.8, vol: 0.14, f: 220, f2: 90, q: 0.8, filter: 'lowpass' }); }
            if (o.ev === 1 && s.x >= o.xe) { o.ev = 2; api.sfx('bonk'); shake = Math.max(shake, 0.35); burst(run, o.x, o.y - o.r * 0.8, 12, -1); }
          }
        }
      }

      function update(dt) {
        T += dt;
        if (shake > 0) shake = Math.max(0, shake - dt * 4);
        if (banner) {
          banner.t += dt;
          // バナーの高さ: 通路に かぶらない がわへ なめらかに よける
          const ty = bannerY(run.w, (camFreeze !== null ? camFreeze : run.w.sub.x - SUB_X));
          banner.y = banner.y === undefined ? ty : banner.y + (ty - banner.y) * Math.min(1, dt * 2.5);
          if (banner.t > banner.dur) banner = bannerQ.length ? bannerQ.shift() : null;
        }
        for (let i = popups.length - 1; i >= 0; i--) { popups[i].t += dt; if (popups[i].t > 1.4) popups.splice(i, 1); }

        if (mode === 'demo') {
          const w = run.w;
          if (run.crashT < 0) {
            ensure(w, w.sub.x + 2600);
            run.press = botPress(w);
            stepSub(w, run.press, dt);
            if (hitTest(w)) run.crashT = 0;
          } else if (run.crashT > 1.2) { run = makeDemo(); }
          fxStep(run, dt, run.crashT < 0);
          return;
        }
        const w = run.w, s = w.sub;
        ensure(w, s.x + 2600);
        if (mode === 'ready') {
          s.y = 540 + Math.sin(T * 2.2) * 14;
          s.vy = Math.cos(T * 2.2) * 30;
          s.ang = Math.sin(T * 2.2 + 0.6) * 0.05;
          run.press = false;
          fxStep(run, dt, false);
          if (api.input.isDown('Space') || api.input.pointer.down) begin();
          return;
        }
        if (mode === 'play') {
          const press = botOn ? botPress(w) : (api.input.isDown('Space') || api.input.pointer.down);
          run.press = press;
          playT += dt;
          w.mul = Math.min(1, w.mul + dt / 0.5);
          stepSub(w, press, dt);
          // 効果音: 浮上中に ときどき 泡の音（うるさくしない）
          bubSfxT -= dt;
          if (press && (!wasPress || bubSfxT <= 0) && bubSfxT < 0.32) { bubbleSfx(); bubSfxT = 0.5; }
          wasPress = press;
          // 流れに入った
          const f = flowAt(w, s.x);
          const fz = f < -0.05 ? -1 : f > 0.05 ? 1 : 0;
          if (fz !== lastFlow && fz !== 0) {
            if (fz < 0) api.sfx('whoosh');
            else api.audio.noise({ dur: 0.35, vol: 0.12, f: 1600, f2: 300, q: 1.0 });
          }
          lastFlow = fz;
          // 説明のお知らせ
          for (let i = 0; i < w.notes.length; i++) {
            const n = w.notes[i];
            if (!n.done && s.x >= n.x) {
              n.done = true;
              showBanner(n.kind);
              if (n.kind === 'area6' || n.kind === 'area7' || n.kind === 'area8') for (let k = 0; k < 3; k++) api.audio.tone({ f: 880, f2: 620, dur: 0.22, type: 'square', vol: 0.07, delay: k * 0.3 });
              else if (n.kind.indexOf('area') === 0) [659, 784, 988, 1319].forEach(function (fq, k) { api.audio.tone({ f: fq, dur: 0.16, type: 'triangle', vol: 0.1, delay: k * 0.09 }); });
            }
          }
          // 100m ごと / 自己ベスト
          const m = meters();
          if (Math.floor(m / 100) > Math.floor(lastM / 100)) {
            popups.push({ text: Math.floor(m / 100) * 100 + 'm！', t: 0 });
            api.audio.tone({ f: 988, dur: 0.1, type: 'triangle', vol: 0.1 });
            api.audio.tone({ f: 1319, dur: 0.22, type: 'triangle', vol: 0.1, delay: 0.08 });
          }
          if (best > 0 && !passedBest && m > best) { passedBest = true; showBanner('best'); api.sfx('sparkle'); }
          lastM = m;
          if (w.c.late && s.x > w.c.late.from - 2000) lateEvents(w, s);
          const h = hitTest(w);
          if (h) crash(h);
          fxStep(run, dt, true);
          return;
        }
        // crash / over: ぽわんと はね返って ゆらゆら
        w.t += dt;
        s.x += run.bounceVx * dt;
        run.bounceVx *= Math.pow(0.02, dt);
        s.vy = s.vy * Math.pow(0.05, dt) - 14 * dt;
        s.y += s.vy * dt;
        s.ang *= Math.pow(0.2, dt);
        run.press = false;
        fxStep(run, dt, false);
        if (mode === 'crash' && run.crashT >= 1.0) doFinish();
      }

      function draw(g) {
        const w = run.w, s = w.sub;
        g.fillStyle = '#5cc7ec';
        g.fillRect(0, 0, W, H);
        const camX = camFreeze !== null ? camFreeze : s.x - SUB_X;
        g.save();
        if (shake > 0) g.translate(Math.sin(T * 61) * 7 * shake, Math.cos(T * 47) * 5 * shake);
        drawWorld(g, run, camX, W, { bestX: mode === 'demo' ? 0 : best * PX_PER_M });
        g.restore();
        if (mode === 'demo') return;
        const m = mode === 'play' || mode === 'ready' ? meters() : finalM;
        drawHud(g, m, best, T, best > 0 && m > best, course, w.c.late ? areaIndex(w, (camFreeze !== null ? camFreeze : s.x - SUB_X) + SUB_X, 0) : 1);
        for (let i = 0; i < popups.length; i++) {
          const p = popups[i];
          const a = Math.min(1, (1.4 - p.t) / 0.4);
          g.save();
          g.globalAlpha = clamp01(a);
          A.text(g, p.text, 240, 300 - p.t * 30, { size: 62, color: '#ffcf33', stroke: '#7a4a00', strokeWidth: 10 });
          g.restore();
        }
        if (mode === 'ready') drawGuide(g, 1, false, T, true, course);
        else if (mode === 'play' && playT < 5.5) drawGuide(g, playT < 4 ? 0.55 : 0.55 * (5.5 - playT) / 1.5, run.press, T, false);
        if (banner) drawBanner(g, banner, T);
      }

      return {
        start: function (opts) {
          course = courseOf(opts && opts.mode);
          const seed = fixedSeed !== null ? fixedSeed : ((Math.random() * 1e9) >>> 0);
          run = newRun(seed, 0, course.id);
          run.mode = 'ready';
          mode = 'ready';
          T = 0; playT = 0; finalM = 0; shake = 0; camFreeze = null; banner = null; bannerQ = []; popups = [];
          lastM = 0; passedBest = false; wasPress = false; bubSfxT = 0; lastFlow = 0; finished = false; lastFlip = false;
          loadBest();
          api.setCursor('default');
        },
        update: update,
        draw: draw,
        onKeyDown: function (code) { if (code === 'Space') begin(); },
        onPointerDown: function () { begin(); },
        destroy: function () {},
        // ---- テスト用 ----
        _test: {
          info: function () {
            const w = run.w, s = w.sub;
            return { mode: mode, course: course.id, x: s.x, y: s.y, vy: s.vy, speed: w.speed, meters: mode === 'play' || mode === 'ready' ? meters() : finalM, playT: playT, t: w.t, press: run.press, seed: w.seed, best: best, bestKey: bestKey(), hit: run.hit && run.hit.kind, flow: flowAt(w, s.x), finished: finished, banner: banner && banner.kind, chaosX: w.chaosX, inFlip: w.flips.length > 0 && flipAt(w, s.x), area: w.c.late ? areaIndex(w, s.x, 0) : 1 };
          },
          // R4: いまの走りの 位置を x(px) へ とばす（スクリーンショット・確認用。とばした所より前の お知らせは 出さない）
          warp: function (x) {
            const w = run.w;
            jumpTo(w, x);
            w.sub.vy = 0;
            lastM = meters();
            passedBest = true;
            banner = null; bannerQ = [];
            w.notes.forEach(function (n) { if (n.x < x - 200) n.done = true; });
            return { x: w.sub.x, y: w.sub.y, chaosX: w.chaosX };
          },
          // R4: 深海チャレンジの 区切り（px）
          late: function () {
            return { from: COURSES.hard.late.from, areas: HARD_AREAS.map(function (d) { return { n: d.n, x: d.x, name: d.name, gim: d.gim || '', chaos: !!d.chaos }; }),
              stages: COURSES.hard.stages.map(function (s) { return { until: s.until, need: s.need }; }) };
          },
          // R4: 通れる帯を step px ごとに まとめて返す（静的な 通れるかチェック用）
          //   [lo, hi, スクロール速度, 流れの強さ(-1〜1), あべこべ(0/1)] の くりかえし。うず・落ちる岩・さかなも 帯に入っている
          corridor: function (seed, xmax, courseId, step, x0) {
            const w = makeWorld(seed, courseId);
            ensure(w, xmax + 400);
            step = step || 16;
            const out = [];
            for (let x = x0 || 0; x <= xmax; x += step) {
              const b = spanBand(w, x);
              out.push(Math.round(b[0]), Math.round(b[1]), Math.round(speedAt(w, x)), +flowAt(w, x).toFixed(3), w.flips.length && flipAt(w, x) ? 1 : 0);
            }
            const cnt = {};
            w.obs.forEach(function (o) { if (o.x <= xmax) cnt[o.kind] = (cnt[o.kind] || 0) + 1; });
            cnt.flip = w.flips.filter(function (z) { return z.x0 <= xmax; }).length;
            const first = {};
            w.obs.forEach(function (o) { if (first[o.kind] === undefined) first[o.kind] = Math.round(o.x); });
            if (w.flips.length) first.flip = Math.round(w.flips[0].x0);
            return { data: out, step: step, x0: x0 || 0, chaosX: w.chaosX, counts: cnt, first: first, gates: w.areas.map(function (a) { return [a.n, Math.round(a.x)]; }) };
          },
          bot: function (on) { botOn = !!on; },
          begin: begin,
          sim: simulate,
          scan: scan,
          courses: COURSE_IDS,
          consts: { PHYS: PHYS, PX_PER_M: PX_PER_M, SURF_Y: SURF_Y, SUB_HW: SUB_HW, STEP: STEP },
          // コースの難易度カーブ（テストの比較表用）
          curves: function (id, x) {
            const w = { c: courseOf(id) };
            return { speed: speedAt(w, x), gap: gapAt(w, x), slope: slopeAt(w, x), clear: clearAt(w, x), jAmp: jellyAmp(w, x), jPer: jellyPer(w, x), rAmp: rockAmp(w, x) };
          },
          // 地形のある場所を 調べる（せまい所の原因さがし用）
          probe: function (seed, x, courseId, span) {
            const w = makeWorld(seed, courseId);
            ensure(w, x + (span || 1200) + 2600);
            const out = { x: x, band: spanBand(w, x).map(Math.round), top: Math.round(effTop(w, x)), bot: Math.round(botAt(w, x)), flow: +flowAt(w, x).toFixed(2), obs: [], zones: [] };
            w.obs.forEach(function (o) {
              if (Math.abs(o.x - x) > (span || 1200)) return;
              out.obs.push({ kind: o.kind, x: Math.round(o.x), y: Math.round(o.y), side: o.side, r: o.r && Math.round(o.r), amp: Math.round(o.amp || 0) });
            });
            w.zones.forEach(function (z) { if (z.x1 > x - (span || 1200) && z.x0 < x + (span || 1200)) out.zones.push({ type: z.type, x0: Math.round(z.x0), x1: Math.round(z.x1) }); });
            return out;
          },
          worst: function (seed, xmax, courseId) {
            const w = makeWorld(seed, courseId);
            ensure(w, xmax + 400);
            let bw = 1e9, bx = 0;
            for (let x = 0; x <= xmax; x += 8) { const b = spanBand(w, x); if (b[1] - b[0] < bw) { bw = b[1] - b[0]; bx = x; } }
            return { band: Math.round(bw), x: bx };
          },
          course: function (id) { const c = courseOf(id); return { id: c.id, label: c.label, openEnd: c.openEnd, caveLen: c.caveLen, progEnd: c.progEnd, stages: c.stages.map(function (s) { return { until: s.until, need: s.need, types: Object.keys(s.w) }; }) }; },
          prof: function (on) { const r = PROF; PROF = on ? {} : null; return r; },
        },
      };
    },
  });

  /* =========================================================
     テスト用（ヘッドレスで走らせる / 生成を調べる）
     ========================================================= */
  // 「人っぽい」ボット: 反応が delay 秒おくれ、ねらう高さが noise px ぶれる（難しさの目安用）
  function humanBot(w, delay, noise, seed) {
    const r = A.rng(seed * 7 + 1);
    const q = [];
    const n = Math.max(1, Math.round(delay / STEP));
    let off = 0, offT = 0;
    return function () {
      offT -= STEP;
      if (offT <= 0) { off = (r() * 2 - 1) * noise; offT = 0.4 + r() * 0.5; }
      const d = decide(w, off);
      q.push(w.flips.length && flipAt(w, w.sub.x) ? !d : d);   // R4: あべこべ海流では キーを ぎゃくに（おくれて とどく）
      return q.length > n ? q.shift() : false;
    };
  }

  // R4（テスト用）: あべこべ海流に 入ったとき・出たとき、flipLag 秒は 前の おしかたの まま（人が まちがえる ぶん）
  function confuse(w, inner, flipLag) {
    let was = false, since = 1e9;
    return function () {
      const fl = w.flips.length > 0 && flipAt(w, w.sub.x);
      if (fl !== was) { was = fl; since = 0; } else since += STEP;
      const p = inner();
      return since < flipLag ? !p : p;
    };
  }
  // R4（テスト用）: 先読みボット。0.9秒先まで「おす/はなす を いつ 切りかえるか」を 16通り ためして、
  // いちばん長く ぶつからない手を えらぶ（自動操縦が 止まった所が ほんとうに 通れるかの 確かめ用）
  function planBot(w) {
    const SW = [0.05, 0.1, 0.16, 0.24, 0.33, 0.44, 0.58, 9];
    const N = Math.round(0.9 / STEP);
    let cur = false, k = 0;
    return function () {
      if (k++ % 2) return cur;
      const s = w.sub, snap = [s.x, s.y, s.vy, s.ang, w.t, w.px, w.speed];
      let best = -1, bestAct = false;
      for (let c = 0; c < SW.length * 2; c++) {
        const first = c < SW.length, sw = SW[c % SW.length];
        let n = 0;
        for (; n < N; n++) {
          stepSub(w, n * STEP < sw ? first : !first, STEP);
          if (hitTest(w)) break;
        }
        const b = spanBand(w, s.x);
        const err = Math.abs(s.y - (b[0] + b[1]) / 2);
        const score = n * 1000 - Math.min(999, err);
        if (score > best) { best = score; bestAct = first; }
        s.x = snap[0]; s.y = snap[1]; s.vy = snap[2]; s.ang = snap[3]; w.t = snap[4]; w.px = snap[5]; w.speed = snap[6];
      }
      cur = bestAct;
      return cur;
    };
  }

  // policy: 'bot' | 'plan' | 'hold' | 'release' | 'tap' | 'human:<遅れ秒>:<ぶれpx>[:<あべこべで まちがえる秒>]'
  function simulate(seed, secs, policy, startX, courseId) {
    const w = makeWorld(seed, courseId);
    if (startX) jumpTo(w, startX); else ensure(w, 2600);
    const steps = Math.round(secs / STEP);
    let hb = null;
    if (policy.indexOf('human') === 0) {
      const a = policy.split(':');
      hb = humanBot(w, Number(a[1]), Number(a[2]), seed);
      if (a[3]) hb = confuse(w, hb, Number(a[3]));
    } else if (policy === 'plan') hb = planBot(w);
    let maxV = 0, maxUp = 0, maxDown = 0;
    const flowTime = { up: 0, down: 0 };
    for (let k = 0; k < steps; k++) {
      ensure(w, w.sub.x + 2600);
      let press;
      if (hb) press = hb();
      else if (policy === 'bot') press = botPress(w);
      else if (policy === 'hold') press = true;
      else if (policy === 'release') press = false;
      else press = (k % 60) < 30;
      stepSub(w, press, STEP);
      const vy = w.sub.vy;
      if (Math.abs(vy) > maxV) maxV = Math.abs(vy);
      if (-vy > maxUp) maxUp = -vy;
      if (vy > maxDown) maxDown = vy;
      const f = flowAt(w, w.sub.x);
      if (f < -0.5) flowTime.up += STEP; else if (f > 0.5) flowTime.down += STEP;
      const h = hitTest(w);
      if (h) {
        const r = { alive: false, t: +w.t.toFixed(2), m: Math.floor(w.sub.x / PX_PER_M), x: Math.round(w.sub.x), y: Math.round(w.sub.y), kind: h.kind, maxV: Math.round(maxV), maxUp: Math.round(maxUp), maxDown: Math.round(maxDown), flow: +f.toFixed(2), flowTime: flowTime };
        if (w.flips.length && flipAt(w, w.sub.x)) r.inFlip = true;      // R4: あべこべ海流の中で ぶつかった
        return r;
      }
    }
    return { alive: true, t: +w.t.toFixed(2), m: Math.floor(w.sub.x / PX_PER_M), x: Math.round(w.sub.x), maxV: Math.round(maxV), maxUp: Math.round(maxUp), maxDown: Math.round(maxDown), flowTime: flowTime };
  }

  // 生成された地形の静的チェック
  function scan(seed, xmax, courseId) {
    const w = makeWorld(seed, courseId);
    ensure(w, xmax + 400);
    let minW = 1e9, minWX = 0, maxSlope = 0, maxSlopeX = 0, minOpen = 1e9, prevC = null;
    for (let x = 0; x <= xmax; x += 16) {
      const b = spanBand(w, x);
      const wd = b[1] - b[0];
      if (wd < minW) { minW = wd; minWX = x; }
      if (x < w.c.openEnd && wd < minOpen) minOpen = wd;
      const c = (b[0] + b[1]) / 2;
      if (prevC !== null) { const sl = Math.abs(c - prevC) / 16; if (sl > maxSlope) { maxSlope = sl; maxSlopeX = x; } }
      prevC = c;
    }
    // 通路の中心線の傾き → 必要な上下速度（物理の上限 400/360 と比べる）
    let tSlope = 0, tSlopeX = 0, tPrev = null, tNeed = 0, tNeedX = 0;
    for (let x = 0; x <= xmax; x += 16) {
      const c = (effTop(w, x) + botAt(w, x)) / 2;
      if (tPrev !== null) {
        const sl = Math.abs(c - tPrev) / 16;
        if (sl > tSlope) { tSlope = sl; tSlopeX = x; }
        const need = sl * speedAt(w, x);
        if (need > tNeed) { tNeed = need; tNeedX = x; }
      }
      tPrev = c;
    }
    let caveX = null;
    for (let x = 0; x <= xmax; x += 16) if (topAt(w, x) > SURF_Y + 4) { caveX = x; break; }
    const counts = {};
    w.obs.forEach(function (o) {
      if (o.x > xmax) return;
      const k = o.kind === 'rock' && o.amp > 8 ? 'moverock' : o.kind;
      counts[k] = (counts[k] || 0) + 1;
    });
    w.zones.forEach(function (z) { if (z.x0 <= xmax) counts['zone_' + z.type] = (counts['zone_' + z.type] || 0) + 1; });
    const firstObs = w.obs.length ? w.obs[0].x : null;
    const firstZone = w.zones.length ? w.zones[0].x0 : null;
    const firstOf = function (kind) { for (let i = 0; i < w.obs.length; i++) if (w.obs[i].kind === kind) return Math.round(w.obs[i].x); return null; };
    const firstZ = function (type) { for (let i = 0; i < w.zones.length; i++) if (w.zones[i].type === type) return Math.round(w.zones[i].x0); return null; };
    // 流れゾーンの中の通路の傾き（上昇流は下り坂にしない / 海流は上り坂にしない）
    let badUp = 0, badDown = 0;
    w.zones.forEach(function (z) {
      if (z.x0 > xmax) return;
      const c0 = (effTop(w, z.x0) + botAt(w, z.x0)) / 2, c1 = (effTop(w, z.x1) + botAt(w, z.x1)) / 2;
      if (z.type === 'up' && c1 > c0 + 1) badUp++;
      if (z.type === 'down' && c1 < c0 - 1) badDown++;
    });
    // 動く岩の最初
    let firstMove = null;
    for (let i = 0; i < w.obs.length; i++) if (w.obs[i].kind === 'rock' && w.obs[i].amp > 8) { firstMove = Math.round(w.obs[i].x); break; }
    return {
      course: w.c.id,
      terrainSlope: +tSlope.toFixed(3), terrainSlopeX: tSlopeX, needVy: Math.round(tNeed), needVyX: tNeedX,
      minBand: Math.round(minW), minBandX: minWX, minOpenBand: Math.round(minOpen), maxCenterSlope: +maxSlope.toFixed(3), maxSlopeX: maxSlopeX,
      caveX: caveX, firstObs: firstObs && Math.round(firstObs), firstZone: firstZone && Math.round(firstZone),
      firstUp: firstZ('up'), firstDown: firstZ('down'), firstJelly: firstOf('jelly'), firstRock: firstOf('rock'), firstMoveRock: firstMove,
      counts: counts, badUp: badUp, badDown: badDown,
    };
  }
})();
