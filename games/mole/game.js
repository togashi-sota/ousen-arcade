/* =========================================================
   ② もぐらたたきチャレンジ
   30秒間、穴から出てくるモグラをクリックして得点をきそう。
   ふつうのモグラ +10 / きんいろモグラ +30 / ばくだん -20（0点未満にはならない）
   操作はマウス移動と左クリックだけ。
   ========================================================= */
(function () {
  'use strict';

  const A = window.Arcade;
  const W = 1920, H = 1080;
  const TAU = Math.PI * 2;
  const STEP = 1 / 120;

  /* ---------------- 調整パラメータ ---------------- */
  const GAME_TIME = 30;            // プレイ時間（秒）
  const COUNT_STEP = 1.0;          // 3・2・1 のひとつぶん（秒）。仕様「開始前3秒カウント」
  const COUNT_TIME = COUNT_STEP * 3;
  const RISE = 0.15;               // せり上がる時間
  const SINK = 0.2;                // 引っ込む時間
  const HIT_HOLD = 0.45;           // 叩かれて目を回している時間
  const HIT_SINK = 0.16;           // 叩かれたあと沈む時間
  const BOOM_HOLD = 0.55;          // ばくだんのけむり中（その穴には出さない）
  const COOL_MIN = 0.35;           // 引っ込んだあとのクールダウン（同じ穴で重ならないように）
  const COOL_RAND = 0.25;
  const STAY_MIN = 0.85;           // 出ている時間の下限（理不尽な瞬間消滅をふせぐ）
  const NO_SPAWN_LAST = 0.9;       // 終了まぎわは新しく出さない（叩けないまま終わるのを防ぐ）
  const BOMB_MIN_POS = 0.6;        // ばくだんは 6割以上 出ていないと当たらない（ほぼ見えない爆弾で減点しない）
  const BOMB_SAFE = 3.0;           // 最初の3秒はばくだんを出さない
  const PTS = { mole: 10, gold: 30, bomb: -20 };

  /* ---------------- 安全上限（これ以上は ぜったいに むずかしくしない） ----------------
     穴は9個しかないので、同時に出る数・出現間隔・1回に出す数に必ず上限／下限を置く。
     ここを超えるとフレーム落ちや「どうやっても避けられないばくだん」が起きうる。           */
  const MAX_ACTIVE_CAP = 6;        // 同時に出ている数の絶対上限（9穴中6。残り3穴は必ず空く）
  const INTERVAL_MIN = 0.24;       // 出現間隔の下限（秒）
  const SPAWN_PER_TICK = 2;        // 1回の出現判定で出す数の上限
  const BOMB_MAX_ACTIVE = 2;       // 同時に出せるばくだんの上限
  const GOLD_MAX_ACTIVE = 1;       // 同時に出せる金モグラの上限
  // ハンマーは振り上げてからでないと当たらない（＝1秒に約11回まで）。
  // 人がねらって叩ける速さ（速い人でも毎秒3〜4回）よりずっと速いので ふつうのプレイには影響しない。
  // むやみな連打で得点がのびないようにするための上限。
  const HAMMER_COOL = 0.09;

  /* ---------------- 金モグラ：確率ではなく「一定間隔＋少しのゆらぎ」 ----------------
     確率で出すと「金モグラがたくさん出た人が勝ち」になり、運で順位が変わってしまう。
     出る時刻をあらかじめ決めて少しだけゆらすことで、1プレイあたりの出現数をほぼ一定にする。 */
  const GOLD_FIRST = 4.0;          // 1匹目の予定時刻（秒）
  const GOLD_EVERY = 5.8;          // つぎの予定までの間隔（秒）
  const GOLD_JITTER = 0.8;         // 予定時刻のゆらぎ（±秒）

  /* ---------------- プレイヤーの実力推定（腕前にゲームが追いつく） ----------------
     材料：直近の成功率・反応の速さ・連続ヒット数・空振り率。
     「命中していないクリック」は実力に加算せず、空振り率として実力をさげる
     ＝ 画面のどこでも連打しているだけの人は、むずかしくならない。                        */
  const SK = {
    HIT_ALPHA: 0.22,     // 成功率EWMA（モグラが1匹 決着するごとに更新）
    RT_ALPHA: 0.25,      // 反応の速さEWMA（叩けたときだけ更新）
    WHIFF_ALPHA: 0.18,   // 空振り率EWMA（クリックするたびに更新。連打すると一気に上がる）
    RT_FAST: 0.30,       // 出現から 0.30秒で叩けたら「とても速い」
    RT_SLOW: 0.95,       // 0.95秒かかったら「おそい」
    COMBO_FULL: 8,       // 8連続で コンボ点が満点
    W_HIT: 0.45, W_RT: 0.30, W_COMBO: 0.25,   // 実力の内わけ（合計 1.0）
    WHIFF_PENALTY: 0.90, // 空振り率ぶん 実力を割り引く（1.0 ＝ 全部空振りなら実力0）
    TAU_UP: 3.0,         // 上げるときはゆっくり（時定数・秒）
    TAU_DOWN: 1.2,       // 下げるときは早め（時定数・秒）
    W_TIME: 0.30,        // 難易度にしめる「経過時間」のぶん
    W_SKILL: 0.80,       // 難易度にしめる「実力」のぶん
  };

  // 難易度。L = 0（やさしい）〜 1（いちばんいそがしい）
  // L は「経過時間」＋「実力推定」から作る（difficultyFor は L を見た目の値に変えるだけ）
  function difficultyFor(L) {
    L = clamp(L, 0, 1);
    return {
      interval: Math.max(INTERVAL_MIN, lerp(0.92, 0.26, L)),  // 出現間隔（秒）
      stay: Math.max(STAY_MIN, lerp(2.30, 0.95, L)),          // 顔を出している時間（秒）
      maxActive: Math.min(MAX_ACTIVE_CAP, 2 + Math.floor(L * 4 + 1e-9)), // 同時に出ている数 2〜6
      bomb: lerp(0.06, 0.24, L),                              // ばくだんの割合（最初の3秒は0）
      bombMax: L < 0.5 ? 1 : BOMB_MAX_ACTIVE,                 // 同時に出せるばくだんの数
      dbl: L < 0.5 ? 0 : (L - 0.5) * 0.9,                     // 2匹いっぺんに出る確率（0〜0.45）
    };
  }

  /* ---------------- 穴の配置（奥ほど小さく） ---------------- */
  const ROWS = [
    { y: 470, s: 0.84, dx: 372 },
    { y: 690, s: 0.92, dx: 406 },
    { y: 918, s: 1.0, dx: 440 },
  ];
  const LAYOUT = [];
  ROWS.forEach(function (r, ri) {
    for (let c = 0; c < 3; c++) LAYOUT.push({ x: 960 + (c - 1) * r.dx, y: r.y, s: r.s, row: ri, col: c });
  });

  /* ---------------- 小さな道具 ---------------- */
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeOut(t) { return 1 - (1 - t) * (1 - t); }
  function easeOutBack(t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  function ell(g, x, y, rx, ry, rot) { g.beginPath(); g.ellipse(x, y, rx, ry, rot || 0, 0, TAU); }
  function starPath(g, x, y, R, r, n, rot) {
    g.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = (rot || 0) + i * Math.PI / n - Math.PI / 2;
      const rr = i % 2 ? r : R;
      if (i === 0) g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
  }
  function txt(g, s, x, y, o) { A.text(g, s, x, y, o); }

  /* =========================================================
     絵：モグラ
     原点 = からだの中心。からだは 幅176 × 高さ216 くらい
     ========================================================= */
  // 上は卵形、下はまっすぐ穴の中へ（穴のふちで切れて見える）
  function bodyPath(g, w, h) {
    g.beginPath();
    g.moveTo(0, -h);
    g.bezierCurveTo(w * 0.62, -h, w, -h * 0.55, w, h * 0.05);
    g.lineTo(w * 1.03, h + 130);
    g.lineTo(-w * 1.03, h + 130);
    g.lineTo(-w, h * 0.05);
    g.bezierCurveTo(-w, -h * 0.55, -w * 0.62, -h, 0, -h);
    g.closePath();
  }

  function spiral(g, cx, cy, r, rot) {
    g.beginPath();
    const n = 30, turns = 2.3;
    for (let i = 0; i <= n; i++) {
      const k = i / n, a = rot + k * turns * TAU, rr = 1 + k * r;
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }

  function drawCrown(g, t) {
    g.save();
    g.translate(4, -98);
    g.rotate(0.1);
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(-42, 8); g.lineTo(-50, -34); g.lineTo(-22, -12); g.lineTo(0, -46);
    g.lineTo(22, -12); g.lineTo(50, -34); g.lineTo(42, 8); g.closePath();
    const cg = g.createLinearGradient(0, -46, 0, 8);
    cg.addColorStop(0, '#fffbd8'); cg.addColorStop(0.5, '#ffe45c'); cg.addColorStop(1, '#ffb514');
    g.fillStyle = cg; g.fill();
    g.lineWidth = 5; g.strokeStyle = '#9a5a00'; g.stroke();
    g.fillStyle = 'rgba(160,90,0,0.25)';
    g.fillRect(-41, -6, 82, 10);
    // 宝石
    g.lineWidth = 3;
    [[-50, -34, '#ff5a6e'], [0, -46, '#59b8ff'], [50, -34, '#ff5a6e']].forEach(function (b) {
      g.beginPath(); g.arc(b[0], b[1], 7, 0, TAU); g.fillStyle = b[2]; g.fill(); g.stroke();
    });
    g.beginPath(); g.arc(0, -1, 7, 0, TAU); g.fillStyle = '#ff5a6e'; g.fill(); g.stroke();
    g.beginPath(); g.arc(-24, -1, 4.5, 0, TAU); g.fillStyle = '#7ed957'; g.fill(); g.stroke();
    g.beginPath(); g.arc(24, -1, 4.5, 0, TAU); g.fillStyle = '#7ed957'; g.fill(); g.stroke();
    // きらり
    const k = 0.6 + 0.4 * Math.sin(t * 5);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    starPath(g, -16, -20, 9 * k, 2.5 * k, 4, 0); g.fill();
    g.restore();
  }

  // kind: 'mole' | 'gold'   face: 'normal' | 'dizzy' | 'happy'
  function drawMole(g, kind, face, t, look, blink) {
    const gold = kind === 'gold';
    const OUT = gold ? '#9a5a00' : '#4a2c1e';
    g.lineJoin = 'round';
    g.lineCap = 'round';
    // からだ（下は穴の中へ続く）
    bodyPath(g, 88, 108);
    const gr = g.createLinearGradient(-70, -110, 60, 90);
    if (gold) { gr.addColorStop(0, '#fff7b8'); gr.addColorStop(0.38, '#ffd33a'); gr.addColorStop(1, '#f39418'); }
    else { gr.addColorStop(0, '#bd8865'); gr.addColorStop(0.45, '#93644a'); gr.addColorStop(1, '#6a422e'); }
    g.fillStyle = gr; g.fill();
    g.lineWidth = 6; g.strokeStyle = OUT; g.stroke();
    // あたまのツヤ
    g.fillStyle = gold ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.22)';
    ell(g, -38, -72, 24, 12, -0.7); g.fill();
    // あたまの毛
    if (!gold) {
      g.strokeStyle = OUT; g.lineWidth = 5;
      g.beginPath();
      g.moveTo(-8, -106); g.quadraticCurveTo(-14, -124, -26, -128);
      g.moveTo(0, -107); g.quadraticCurveTo(3, -128, -3, -138);
      g.moveTo(8, -106); g.quadraticCurveTo(17, -122, 28, -124);
      g.stroke();
    }
    // おなか
    g.fillStyle = gold ? '#fff2b8' : '#e8c7a2';
    ell(g, 0, 68, 58, 46); g.fill();
    // ほっぺ
    g.fillStyle = 'rgba(255,110,150,0.5)';
    ell(g, -60, -14, 16, 10); g.fill();
    ell(g, 60, -14, 16, 10); g.fill();
    // 口のまわり
    g.fillStyle = gold ? '#fff6d8' : '#f3dcc0';
    ell(g, 0, -8, 46, 32); g.fill();
    // ひげ
    g.strokeStyle = gold ? 'rgba(154,90,0,0.55)' : 'rgba(74,44,30,0.5)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-44, -14); g.lineTo(-80, -22); g.moveTo(-44, -3); g.lineTo(-80, 1);
    g.moveTo(44, -14); g.lineTo(80, -22); g.moveTo(44, -3); g.lineTo(80, 1);
    g.stroke();
    // 目
    const ex = 32, ey = -54;
    g.strokeStyle = '#2b1a14';
    if (face === 'dizzy') {
      g.lineWidth = 4.5;
      spiral(g, -ex, ey, 13, t * 9);
      spiral(g, ex, ey, 13, -t * 9);
    } else if (face === 'happy') {
      g.lineWidth = 6;
      [-1, 1].forEach(function (sd) {
        g.beginPath(); g.moveTo(sd * ex - 12, ey + 4); g.quadraticCurveTo(sd * ex, ey - 14, sd * ex + 12, ey + 4); g.stroke();
      });
    } else if (blink) {
      g.lineWidth = 5;
      [-1, 1].forEach(function (sd) {
        g.beginPath(); g.moveTo(sd * ex - 11, ey); g.quadraticCurveTo(sd * ex, ey + 7, sd * ex + 11, ey); g.stroke();
      });
    } else {
      const lx = (look || 0) * 3;
      [-1, 1].forEach(function (sd) {
        const x = sd * ex + lx;
        g.fillStyle = '#2b1a14'; ell(g, x, ey, 10.5, 13.5); g.fill();
        g.fillStyle = '#fff'; ell(g, x - 3 + lx * 0.3, ey - 5, 4.2, 4.8); g.fill();
        g.beginPath(); g.arc(x + 3.5, ey + 5, 2, 0, TAU); g.fill();
      });
    }
    // 口
    g.strokeStyle = OUT;
    if (face === 'dizzy') {
      g.fillStyle = '#7a2734'; ell(g, 0, 6, 9, 10); g.fill();
      g.lineWidth = 3; g.stroke();
    } else if (face === 'happy') {
      g.beginPath(); g.moveTo(-17, -5); g.quadraticCurveTo(0, 24, 17, -5); g.closePath();
      g.fillStyle = '#c2455a'; g.fill(); g.lineWidth = 3; g.stroke();
      g.fillStyle = '#ff9db0'; ell(g, 0, 7, 7, 4); g.fill();
    } else {
      g.lineWidth = 3.5;
      g.beginPath(); g.moveTo(-13, -6); g.quadraticCurveTo(-6.5, 3, 0, -6); g.quadraticCurveTo(6.5, 3, 13, -6); g.stroke();
    }
    // ピンクの鼻
    ell(g, 0, -25, 21, 15);
    const ng = g.createRadialGradient(-6, -31, 2, 0, -25, 22);
    ng.addColorStop(0, '#ffb3cb'); ng.addColorStop(1, '#ff6f9a');
    g.fillStyle = ng; g.fill();
    g.lineWidth = 3.5; g.strokeStyle = '#c23e6a'; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.85)'; ell(g, -7, -30, 6, 3.5, -0.3); g.fill();
    // 小さな手
    [-1, 1].forEach(function (sd) {
      const px = sd * 52, py = 66;
      g.fillStyle = gold ? '#ffeab0' : '#f6c4a8';
      ell(g, px, py, 25, 18, sd * 0.25); g.fill();
      g.lineWidth = 4; g.strokeStyle = OUT; g.stroke();
      g.strokeStyle = gold ? 'rgba(154,90,0,0.7)' : 'rgba(74,44,30,0.6)';
      g.lineWidth = 3;
      g.beginPath();
      for (let k = -1; k <= 1; k++) { g.moveTo(px + k * 9, py - 15); g.lineTo(px + k * 9 + sd * 1, py - 7); }
      g.stroke();
    });
    if (gold) drawCrown(g, t);
  }

  // 目を回しているときの星（あたまの上をくるくる）
  function drawDizzyStars(g, t) {
    for (let i = 0; i < 3; i++) {
      const a = t * 6 + i * TAU / 3;
      const x = Math.cos(a) * 70, y = -132 + Math.sin(a) * 18;
      const sz = 15 + Math.sin(a) * 3;
      starPath(g, x, y, sz, sz * 0.45, 5, a * 0.5);
      g.fillStyle = '#ffe14d'; g.fill();
      g.lineWidth = 3; g.strokeStyle = '#d68a00'; g.stroke();
    }
  }

  /* =========================================================
     絵：ばくだん（原点 = 玉の中心、半径86）
     黒い丸 + 導火線の火花 + 赤い帯 + 黄色の「！」三角
     ========================================================= */
  function drawSpark(g, x, y, t) {
    const pulse = 1 + 0.16 * Math.sin(t * 24);
    g.save();
    g.translate(x, y);
    const rg = g.createRadialGradient(0, 0, 2, 0, 0, 44);
    rg.addColorStop(0, 'rgba(255,245,170,0.95)');
    rg.addColorStop(1, 'rgba(255,150,40,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 44, 0, TAU); g.fill();
    g.rotate(t * 3);
    starPath(g, 0, 0, 28 * pulse, 11, 8, 0); g.fillStyle = '#ff8a1f'; g.fill();
    starPath(g, 0, 0, 17 * pulse, 7, 8, 0.2); g.fillStyle = '#fff27a'; g.fill();
    g.beginPath(); g.arc(0, 0, 5, 0, TAU); g.fillStyle = '#fff'; g.fill();
    g.restore();
    g.fillStyle = '#ffd34d';
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05 + Math.floor(t * 2.2 + i * 0.37) * 2.1;
      const k = (t * 2.2 + i * 0.37) % 1;
      g.globalAlpha = 1 - k;
      g.beginPath();
      g.arc(x + Math.cos(a) * (14 + k * 40), y + Math.sin(a) * (14 + k * 40) - k * 12, 4.5 * (1 - k) + 1, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  function drawBomb(g, t) {
    g.lineJoin = 'round';
    g.lineCap = 'round';
    // 導火線
    g.beginPath(); g.moveTo(0, -98); g.bezierCurveTo(4, -132, 46, -126, 40, -160);
    g.strokeStyle = '#3f2c1a'; g.lineWidth = 15; g.stroke();
    g.strokeStyle = '#dcb47a'; g.lineWidth = 8; g.stroke();
    g.setLineDash([5, 8]); g.strokeStyle = '#a77e48'; g.stroke(); g.setLineDash([]);
    // ふた
    A.roundRect(g, -27, -110, 54, 28, 8);
    g.fillStyle = '#a3adc0'; g.fill(); g.lineWidth = 5; g.strokeStyle = '#15171d'; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(-20, -104, 22, 6);
    // 玉
    g.beginPath(); g.arc(0, 0, 86, 0, TAU);
    const bg = g.createRadialGradient(-32, -38, 6, 0, 0, 98);
    bg.addColorStop(0, '#848ca0'); bg.addColorStop(0.32, '#3b404d'); bg.addColorStop(1, '#121419');
    g.fillStyle = bg; g.fill();
    g.lineWidth = 6; g.strokeStyle = '#07080b'; g.stroke();
    // 赤い帯（玉にそって少し曲げる）
    g.save();
    g.beginPath(); g.arc(0, 0, 83, 0, TAU); g.clip();
    g.beginPath();
    g.moveTo(-92, 10); g.quadraticCurveTo(0, 30, 92, 10);
    g.lineTo(92, 44); g.quadraticCurveTo(0, 64, -92, 44); g.closePath();
    g.fillStyle = '#ff3b4f'; g.fill();
    g.strokeStyle = '#a3142a'; g.lineWidth = 4; g.stroke();
    g.restore();
    // 黄色い注意マーク
    g.beginPath();
    g.moveTo(0, -66); g.lineTo(40, 6); g.lineTo(-40, 6); g.closePath();
    g.lineJoin = 'round';
    g.fillStyle = '#ffd23f'; g.fill();
    g.lineWidth = 6; g.strokeStyle = '#14161c'; g.stroke();
    A.roundRect(g, -5.5, -46, 11, 32, 5.5); g.fillStyle = '#14161c'; g.fill();
    g.beginPath(); g.arc(0, -5, 6, 0, TAU); g.fill();
    // ツヤ
    g.fillStyle = 'rgba(255,255,255,0.45)';
    ell(g, -50, -40, 16, 9, -0.8); g.fill();
    g.beginPath(); g.arc(-64, -14, 5, 0, TAU); g.fill();
    // 火花
    drawSpark(g, 40, -162, t);
  }

  /* =========================================================
     絵：土の盛り上がりと穴（原点 = 穴の中心）
     ========================================================= */
  function moundGrad(g) {
    const gr = g.createLinearGradient(0, -62, 0, 74);
    gr.addColorStop(0, '#d9a271'); gr.addColorStop(0.5, '#b47a49'); gr.addColorStop(1, '#895631');
    return gr;
  }
  function drawMound(g, x, y, s) {
    g.save();
    g.translate(x, y); g.scale(s, s);
    g.fillStyle = 'rgba(40,90,20,0.2)';
    ell(g, 0, 30, 192, 62); g.fill();
    ell(g, 0, 6, 172, 66);
    g.fillStyle = moundGrad(g); g.fill();
    g.lineWidth = 5; g.strokeStyle = '#6b4026'; g.stroke();
    // おくのふち（明るい）
    g.beginPath(); g.ellipse(0, 6, 158, 56, 0, Math.PI + 0.35, TAU - 0.35);
    g.strokeStyle = 'rgba(255,232,195,0.55)'; g.lineWidth = 7; g.stroke();
    // 小石
    g.fillStyle = '#e3bf95';
    [[-140, 18, 9, 6], [-118, -26, 6, 4], [134, -18, 8, 5], [146, 26, 6, 4]].forEach(function (p) { ell(g, p[0], p[1], p[2], p[3]); g.fill(); });
    // 穴
    ell(g, 0, 0, 122, 40);
    const hg = g.createLinearGradient(0, -40, 0, 40);
    hg.addColorStop(0, '#5e3a24'); hg.addColorStop(0.45, '#2c180d'); hg.addColorStop(1, '#170c06');
    g.fillStyle = hg; g.fill();
    g.lineWidth = 4; g.strokeStyle = '#3b2214'; g.stroke();
    g.restore();
  }
  // 穴の手前の土（モグラの下半分をかくす）
  function drawLip(g, x, y, s) {
    g.save();
    g.translate(x, y); g.scale(s, s);
    g.beginPath();
    g.ellipse(0, 0, 122, 40, 0, Math.PI, 0, true);
    g.lineTo(172, 6);
    g.ellipse(0, 6, 172, 66, 0, 0, Math.PI, false);
    g.closePath();
    g.fillStyle = moundGrad(g); g.fill();
    g.beginPath(); g.ellipse(0, 6, 172, 66, 0, 0.02, Math.PI - 0.02);
    g.lineWidth = 5; g.strokeStyle = '#6b4026'; g.stroke();
    g.beginPath(); g.ellipse(0, 0, 122, 40, 0, Math.PI * 0.06, Math.PI * 0.94);
    g.lineWidth = 7; g.strokeStyle = 'rgba(255,226,182,0.75)'; g.stroke();
    // 土のつぶ
    g.fillStyle = 'rgba(120,70,35,0.45)';
    [[-60, 52, 5], [-20, 60, 4], [30, 58, 5], [80, 48, 4], [-100, 38, 4]].forEach(function (p) { g.beginPath(); g.arc(p[0], p[1], p[2], 0, TAU); g.fill(); });
    // 手前の草
    tuft(g, -150, 50, 1.1, '#5aa83c');
    tuft(g, 156, 44, 1.0, '#5aa83c');
    g.restore();
  }
  function tuft(g, x, y, s, col) {
    g.save(); g.translate(x, y); g.scale(s, s);
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(-16, 0); g.quadraticCurveTo(-14, -14, -22, -26); g.quadraticCurveTo(-6, -16, -4, 0);
    g.moveTo(-6, 0); g.quadraticCurveTo(-2, -22, 0, -34); g.quadraticCurveTo(6, -20, 6, 0);
    g.moveTo(4, 0); g.quadraticCurveTo(10, -14, 22, -24); g.quadraticCurveTo(14, -10, 16, 0);
    g.fill();
    g.restore();
  }

  /* =========================================================
     絵：ピコピコハンマー（原点 = ヘッドの中心 = 当たる場所）
     sw: 0 = かまえ, 1 = 振り下ろした瞬間
     ========================================================= */
  const HAMMER_SCALE = 0.85;
  // 叩いた直後、ハンマーのヘッドが モグラの顔に重ならないように 右上へ はね上げる
  const RECOIL_X = 150, RECOIL_Y = -120;
  function recoilK(t) {
    if (t < 0.06) return 0;                                   // 当たった瞬間は そのまま（当たって見える）
    if (t < 0.15) return easeOut((t - 0.06) / 0.09);          // はね上がる
    if (t < 0.34) return 1;                                   // 目をまわしている間は どいている
    if (t < 0.52) return 1 - easeOut((t - 0.34) / 0.18);      // もどる
    return 0;
  }
  function drawHammer(g, x, y, sw) {
    g.save();
    g.translate(x, y + 10 * sw);
    g.scale(HAMMER_SCALE, HAMMER_SCALE);
    g.rotate(lerp(-0.55, -1.05, sw));
    g.lineJoin = 'round';
    // 柄
    A.roundRect(g, -10, 24, 20, 150, 10);
    g.fillStyle = '#ffd34d'; g.fill();
    g.lineWidth = 4; g.strokeStyle = '#9a6200'; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(-5, 30, 4, 90);
    A.roundRect(g, -13, 124, 26, 56, 13);
    g.fillStyle = '#59b8ff'; g.fill(); g.stroke();
    // ヘッド
    g.save();
    g.scale(1 - 0.14 * sw, 1 + 0.1 * sw);
    A.roundRect(g, -52, -32, 104, 64, 18);
    const hg = g.createLinearGradient(0, -32, 0, 32);
    hg.addColorStop(0, '#ff8a9c'); hg.addColorStop(0.5, '#ff4f68'); hg.addColorStop(1, '#d92a4a');
    g.fillStyle = hg; g.fill();
    g.lineWidth = 4; g.strokeStyle = '#8f1430'; g.stroke();
    g.strokeStyle = 'rgba(130,10,40,0.35)'; g.lineWidth = 4;
    g.beginPath();
    for (let i = -2; i <= 2; i++) { g.moveTo(i * 15, -27); g.lineTo(i * 15, 27); }
    g.stroke();
    [-1, 1].forEach(function (sd) {
      ell(g, sd * 56, 0, 13, 34);
      g.fillStyle = '#ffd34d'; g.fill();
      g.lineWidth = 4; g.strokeStyle = '#9a6200'; g.stroke();
      ell(g, sd * 56, 0, 6, 20);
      g.fillStyle = 'rgba(255,255,255,0.45)'; g.fill();
    });
    g.fillStyle = 'rgba(255,255,255,0.45)';
    A.roundRect(g, -40, -24, 80, 10, 5); g.fill();
    g.restore();
    g.restore();
  }

  /* =========================================================
     絵：背景（空・雲・太陽・丘・柵・木・花・ちょうちょ）
     ========================================================= */
  function cloud(g, x, y, s) {
    g.beginPath();
    g.arc(x, y, 50 * s, 0, TAU);
    g.arc(x + 55 * s, y - 28 * s, 62 * s, 0, TAU);
    g.arc(x + 122 * s, y, 50 * s, 0, TAU);
    g.arc(x + 60 * s, y + 16 * s, 56 * s, 0, TAU);
    g.fill();
  }

  function drawSun(g, x, y, t) {
    g.save();
    g.translate(x, y);
    g.rotate(t * 0.15);
    g.fillStyle = 'rgba(255,214,90,0.55)';
    for (let i = 0; i < 12; i++) {
      g.rotate(TAU / 12);
      g.beginPath(); g.moveTo(-12, -74); g.lineTo(0, -102); g.lineTo(12, -74); g.closePath(); g.fill();
    }
    g.restore();
    g.beginPath(); g.arc(x, y, 62, 0, TAU);
    const sg = g.createRadialGradient(x - 18, y - 20, 6, x, y, 64);
    sg.addColorStop(0, '#fff6b0'); sg.addColorStop(1, '#ffc93a');
    g.fillStyle = sg; g.fill();
    g.lineWidth = 4; g.strokeStyle = '#f0a520'; g.stroke();
    // にっこり顔
    g.fillStyle = '#9a5a00';
    ell(g, x - 20, y - 6, 5, 7); g.fill();
    ell(g, x + 20, y - 6, 5, 7); g.fill();
    g.strokeStyle = '#9a5a00'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.arc(x, y + 6, 16, 0.25 * Math.PI, 0.75 * Math.PI); g.stroke();
    g.fillStyle = 'rgba(255,120,120,0.45)';
    ell(g, x - 36, y + 10, 9, 5); g.fill();
    ell(g, x + 36, y + 10, 9, 5); g.fill();
  }

  const CLOUDS = [[60, 150, 1.0, 9], [640, 66, 0.7, 13], [1150, 210, 0.85, 7], [1520, 120, 1.05, 10]];
  function drawSky(g, t) {
    const sg = g.createLinearGradient(0, 0, 0, 420);
    sg.addColorStop(0, '#86cff9'); sg.addColorStop(1, '#e2f5ff');
    g.fillStyle = sg; g.fillRect(-20, -20, W + 40, 450);
    drawSun(g, 620, 128, t);
    g.fillStyle = 'rgba(255,255,255,0.93)';
    for (let i = 0; i < CLOUDS.length; i++) {
      const c = CLOUDS[i];
      const x = ((c[0] + t * c[3]) % (W + 520)) - 260;
      cloud(g, x, c[1], c[2]);
    }
  }

  function drawFence(g, top, bottom) {
    g.lineJoin = 'round';
    g.fillStyle = '#f3dfbf'; g.strokeStyle = '#c59f74'; g.lineWidth = 3;
    [top + 20, top + 52].forEach(function (y) { g.fillRect(-10, y, W + 20, 13); g.strokeRect(-10, y, W + 20, 13); });
    for (let x = -14; x < W + 20; x += 48) {
      g.beginPath();
      g.moveTo(x, bottom); g.lineTo(x, top + 14); g.lineTo(x + 15, top); g.lineTo(x + 30, top + 14); g.lineTo(x + 30, bottom);
      g.closePath();
      g.fillStyle = '#fff9ee'; g.fill();
      g.strokeStyle = '#d2b28a'; g.stroke();
      g.fillStyle = 'rgba(200,160,110,0.18)'; g.fillRect(x + 20, top + 14, 8, bottom - top - 14);
    }
  }

  function drawTree(g, x, y, s) {
    g.save();
    g.translate(x, y); g.scale(s, s);
    g.fillStyle = 'rgba(40,90,20,0.2)';
    ell(g, 0, 4, 120, 26); g.fill();
    // 幹
    g.fillStyle = '#9b6b4f'; g.strokeStyle = '#6b4530'; g.lineWidth = 4;
    g.beginPath();
    g.moveTo(-26, 4); g.quadraticCurveTo(-12, -90, -20, -190); g.lineTo(20, -190); g.quadraticCurveTo(12, -90, 26, 4); g.closePath();
    g.fill(); g.stroke();
    // 葉っぱ
    const blobs = [[-78, -214, 78], [74, -222, 82], [0, -276, 104], [-56, -322, 70], [58, -318, 72], [0, -364, 60]];
    g.fillStyle = '#4f9e3a';
    blobs.forEach(function (b) { g.beginPath(); g.arc(b[0] + 6, b[1] + 10, b[2], 0, TAU); g.fill(); });
    g.fillStyle = '#6cc04f';
    blobs.forEach(function (b) { g.beginPath(); g.arc(b[0], b[1], b[2], 0, TAU); g.fill(); });
    g.fillStyle = '#8fda6c';
    blobs.forEach(function (b) { g.beginPath(); g.arc(b[0] - b[2] * 0.3, b[1] - b[2] * 0.32, b[2] * 0.42, 0, TAU); g.fill(); });
    // りんご
    [[-90, -200], [60, -250], [-20, -320], [96, -190], [-50, -270], [30, -360]].forEach(function (a) {
      g.beginPath(); g.arc(a[0], a[1], 13, 0, TAU); g.fillStyle = '#ff5a6e'; g.fill();
      g.lineWidth = 3; g.strokeStyle = '#b02a40'; g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.arc(a[0] - 4, a[1] - 4, 4, 0, TAU); g.fill();
    });
    g.restore();
  }

  function drawBush(g, x, y, s) {
    g.save(); g.translate(x, y); g.scale(s, s);
    g.fillStyle = '#4f9e3a';
    [[-50, -20, 42], [0, -38, 52], [52, -22, 40]].forEach(function (b) { g.beginPath(); g.arc(b[0], b[1] + 6, b[2], 0, TAU); g.fill(); });
    g.fillStyle = '#69bb4c';
    [[-50, -24, 40], [0, -42, 50], [52, -26, 38]].forEach(function (b) { g.beginPath(); g.arc(b[0], b[1], b[2], 0, TAU); g.fill(); });
    g.fillStyle = '#fff';
    [[-60, -36], [-20, -60], [14, -30], [40, -50], [66, -28]].forEach(function (p, i) {
      g.fillStyle = i % 2 ? '#ffd0e0' : '#ffffff';
      g.beginPath(); g.arc(p[0], p[1], 6, 0, TAU); g.fill();
    });
    g.restore();
  }

  function drawTulip(g, x, y, s, col) {
    g.save(); g.translate(x, y); g.scale(s, s);
    g.strokeStyle = '#3f8f2c'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -40); g.stroke();
    g.fillStyle = '#5bb043';
    g.beginPath(); g.moveTo(0, -4); g.quadraticCurveTo(-22, -16, -18, -34); g.quadraticCurveTo(-6, -20, 0, -10); g.fill();
    g.beginPath();
    g.moveTo(-15, -58); g.lineTo(-7, -48); g.lineTo(0, -60); g.lineTo(7, -48); g.lineTo(15, -58);
    g.quadraticCurveTo(17, -36, 0, -36); g.quadraticCurveTo(-17, -36, -15, -58);
    g.fillStyle = col; g.fill();
    g.lineWidth = 2.5; g.strokeStyle = 'rgba(90,30,40,0.45)'; g.stroke();
    g.restore();
  }
  function drawDaisy(g, x, y, s, col) {
    g.save(); g.translate(x, y); g.scale(s, s);
    g.strokeStyle = '#3f8f2c'; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -30); g.stroke();
    g.fillStyle = col;
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8;
      ell(g, Math.cos(a) * 11, -34 + Math.sin(a) * 11, 8, 4.5, a); g.fill();
    }
    g.beginPath(); g.arc(0, -34, 7, 0, TAU); g.fillStyle = '#ffc928'; g.fill();
    g.restore();
  }

  function drawSign(g, x, y) {
    g.save(); g.translate(x, y);
    g.fillStyle = '#9b6b4f'; g.strokeStyle = '#5e3c28'; g.lineWidth = 4;
    g.fillRect(-10, -20, 20, 150); g.strokeRect(-10, -20, 20, 150);
    g.rotate(-0.04);
    A.roundRect(g, -128, -112, 256, 118, 22);
    g.fillStyle = '#e8b981'; g.fill(); g.lineWidth = 6; g.strokeStyle = '#7a4e30'; g.stroke();
    g.strokeStyle = 'rgba(122,78,48,0.25)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(-112, -74); g.lineTo(112, -74); g.moveTo(-112, -36); g.lineTo(112, -36); g.stroke();
    txt(g, 'モグラの', 0, -78, { size: 40, color: '#5e3c28' });
    txt(g, 'にわ', 0, -32, { size: 44, color: '#5e3c28' });
    g.restore();
  }

  function freeSpot(x, y, pad) {
    for (let i = 0; i < LAYOUT.length; i++) {
      const h = LAYOUT[i];
      if (Math.abs(x - h.x) < (190 + pad) * h.s && y > h.y - (240 + pad) * h.s && y < h.y + (96 + pad) * h.s) return false;
    }
    return true;
  }

  // 動かない地面を 1 枚の画像にまとめる
  function paintGround(g) {
    // 遠くの丘
    g.fillStyle = '#c8eeb4';
    g.beginPath(); g.moveTo(0, 430); g.lineTo(0, 300);
    g.bezierCurveTo(260, 236, 520, 250, 780, 304);
    g.bezierCurveTo(1020, 248, 1310, 222, 1580, 290);
    g.bezierCurveTo(1740, 252, 1860, 262, 1920, 284);
    g.lineTo(1920, 430); g.closePath(); g.fill();
    g.fillStyle = '#b4e49c';
    g.beginPath(); g.moveTo(0, 430); g.lineTo(0, 336);
    g.bezierCurveTo(380, 296, 700, 330, 960, 336);
    g.bezierCurveTo(1260, 300, 1600, 320, 1920, 330);
    g.lineTo(1920, 430); g.closePath(); g.fill();
    // 丘の上の小さな木
    [[420, 300], [470, 306], [1330, 262], [1380, 270], [1000, 330]].forEach(function (p) {
      g.fillStyle = '#8bcf6d'; g.beginPath(); g.arc(p[0], p[1] - 14, 16, 0, TAU); g.fill();
      g.fillStyle = '#9b7a5f'; g.fillRect(p[0] - 2, p[1], 4, 10);
    });
    // 柵
    drawFence(g, 318, 410);
    // 芝生
    const lg = g.createLinearGradient(0, 396, 0, H);
    lg.addColorStop(0, '#addf80'); lg.addColorStop(0.45, '#91d368'); lg.addColorStop(1, '#73bf4e');
    g.fillStyle = lg; g.fillRect(0, 396, W, H - 396);
    // 刈り込みのしま模様（奥ほど細く）
    let y = 396, hgt = 34, k = 0;
    while (y < H) {
      if (k % 2 === 0) { g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(0, y, W, hgt); }
      y += hgt; hgt *= 1.16; k++;
    }
    // 柵の前のしげみ
    [[90, 410, 0.8], [520, 404, 0.7], [1000, 402, 0.62], [1440, 404, 0.7], [1840, 410, 0.8], [760, 404, 0.55], [1230, 404, 0.55]].forEach(function (b) { drawBush(g, b[0], b[1], b[2]); });
    // 木
    drawTree(g, 150, 560, 0.95);
    drawTree(g, 1790, 520, 0.86);
    // 看板
    drawSign(g, 1745, 790);
    // 草のふさ・花（決まった並び）
    const r = A.rng(20261114);
    for (let i = 0; i < 160; i++) {
      const x = r() * W, yy = 420 + r() * (H - 430);
      if (!freeSpot(x, yy, -60)) continue;
      if (x > 1590 && x < 1900 && yy > 640 && yy < 940) continue; // 看板のまわり
      tuft(g, x, yy, 0.55 + r() * 0.5, r() < 0.5 ? '#6cbc4c' : '#5aa83c');
    }
    const cols = ['#ff7fa8', '#ffd34d', '#ff8f5a', '#b48cff', '#ffffff'];
    let placed = 0;
    for (let i = 0; i < 400 && placed < 70; i++) {
      const x = 20 + r() * (W - 40), yy = 440 + r() * (H - 450);
      if (!freeSpot(x, yy, 20)) continue;
      if (x > 1600 && x < 1890 && yy > 640 && yy < 930) continue; // 看板のまわり
      const c = cols[Math.floor(r() * cols.length)];
      const sc = 0.75 + (yy - 440) / 640 * 0.6;
      if (r() < 0.45) drawTulip(g, x, yy, sc, c === '#ffffff' ? '#ff5a6e' : c);
      else drawDaisy(g, x, yy, sc, c);
      placed++;
    }
    // 穴
    LAYOUT.forEach(function (h) { drawMound(g, h.x, h.y, h.s); });
  }

  let bgCanvas = null, bgScale = 0;
  function getGround(g) {
    let sc = 1;
    try { const m = g.getTransform(); sc = Math.round(Math.hypot(m.a, m.b) * 100) / 100 || 1; } catch (e) { sc = 1; }
    sc = clamp(sc, 0.5, 2);
    if (!bgCanvas || bgScale !== sc) {
      const c = document.createElement('canvas');
      c.width = Math.round(W * sc); c.height = Math.round(H * sc);
      const cg = c.getContext('2d');
      cg.setTransform(sc, 0, 0, sc, 0, 0);
      paintGround(cg);
      bgCanvas = c; bgScale = sc;
    }
    return bgCanvas;
  }

  const BUTTERFLIES = [
    { cx: 200, cy: 760, ax: 110, ay: 190, sx: 0.37, sy: 0.53, ph: 0, col: '#ff9ec4' },
    { cx: 1720, cy: 560, ax: 120, ay: 120, sx: 0.31, sy: 0.47, ph: 2, col: '#ffd84a' },
    { cx: 1150, cy: 262, ax: 520, ay: 24, sx: 0.11, sy: 0.7, ph: 4, col: '#8fd0ff' },
  ];
  function drawButterfly(g, x, y, col, flap, dir) {
    g.save(); g.translate(x, y); g.scale(dir, 1);
    const f = 0.3 + 0.7 * Math.abs(Math.sin(flap));
    g.fillStyle = col; g.strokeStyle = 'rgba(80,50,90,0.7)'; g.lineWidth = 2.5;
    g.save(); g.scale(f, 1);
    ell(g, -15, -10, 17, 13, -0.5); g.fill(); g.stroke();
    ell(g, 15, -10, 17, 13, 0.5); g.fill(); g.stroke();
    ell(g, -11, 9, 11, 9, 0.4); g.fill(); g.stroke();
    ell(g, 11, 9, 11, 9, -0.4); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.6)';
    ell(g, -16, -12, 5, 4); g.fill(); ell(g, 16, -12, 5, 4); g.fill();
    g.restore();
    g.fillStyle = '#5a3d5c'; ell(g, 0, 0, 3.5, 13); g.fill();
    g.strokeStyle = '#5a3d5c'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-1, -12); g.quadraticCurveTo(-6, -22, -10, -24); g.moveTo(1, -12); g.quadraticCurveTo(6, -22, 10, -24); g.stroke();
    g.restore();
  }
  function drawButterflies(g, t) {
    BUTTERFLIES.forEach(function (b) {
      const x = b.cx + b.ax * Math.sin(t * b.sx + b.ph);
      const y = b.cy + b.ay * Math.sin(t * b.sy + b.ph * 1.7) + Math.sin(t * 6 + b.ph) * 6;
      const dir = Math.cos(t * b.sx + b.ph) >= 0 ? 1 : -1;
      drawButterfly(g, x, y, b.col, t * 13 + b.ph, dir);
    });
  }

  // あそびかた画面（説明パネルの外）で顔を出す、はしっこの小さな穴
  const SIDE_HOLES = [{ x: 150, y: 985, s: 0.56, off: 0 }, { x: 1785, y: 1000, s: 0.5, off: 1.8 }];
  function drawSidePeek(g, t) {
    for (let i = 0; i < SIDE_HOLES.length; i++) {
      const o = SIDE_HOLES[i];
      const u = (t + o.off) % 3.6;
      let pos = 0;
      if (u < 0.2) pos = easeOutBack(u / 0.2);
      else if (u < 1.9) pos = 1;
      else if (u < 2.15) pos = 1 - Math.pow((u - 1.9) / 0.25, 2);
      drawMound(g, o.x, o.y, o.s);
      if (pos > 0.01) {
        const s = o.s;
        g.save();
        g.beginPath();
        g.rect(o.x - 215 * s, o.y - 450 * s, 430 * s, 450 * s);
        g.moveTo(o.x + 122 * s, o.y);
        g.ellipse(o.x, o.y, 122 * s, 40 * s, 0, 0, TAU);
        g.clip();
        g.translate(o.x, o.y); g.scale(s, s);
        g.translate(0, 215 - 305 * pos);
        g.rotate(Math.sin(t * 2.2 + i) * 0.06);
        drawMole(g, 'mole', u > 0.6 && u < 1.5 ? 'happy' : 'normal', t, Math.sin(t * 1.3 + i * 2), false);
        g.restore();
      }
      drawLip(g, o.x, o.y, o.s);
    }
  }

  /* =========================================================
     メニューカードのサムネイル（552x300）
     ========================================================= */
  function drawThumb(g, w, h, t) {
    const sg = g.createLinearGradient(0, 0, 0, 130);
    sg.addColorStop(0, '#86cff9'); sg.addColorStop(1, '#e2f5ff');
    g.fillStyle = sg; g.fillRect(0, 0, w, 140);
    // 左上は番号バッジ、右上は「あそぶ」ボタンが重なるので、太陽は中央より
    g.save(); g.translate(300, 34); g.scale(0.5, 0.5); drawSun(g, 0, 0, t); g.restore();
    g.fillStyle = 'rgba(255,255,255,0.95)';
    cloud(g, ((30 + t * 16) % (w + 180)) - 90, 44, 0.42);
    cloud(g, ((300 + t * 10) % (w + 180)) - 90, 78, 0.3);
    // 柵
    g.save(); g.scale(0.5, 0.5); g.translate(0, -100); drawFence(g, 240, 330); g.restore();
    const lg = g.createLinearGradient(0, 110, 0, h);
    lg.addColorStop(0, '#addf80'); lg.addColorStop(1, '#79c453');
    g.fillStyle = lg; g.fillRect(0, 112, w, h - 112);
    tuft(g, 20, 290, 0.7, '#5aa83c');
    tuft(g, 530, 284, 0.7, '#5aa83c');
    drawDaisy(g, 186, 296, 0.75, '#ffffff');
    drawTulip(g, 366, 298, 0.75, '#ff7fa8');
    drawButterfly(g, 276 + Math.sin(t * 0.9) * 200, 136 + Math.sin(t * 2.1) * 10, '#ff9ec4', t * 13, Math.cos(t * 0.9) >= 0 ? 1 : -1);

    // 右上の「あそぶ」札（x>388, y<74）に ばくだんの火花が重ならないよう、ばくだんは まんなかに置く。
    // 左上の番号札（x<86, y<86）には いちばん左のモグラの頭が近いので、穴の列は少し下げてある。
    const s = 0.56, hy = 220;
    const xs = [96, 276, 456];
    const kinds = ['mole', 'bomb', 'gold'];
    const P = 3;
    for (let i = 0; i < 3; i++) {
      const x = xs[i];
      drawMound(g, x, hy, s);
      const u = ((t - i * 0.9) % P + P) % P;
      let pos = 0;
      if (u < 0.15) pos = easeOutBack(u / 0.15);
      else if (u < 1.75) pos = 1;
      else if (u < 1.95) pos = 1 - Math.pow((u - 1.75) / 0.2, 2);
      const hit = i === 0 && u >= 1.0 && u < 1.75;
      if (hit) pos = 1 - 0.2 * easeOut(Math.min(1, (u - 1.0) / 0.08));
      if (pos > 0.01) {
        g.save();
        g.beginPath();
        g.rect(x - 210 * s, hy - 440 * s, 420 * s, 440 * s);
        g.moveTo(x + 122 * s, hy);
        g.ellipse(x, hy, 122 * s, 40 * s, 0, 0, TAU);
        g.clip();
        g.translate(x, hy); g.scale(s, s);
        if (kinds[i] === 'bomb') { g.translate(0, 240 - 320 * pos); drawBomb(g, t); }
        else {
          g.translate(0, 215 - 305 * pos);
          drawMole(g, kinds[i], hit ? 'dizzy' : 'normal', t, Math.sin(t * 2 + i), false);
          if (hit) drawDizzyStars(g, t);
        }
        g.restore();
      }
      drawLip(g, x, hy, s);
      if (kinds[i] === 'gold' && pos > 0.5) {
        const k = (t * 3) % 1;
        g.fillStyle = '#fffbe0';
        starPath(g, x + 52, hy - 120, 12 * Math.sin(k * Math.PI), 3, 4, 0); g.fill();
        starPath(g, x - 50, hy - 70, 9 * Math.sin(((k + 0.5) % 1) * Math.PI), 2.5, 4, 0); g.fill();
      }
    }
    // ハンマーで左のモグラの頭をピコッ → 星と +10
    const u0 = ((t % P) + P) % P;
    const HX = 124, HY = 118;
    let sw = 0;
    if (u0 >= 1.0 && u0 < 1.25) sw = u0 < 1.05 ? 1 : 1 - (u0 - 1.05) / 0.2;
    if (u0 >= 1.0 && u0 < 1.8) {
      const k = (u0 - 1.0) / 0.8;
      if (k < 0.45) {
        g.fillStyle = '#ffe14d'; g.strokeStyle = '#d68a00'; g.lineWidth = 2;
        for (let j = 0; j < 6; j++) {
          const a = j * TAU / 6 + 0.3, rr = 14 + k * 110;
          starPath(g, HX + Math.cos(a) * rr, HY + Math.sin(a) * rr * 0.7, 9, 4, 5, a); g.fill(); g.stroke();
        }
      }
      g.save(); g.globalAlpha = 1 - k * k;
      txt(g, '+10', 186, 92 - k * 26, { size: 46, color: '#fff', stroke: '#6b3f22', strokeWidth: 9 });
      g.restore();
    }
    g.save(); g.translate(HX + Math.sin(t * 2) * 3, HY); g.scale(0.62, 0.62); drawHammer(g, 0, 0, sw); g.restore();
  }

  /* =========================================================
     あそびかた の アイコン（インラインSVG）
     ========================================================= */
  const SVG_MOLE =
    '<svg viewBox="0 0 64 64">' +
    '<ellipse cx="32" cy="52" rx="29" ry="10" fill="#b47a49" stroke="#6b4026" stroke-width="2"/>' +
    '<ellipse cx="32" cy="50" rx="21" ry="6.5" fill="#2c180d"/>' +
    '<path d="M15 51C15 27 21 13 32 13S49 27 49 51Z" fill="#93644a" stroke="#4a2c1e" stroke-width="2.5"/>' +
    '<ellipse cx="32" cy="35" rx="10.5" ry="7.5" fill="#f3dcc0"/>' +
    '<ellipse cx="32" cy="31.5" rx="5.5" ry="4" fill="#ff7aa2" stroke="#c23e6a" stroke-width="1.2"/>' +
    '<ellipse cx="25" cy="25" rx="2.4" ry="3" fill="#2b1a14"/><ellipse cx="39" cy="25" rx="2.4" ry="3" fill="#2b1a14"/>' +
    '<circle cx="24.3" cy="23.8" r="0.9" fill="#fff"/><circle cx="38.3" cy="23.8" r="0.9" fill="#fff"/>' +
    '<ellipse cx="19" cy="33" rx="3.5" ry="2.2" fill="#ff8fb3" opacity=".75"/><ellipse cx="45" cy="33" rx="3.5" ry="2.2" fill="#ff8fb3" opacity=".75"/>' +
    '<path d="M3 52A29 10 0 0 0 61 52L53 50A21 6.5 0 0 1 11 50Z" fill="#b47a49" stroke="#6b4026" stroke-width="2" stroke-linejoin="round"/>' +
    '</svg>';
  const SVG_GOLD =
    '<svg viewBox="0 0 64 64">' +
    '<ellipse cx="32" cy="52" rx="29" ry="10" fill="#b47a49" stroke="#6b4026" stroke-width="2"/>' +
    '<ellipse cx="32" cy="50" rx="21" ry="6.5" fill="#2c180d"/>' +
    '<path d="M15 51C15 27 21 15 32 15S49 27 49 51Z" fill="#ffcf35" stroke="#9a5a00" stroke-width="2.5"/>' +
    '<path d="M22 18L20 6L27 12L32 3L37 12L44 6L42 18Z" fill="#fff07a" stroke="#9a5a00" stroke-width="1.8" stroke-linejoin="round"/>' +
    '<circle cx="32" cy="15" r="1.8" fill="#ff5a6e"/>' +
    '<ellipse cx="32" cy="36" rx="10.5" ry="7.5" fill="#fff6d8"/>' +
    '<ellipse cx="32" cy="32.5" rx="5.5" ry="4" fill="#ff7aa2" stroke="#c23e6a" stroke-width="1.2"/>' +
    '<ellipse cx="25" cy="26" rx="2.4" ry="3" fill="#2b1a14"/><ellipse cx="39" cy="26" rx="2.4" ry="3" fill="#2b1a14"/>' +
    '<ellipse cx="19" cy="34" rx="3.5" ry="2.2" fill="#ff8fb3" opacity=".8"/><ellipse cx="45" cy="34" rx="3.5" ry="2.2" fill="#ff8fb3" opacity=".8"/>' +
    '<path d="M3 52A29 10 0 0 0 61 52L53 50A21 6.5 0 0 1 11 50Z" fill="#b47a49" stroke="#6b4026" stroke-width="2" stroke-linejoin="round"/>' +
    '<path d="M55 14l1.6 4.2 4.2 1.6-4.2 1.6-1.6 4.2-1.6-4.2-4.2-1.6 4.2-1.6z" fill="#ffe45c" stroke="#9a5a00" stroke-width="1"/>' +
    '<path d="M9 18l1.1 2.9 2.9 1.1-2.9 1.1-1.1 2.9-1.1-2.9-2.9-1.1 2.9-1.1z" fill="#ffe45c" stroke="#9a5a00" stroke-width="0.8"/>' +
    '</svg>';
  const SVG_BOMB =
    '<svg viewBox="0 0 64 64">' +
    '<path d="M32 17C33 10 41 11 41 5" fill="none" stroke="#3f2c1a" stroke-width="4.5" stroke-linecap="round"/>' +
    '<path d="M32 17C33 10 41 11 41 5" fill="none" stroke="#dcb47a" stroke-width="2.4" stroke-linecap="round"/>' +
    '<rect x="25.5" y="14" width="13" height="7" rx="2" fill="#a3adc0" stroke="#15171d" stroke-width="1.6"/>' +
    '<circle cx="32" cy="40" r="21" fill="#2e323d" stroke="#07080b" stroke-width="2.5"/>' +
    '<path d="M11.6 42Q32 48 52.4 42L51.6 48.5Q32 54.5 12.4 48.5Z" fill="#ff3b4f"/>' +
    '<path d="M32 23.5L41.5 39.5H22.5Z" fill="#ffd23f" stroke="#14161c" stroke-width="1.8" stroke-linejoin="round"/>' +
    '<rect x="30.9" y="27.5" width="2.2" height="6.5" rx="1.1" fill="#14161c"/><circle cx="32" cy="36.6" r="1.3" fill="#14161c"/>' +
    '<ellipse cx="20" cy="31" rx="3.6" ry="2.2" fill="#fff" opacity=".45" transform="rotate(-45 20 31)"/>' +
    '<path d="M41 0.5l1.7 3.2 3.6.6-2.7 2.4.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.7-2.4 3.6-.6z" fill="#ff9a1f" stroke="#ffe45c" stroke-width="0.8"/>' +
    '</svg>';

  /* =========================================================
     ゲーム登録
     ========================================================= */
  A.register({
    id: 'mole',
    order: 2,
    title: 'もぐらたたきチャレンジ',
    shortTitle: 'もぐら',
    catch: '30びょうで モグラを たくさん たたこう！',
    tags: ['1人', 'マウス', '30びょう'],
    theme: { main: '#7cc95a', dark: '#4a9a2c', light: '#eaf8df' },
    bgm: 'mole',
    howto: [
      { icon: SVG_MOLE, html: 'モグラを クリック！ <b>+10てん</b>' },
      { icon: SVG_GOLD, html: 'きんいろモグラは <b>+30てん</b>' },
      { icon: SVG_BOMB, html: 'ばくだんに さわると <b style="color:#e8264a">-20てん</b>' },
    ],
    modes: [{ id: 'normal', label: 'スタート！' }],
    best: { key: 'mole.best', label: 'ハイスコア', unit: 'てん' },
    // ランキング（登録・ニックネーム入力・順位表示は すべてエンジン側。ここは宣言だけ）
    rank: {
      boards: [{ id: 'mole', label: 'もぐらたたき', unit: 'てん' }],
      boardOf: function () { return 'mole'; },
    },
    drawThumb: drawThumb,
    create: createGame,
  });

  // 結果リボンのことば（点数で変わる）
  function ribbonFor(score) {
    if (score >= 700) return 'もぐらたたき めいじん！';
    if (score >= 500) return 'すごい！ はやわざ！';
    if (score >= 280) return 'いいね！ そのちょうし！';
    if (score >= 100) return 'よく がんばったね！';
    if (score > 0) return 'ナイス チャレンジ！';
    return 'もういちど ちょうせん！';
  }

  function createGame(api) {
    const seedQ = parseInt(api.params.get('seed'), 10);
    const rnd = api.rng(isFinite(seedQ) ? seedQ : (Math.random() * 1e9) >>> 0);

    const holes = LAYOUT.map(function (L, i) {
      return {
        i: i, x: L.x, y: L.y, s: L.s, row: L.row,
        state: 'empty', kind: 'mole', pos: 0, t: 0, stay: 1, cool: 0, from: 1, sinkDur: SINK,
        hitFrom: 1, id: 0, age: 0, upT: 0, wasHit: false, endedByGame: false, celebrate: false,
        blinkT: 2, lookSeed: 0, peak: 1,
      };
    });

    let mode = 'demo';        // demo | count | play | end
    let anim = 0;             // 演出用の時間
    let cd = 0;               // カウントダウン経過
    let playT = 0;            // プレイ経過
    let endT = 0;
    let spawnT = 0;
    let demoT = 0.5;
    let score = 0;
    const counts = { mole: 0, gold: 0, bomb: 0, miss: 0 };
    let lastHole = -1, lastHole2 = -1, lastKind = '', lastGoldT = 0;
    let goldDue = GOLD_FIRST, goldN = 0;
    let nextId = 1;
    let finished = false;
    let hold = false;         // テスト用：エンジンからの update を止める
    let swingT = 9;
    let swingHit = false;     // 直前のクリックが当たったか（ハンマーのはね上げに使う）
    let coolT = 0;            // ハンマーを振り上げるまでの残り時間（連打対策）
    let shakeT = 0;
    let scoreBump = 0;
    let lastTickSec = 99;
    let missSfxT = 0;
    let logT = 0;             // 難易度の時系列ログの間隔
    let speedT = 9, speedMsg = '', speedStep = 0;  // 「スピードアップ！」の表示
    const best0 = api.store.get('mole.best', null);
    const parts = [];
    const texts = [];
    const stats = { spawns: 0, overlap: 0, minUp: 99, kinds: { mole: 0, gold: 0, bomb: 0 }, clicks: 0, clicksAfterEnd: 0, negative: 0, maxActive: 0, maxPerTick: 0, tooFast: 0, swings: 0, log: [], levelLog: [] };

    /* ---------- プレイヤーの実力推定 ----------
       sk.skill … なめらかにした実力（0〜1）。sk.level … 実際の難易度（経過時間＋実力）。
       命中していないクリックは sk.whiff を上げるだけで、実力は上がらない（連打対策）。 */
    const sk = {
      hit: 0.55,     // 直近の成功率（出たモグラのうち叩けた割合）
      rt: 0.35,      // 反応の速さ（0=おそい 1=はやい）
      whiff: 0.10,   // 空振り率（命中していないクリックの割合）
      combo: 0, maxCombo: 0,
      raw: 0.25,     // いまの推定値（なめらかにする前）
      skill: 0.25,   // なめらかにした実力
      level: 0,      // 難易度 0〜1
      maxActive: 2,  // 同時に出ている数の上限（ヒステリシス付き）
      hits: 0, escapes: 0, rtSum: 0, rtN: 0,   // 集計（テスト・結果画面用）
    };
    function skReset() {
      sk.hit = 0.55; sk.rt = 0.35; sk.whiff = 0.10; sk.combo = 0; sk.maxCombo = 0;
      sk.raw = 0.25; sk.skill = 0.25; sk.level = 0; sk.maxActive = 2;
      sk.hits = 0; sk.escapes = 0; sk.rtSum = 0; sk.rtN = 0;
    }
    // モグラ1匹の決着（叩けた / 逃げられた）。ばくだんは数えない
    function skResolve(ok) {
      sk.hit += ((ok ? 1 : 0) - sk.hit) * SK.HIT_ALPHA;
      if (ok) sk.hits++; else sk.escapes++;
    }
    // クリック1回ぶん（当たったか）。連打すると whiff が一気に上がる
    function skClick(ok) { sk.whiff += ((ok ? 0 : 1) - sk.whiff) * SK.WHIFF_ALPHA; }
    // 出現からクリックまでの時間
    function skReact(rt) {
      const v = clamp((SK.RT_SLOW - rt) / (SK.RT_SLOW - SK.RT_FAST), 0, 1);
      sk.rt += (v - sk.rt) * SK.RT_ALPHA;
      sk.rtSum += rt; sk.rtN++;
    }
    function skUpdate(dt) {
      const combo = clamp(sk.combo / SK.COMBO_FULL, 0, 1);
      let raw = SK.W_HIT * sk.hit + SK.W_RT * sk.rt + SK.W_COMBO * combo;
      raw *= 1 - SK.WHIFF_PENALTY * clamp(sk.whiff, 0, 1);   // 空振りぶん 割り引く
      sk.raw = clamp(raw, 0, 1);
      // 上げるときはゆっくり、下げるときは早め
      const tau = sk.raw > sk.skill ? SK.TAU_UP : SK.TAU_DOWN;
      sk.skill += (sk.raw - sk.skill) * Math.min(1, dt / tau);
      sk.level = clamp(SK.W_TIME * (playT / GAME_TIME) + SK.W_SKILL * sk.skill, 0, 1);
      // 同時に出ている数の上限は 行ったり来たりしないよう 0.03 ぶん粘らせる
      const k = sk.maxActive - 2;
      if (sk.maxActive < MAX_ACTIVE_CAP && sk.level > (k + 1) / 4 + 0.03) sk.maxActive++;
      else if (sk.maxActive > 2 && sk.level < k / 4 - 0.03) sk.maxActive--;
      // 「スピードアップ！」の合図（3段階・1回ずつ）
      const steps = [0.45, 0.70, 0.90];
      if (speedStep < 3 && sk.level >= steps[speedStep] && playT > 3 && playT < GAME_TIME - 2) {
        speedMsg = ['スピードアップ！', 'もっと はやく！', 'さいこうそく！'][speedStep];
        speedStep++; speedT = 0;
      }
    }

    // 叩ける状態か（叩かれたあと沈んでいる最中は もう叩けない）
    function clickable(h) { return (h.state === 'rise' || h.state === 'up' || h.state === 'sink') && !h.wasHit && !h.celebrate; }
    function activeCount() { let n = 0; for (let i = 0; i < holes.length; i++) if (clickable(holes[i])) n++; return n; }

    function spawnAt(h, kind, stay) {
      if (h.state !== 'empty' || h.cool > 0) stats.overlap++;
      h.state = 'rise'; h.kind = kind; h.t = 0; h.pos = 0; h.stay = stay; h.id = nextId++; h.peak = 1;
      h.age = 0; h.upT = 0; h.wasHit = false; h.endedByGame = false; h.celebrate = false;
      h.blinkT = 0.8 + Math.random() * 2; h.lookSeed = Math.random() * 10;
      h.bornT = playT;   // 反応時間をはかるための出現時刻
    }

    function popSound(kind) {
      if (kind === 'bomb') api.audio.noise({ dur: 0.12, vol: 0.035, f: 4200, q: 0.8, filter: 'highpass' });
      else if (kind === 'gold') api.audio.tone({ f: 990, f2: 1480, dur: 0.08, type: 'sine', vol: 0.06 });
      else api.audio.tone({ f: 560, f2: 860, dur: 0.07, type: 'sine', vol: 0.05 });
    }

    function spawnGame() {
      const D = difficultyFor(sk.level);
      const free = holes.filter(function (h) { return h.state === 'empty' && h.cool <= 0; });
      if (!free.length) return false;
      let c = free.filter(function (h) { return h.i !== lastHole && h.i !== lastHole2; });
      if (!c.length) c = free;
      const h = c[Math.floor(rnd() * c.length)];
      let bombs = 0, golds = 0;
      holes.forEach(function (o) { if (clickable(o)) { if (o.kind === 'bomb') bombs++; if (o.kind === 'gold') golds++; } });
      let kind = 'mole';
      // 金モグラは「予定の時刻をすぎたら出す」（確率にしない＝運で順位が変わらない）
      if (golds < GOLD_MAX_ACTIVE && playT >= goldDue) kind = 'gold';
      else if (playT >= BOMB_SAFE && lastKind !== 'bomb' && bombs < D.bombMax && rnd() < D.bomb) kind = 'bomb';
      let stay = D.stay * (0.92 + rnd() * 0.16);
      if (kind === 'gold') stay *= 0.95;
      stay = Math.max(STAY_MIN, stay);
      spawnAt(h, kind, stay);
      if (kind === 'gold') {
        lastGoldT = playT; goldN++;
        goldDue = GOLD_FIRST + goldN * GOLD_EVERY + (rnd() * 2 - 1) * GOLD_JITTER;
      }
      lastHole2 = lastHole; lastHole = h.i; lastKind = kind;
      stats.spawns++; stats.kinds[kind]++;
      if (stats.log.length < 200) stats.log.push({ t: +playT.toFixed(3), hole: h.i, kind: kind, stay: +stay.toFixed(3) });
      popSound(kind);
      return true;
    }

    function demoSpawn() {
      let n = 0;
      holes.forEach(function (h) { if (h.state !== 'empty') n++; });
      if (n >= 2) return;
      const free = holes.filter(function (h) { return h.state === 'empty' && h.cool <= 0; });
      if (!free.length) return;
      const h = free[Math.floor(Math.random() * free.length)];
      spawnAt(h, Math.random() < 0.15 ? 'gold' : 'mole', 1.3 + Math.random() * 1.2);
    }

    function toSink(h, dur) { h.state = 'sink'; h.t = 0; h.from = Math.max(0.01, h.pos); h.sinkDur = dur; }
    function toEmpty(h) {
      if (!h.wasHit && !h.celebrate && !h.endedByGame) {
        stats.minUp = Math.min(stats.minUp, h.upT);
        // 叩かれずに引っ込んだモグラ＝失敗（ばくだんは「叩かないのが正解」なので数えない）
        if (mode === 'play' && h.kind !== 'bomb') skResolve(false);
      }
      h.state = 'empty'; h.pos = 0; h.t = 0;
      // あそびかた画面のデモではシード付き乱数を使わない（?seed のテストが説明画面の長さに左右されないように）
      h.cool = COOL_MIN + (mode === 'demo' ? Math.random() : rnd()) * COOL_RAND;
    }

    function updHole(h, dt) {
      h.age += dt;
      switch (h.state) {
        case 'empty':
          if (h.cool > 0) h.cool -= dt;
          break;
        case 'rise': {
          h.t += dt;
          const k = Math.min(1, h.t / RISE);
          h.pos = h.peak * easeOutBack(k);
          if (k >= 1) { h.state = 'up'; h.t = 0; h.pos = h.peak; }
          break;
        }
        case 'up':
          h.t += dt; h.upT += dt; h.pos = h.peak;
          if (h.t >= h.stay) toSink(h, SINK);
          break;
        case 'sink': {
          h.t += dt;
          const k = Math.min(1, h.t / h.sinkDur);
          h.pos = h.from * (1 - k * k);
          if (k >= 1) toEmpty(h);
          break;
        }
        case 'hit': {
          h.t += dt;
          const k = Math.min(1, h.t / 0.08);
          h.pos = h.hitFrom * (1 - 0.2 * easeOut(k));
          if (h.t >= HIT_HOLD) toSink(h, HIT_SINK);
          break;
        }
        case 'boom':
          h.t += dt; h.pos = 0;
          if (h.t >= BOOM_HOLD) toEmpty(h);
          break;
      }
      h.blinkT -= dt;
      if (h.blinkT < -0.13) h.blinkT = 1.6 + Math.random() * 2.4;
    }

    /* ---------- エフェクト ---------- */
    function addP(p) {
      if (parts.length >= 420) parts.shift();
      p.t = 0; p.rot = p.rot || 0;
      parts.push(p);
    }
    function addText(x, y, str, o) {
      if (texts.length >= 40) texts.shift();
      texts.push({ x: x, y: y, str: str, size: o.size || 64, color: o.color || '#fff', stroke: o.stroke || '#6b3f22', life: o.life || 0.9, vy: o.vy == null ? -90 : o.vy, t: 0 });
    }
    function burstStars(x, y, n, cols, spd, size) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + Math.random() * 0.5;
        const v = spd * (0.6 + Math.random() * 0.6);
        addP({ type: 'star', x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, g: 700, vr: (Math.random() - 0.5) * 10, size: size * (0.7 + Math.random() * 0.5), color: cols[i % cols.length], life: 0.55 + Math.random() * 0.2 });
      }
    }
    function fxHit(h, x, y, gold) {
      const headY = h.y - 150 * h.s * Math.max(0.6, h.pos);
      addP({ type: 'ring', x: x, y: y, r0: 20, r1: gold ? 150 : 100, life: 0.3, color: gold ? '255,226,90' : '255,255,255' });
      if (gold) {
        burstStars(x, y, 14, ['#ffe14d', '#fff3a0', '#ffb514'], 520, 22);
        for (let i = 0; i < 10; i++) addP({ type: 'glint', x: h.x + (Math.random() * 2 - 1) * 150 * h.s, y: headY + (Math.random() * 2 - 1) * 110 * h.s, vx: 0, vy: -30, size: 16 + Math.random() * 14, life: 0.5 + Math.random() * 0.4 });
        // 点数は少し左に出す（はね上げたハンマーは右上にいるので重ならない）
        addText(h.x - 70 * h.s, h.y - 250 * h.s, '+30', { size: 108, color: '#ffe14d', stroke: '#a05a00', life: 1.1, vy: -80 });
      } else {
        burstStars(x, y, 8, ['#ffe14d', '#ffffff', '#ffd0e0'], 380, 18);
        addText(h.x - 70 * h.s, h.y - 230 * h.s, '+10', { size: 74, color: '#ffffff', stroke: '#6b3f22', life: 0.9 });
      }
    }
    function fxBoom(h) {
      const cx = h.x, cy = h.y - 70 * h.s;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU + Math.random() * 0.3;
        const v = 260 + Math.random() * 120;
        addP({ type: 'smoke', x: cx + Math.cos(a) * 30 * h.s, y: cy + Math.sin(a) * 22 * h.s, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.55 - 50, drag: 6, r: (24 + Math.random() * 12) * h.s, grow: 26 * h.s, life: 0.7 + Math.random() * 0.25 });
      }
      addP({ type: 'smoke', x: cx, y: cy, vx: 0, vy: -30, drag: 2, r: 52 * h.s, grow: 30 * h.s, life: 0.75 });
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * TAU;
        addP({ type: 'star', x: cx, y: cy, vx: Math.cos(a) * 300, vy: Math.sin(a) * 200 - 150, g: 600, vr: 6, size: 10, color: '#8a8d9c', life: 0.5 });
      }
      addText(cx - 70 * h.s, h.y - 185 * h.s, 'ボフッ', { size: 62, color: '#5d606e', stroke: '#ffffff', life: 0.8, vy: -40 });
      addText(cx + 40 * h.s, h.y - 285 * h.s, '-20', { size: 88, color: '#ff4d6d', stroke: '#ffffff', life: 1.0, vy: -70 });
    }
    function fxMiss(x, y) {
      for (let i = 0; i < 5; i++) {
        const a = Math.PI + (i / 4) * Math.PI;
        addP({ type: 'dust', x: x, y: y + 6, vx: Math.cos(a) * 120, vy: Math.sin(a) * 60 - 20, drag: 4, r: 9 + Math.random() * 6, life: 0.35, color: '220,235,200' });
      }
    }

    function updFx(dt) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.t += dt;
        if (p.t >= p.life) { parts.splice(i, 1); continue; }
        if (p.drag) { const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy *= d; }
        p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt;
        p.vy += (p.g || 0) * dt;
        p.rot += (p.vr || 0) * dt;
      }
      for (let i = texts.length - 1; i >= 0; i--) {
        const q = texts[i];
        q.t += dt;
        if (q.t >= q.life) { texts.splice(i, 1); continue; }
        q.y += q.vy * dt;
      }
      // 金モグラのキラキラ
      for (let i = 0; i < holes.length; i++) {
        const h = holes[i];
        if (h.kind === 'gold' && h.state !== 'empty' && h.state !== 'boom' && h.pos > 0.45 && Math.random() < dt * 12) {
          addP({ type: 'glint', x: h.x + (Math.random() * 2 - 1) * 115 * h.s, y: h.y + (-100 - (Math.random() * 2 - 1) * 110) * h.s * h.pos, vx: 0, vy: -20, size: 12 + Math.random() * 12, life: 0.45 + Math.random() * 0.3 });
        }
      }
    }

    /* ---------- 判定 ---------- */
    // 見た目より少し広めの当たり判定。重なったら からだの中心に近いほう
    function pick(x, y) {
      let best = null, bd = Infinity;
      for (let i = 0; i < holes.length; i++) {
        const h = holes[i];
        if (!clickable(h)) continue;
        const s = h.s;
        const dx = x - h.x;
        if (h.kind === 'bomb') {
          if (h.pos < BOMB_MIN_POS) continue;
          if (Math.abs(dx) > 108 * s || y < h.y - 182 * s || y > h.y + 48 * s) continue;
        } else {
          const top = h.kind === 'gold' ? 262 : 238;
          if (Math.abs(dx) > 142 * s || y < h.y - top * s || y > h.y + 64 * s) continue;
        }
        const cy = h.y - 88 * s;
        const d = Math.hypot(dx / s, (y - cy) / s);
        if (d < bd) { bd = d; best = h; }
      }
      return best;
    }

    function whack(h, x, y) {
      if (h.kind === 'bomb') {
        h.state = 'boom'; h.t = 0; h.pos = 0; h.wasHit = true;
        score = Math.max(0, score + PTS.bomb);
        counts.bomb++;
        sk.combo = 0;            // ばくだんを叩いたらコンボは切れる
        shakeT = 0.28;
        fxBoom(h);
        api.sfx('bad');
        api.audio.noise({ dur: 0.32, vol: 0.2, f: 700, f2: 150, q: 0.5, filter: 'lowpass' });
      } else {
        h.state = 'hit'; h.t = 0; h.hitFrom = Math.max(0.5, Math.min(1, h.pos)); h.wasHit = true;
        score += PTS[h.kind];
        counts[h.kind]++;
        if (mode === 'play') {
          skResolve(true);
          skReact(clamp(playT - (h.bornT || playT), 0, 9));
          sk.combo++;
          if (sk.combo > sk.maxCombo) sk.maxCombo = sk.combo;
        }
        fxHit(h, x, y, h.kind === 'gold');
        if (h.kind === 'gold') { api.sfx('coin'); api.sfx('sparkle'); }
        else {
          api.sfx('bonk');
          api.audio.tone({ f: 1500, f2: 2200, dur: 0.07, type: 'triangle', vol: 0.09 });
        }
      }
      if (score < 0) { score = 0; stats.negative++; }
      scoreBump = 1;
    }

    function onDown(x, y) {
      swingT = 0;
      swingHit = false;
      stats.clicks++;
      if (mode !== 'play' || finished || playT >= GAME_TIME) {
        if (mode === 'end') stats.clicksAfterEnd++;
        return;
      }
      // ハンマーを振り上げる前のクリックは当たらない（連打対策）。
      // 当たらなかったクリックでは時間を数えなおさないので、連打しても 1秒に約11回までは叩ける。
      if (coolT > 0) {
        stats.tooFast++;
        skClick(false);
        sk.combo = 0;
        counts.miss++;
        fxMiss(x, y);
        return;
      }
      coolT = HAMMER_COOL;
      stats.swings++;   // 実際にハンマーを振った回数（命中率の分母）
      const h = pick(x, y);
      if (h) {
        swingHit = true;
        whack(h, x, y);
        skClick(h.kind !== 'bomb');   // ばくだんを叩いたのは「まちがい」あつかい
        return;
      }
      // 空振り：実力は上がらない。連打するほど空振り率が上がって むずかしくならない
      skClick(false);
      sk.combo = 0;
      counts.miss++;
      fxMiss(x, y);
      if (missSfxT <= 0) { missSfxT = 0.08; api.audio.noise({ dur: 0.07, vol: 0.05, f: 1600, q: 0.9 }); }
    }

    function endGame() {
      if (finished) return;
      finished = true;
      mode = 'end';
      endT = 0;
      holes.forEach(function (h) {
        if (h.state === 'rise' || h.state === 'up') { h.endedByGame = true; toSink(h, 0.25); }
        else if (h.state === 'sink') h.endedByGame = true;
      });
      api.sfx('finish');
      api.setCursor('default');
      // 結果の文言：大きい数字は「○○てん！」だけ。補足には つぎに挑戦したくなる数字を出す
      // （big と sub で同じ数字を重複させない）
      // 命中率は「ハンマーを振った回数」が分母（カウントダウン中のクリックや、
      // 振り上げる前の連打は数えない）
      const hitTotal = counts.mole + counts.gold;
      const acc = stats.swings > 0 ? Math.round(hitTotal * 100 / stats.swings) : 0;
      const lines = [
        'たたいた モグラ <b>' + hitTotal + '</b>ひき（きんいろ <b>' + counts.gold + '</b>ひき）' +
        (counts.bomb ? ' ／ ばくだん <b>' + counts.bomb + '</b>こ' : ''),
        'さいこうコンボ <b>' + sk.maxCombo + '</b>れんぞく ・ めいちゅうりつ <b>' + acc + '</b>%',
      ];
      // 「ハイスコアまで あと○てん」は出さない（遠い数字を見せて がっかりさせないため）
      api.finish({
        score: score,
        ribbon: ribbonFor(score),
        headline: '30びょうで',
        big: score + 'てん！',
        sub: lines.join('<br>'),
        delay: 1500,
      });
    }

    /* ---------- 1 ステップ ---------- */
    function tick(dt) {
      anim += dt;
      swingT += dt;
      speedT += dt;
      if (coolT > 0) coolT = Math.max(0, coolT - dt);
      if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);
      scoreBump = Math.max(0, scoreBump - dt * 4);
      if (missSfxT > 0) missSfxT -= dt;

      if (mode === 'demo') {
        demoT -= dt;
        if (demoT <= 0) { demoSpawn(); demoT = 0.9 + Math.random() * 1.1; }
      } else if (mode === 'count') {
        const before = cd;
        cd += dt;
        for (let k = 1; k <= 2; k++) if (before < k * COUNT_STEP && cd >= k * COUNT_STEP) api.sfx('count');
        if (cd >= COUNT_TIME) { mode = 'play'; playT = 0; spawnT = 0.35; api.sfx('go'); }
      } else if (mode === 'play') {
        playT += dt;
        if (playT >= GAME_TIME) {
          playT = GAME_TIME;
          endGame();
        } else {
          skUpdate(dt);                       // 実力推定 → 難易度（出すまえに更新する）
          const D = difficultyFor(sk.level);
          spawnT -= dt;
          if (spawnT <= 0) {
            if (playT > GAME_TIME - NO_SPAWN_LAST) spawnT = 99;
            else if (activeCount() < sk.maxActive) {
              let n = 0;
              if (spawnGame()) n++;
              // 1回の判定で出す数は SPAWN_PER_TICK まで（フレームあたりの処理量の上限）
              if (n < SPAWN_PER_TICK && D.dbl && rnd() < D.dbl && activeCount() < sk.maxActive) { if (spawnGame()) n++; }
              if (n > stats.maxPerTick) stats.maxPerTick = n;
              spawnT = Math.max(INTERVAL_MIN, D.interval * (0.85 + rnd() * 0.3));
            } else spawnT = 0.08;
          }
          // 難易度の時系列（テストで急変がないか見る）
          logT -= dt;
          if (logT <= 0) {
            logT = 0.25;
            if (stats.levelLog.length < 200) {
              stats.levelLog.push({ t: +playT.toFixed(2), L: +sk.level.toFixed(3), skill: +sk.skill.toFixed(3), hit: +sk.hit.toFixed(3), whiff: +sk.whiff.toFixed(3), iv: +D.interval.toFixed(3), act: sk.maxActive, up: activeCount() });
            }
          }
          const left = Math.ceil(GAME_TIME - playT);
          if (left <= 5 && left !== lastTickSec) { lastTickSec = left; api.sfx('tick'); }
        }
      } else if (mode === 'end') {
        endT += dt;
        // おしまいのあと、手前の穴から にっこり顔をのぞかせる（結果パネルの下に見える）
        for (let i = 6; i < holes.length; i++) {
          const h = holes[i];
          if (!h.celebrate && h.state === 'empty' && endT > 1.4 + (i - 6) * 0.15) {
            h.state = 'rise'; h.kind = 'mole'; h.t = 0; h.pos = 0; h.stay = 1e9; h.peak = 0.5; h.celebrate = true; h.cool = 0;
            h.age = 0; h.wasHit = false; h.endedByGame = false;
          }
        }
      }
      for (let i = 0; i < holes.length; i++) updHole(holes[i], dt);
      if (mode === 'play') stats.maxActive = Math.max(stats.maxActive, activeCount());
      updFx(dt);
    }

    /* ---------- 描画 ---------- */
    function drawHoleTarget(g, h, t) {
      if (h.state === 'empty' || h.state === 'boom' || h.pos <= 0.01) return;
      const s = h.s;
      g.save();
      g.beginPath();
      g.rect(h.x - 215 * s, h.y - 450 * s, 430 * s, 450 * s);
      g.moveTo(h.x + 122 * s, h.y);
      g.ellipse(h.x, h.y, 122 * s, 40 * s, 0, 0, TAU);
      g.clip();
      g.translate(h.x, h.y);
      g.scale(s, s);
      if (h.kind === 'bomb') {
        g.translate(0, 240 - 320 * h.pos);
        g.translate(0, 80); g.rotate(Math.sin(h.age * 13) * 0.045); g.translate(0, -80);
        drawBomb(g, h.age + h.i);
      } else {
        g.translate(0, 215 - 305 * h.pos);
        let sx = 1, sy = 1;
        if (h.state === 'rise') { const k = Math.min(1, h.t / RISE); sy = 1 + 0.07 * Math.sin(k * Math.PI); sx = 1 - 0.05 * Math.sin(k * Math.PI); }
        else if (h.state === 'hit') { const k = Math.min(1, h.t / 0.3); sx = 1 + 0.16 * (1 - k); sy = 1 - 0.14 * (1 - k); }
        g.translate(0, 100); g.scale(sx, sy); g.translate(0, -100);
        let face = 'normal';
        if (h.state === 'hit' || (h.wasHit && h.state === 'sink')) face = 'dizzy';
        else if (h.celebrate) face = 'happy';
        const look = Math.sin(h.age * 1.6 + h.lookSeed);
        drawMole(g, h.kind, face, h.age, look, h.blinkT < 0);
        if (face === 'dizzy') drawDizzyStars(g, h.age);
      }
      g.restore();
    }

    function drawParts(g) {
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const k = p.t / p.life;
        if (p.type === 'star') {
          g.globalAlpha = 1 - k * k;
          starPath(g, p.x, p.y, p.size, p.size * 0.45, 5, p.rot);
          g.fillStyle = p.color; g.fill();
          g.lineWidth = 3; g.strokeStyle = 'rgba(190,120,0,0.8)'; g.stroke();
        } else if (p.type === 'glint') {
          const sc = Math.sin(k * Math.PI);
          g.globalAlpha = 1;
          starPath(g, p.x, p.y, p.size * sc, p.size * sc * 0.22, 4, 0);
          g.fillStyle = '#fffbe0'; g.fill();
          g.lineWidth = 2; g.strokeStyle = 'rgba(255,190,40,0.9)'; g.stroke();
        } else if (p.type === 'smoke') {
          g.globalAlpha = k < 0.6 ? 0.95 : 0.95 * (1 - (k - 0.6) / 0.4);
          const r = p.r + p.grow * easeOut(k);
          g.beginPath(); g.arc(p.x, p.y, r, 0, TAU);
          g.fillStyle = '#e2e4ec'; g.fill();
          g.lineWidth = 5; g.strokeStyle = '#a9adbe'; g.stroke();
        } else if (p.type === 'dust') {
          g.globalAlpha = 0.8 * (1 - k);
          g.beginPath(); g.arc(p.x, p.y, p.r * (1 + k), 0, TAU);
          g.fillStyle = 'rgb(' + p.color + ')'; g.fill();
        } else if (p.type === 'ring') {
          g.globalAlpha = 1 - k;
          g.beginPath(); g.arc(p.x, p.y, lerp(p.r0, p.r1, easeOut(k)), 0, TAU);
          g.lineWidth = 12 * (1 - k) + 1; g.strokeStyle = 'rgb(' + p.color + ')'; g.stroke();
        }
      }
      g.globalAlpha = 1;
      // けむりの上にもう一度ふちを重ねないよう、けむりの中を明るく
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.type !== 'smoke') continue;
        const k = p.t / p.life;
        g.globalAlpha = k < 0.6 ? 0.95 : 0.95 * (1 - (k - 0.6) / 0.4);
        const r = p.r + p.grow * easeOut(k);
        g.beginPath(); g.arc(p.x, p.y, Math.max(1, r - 4), 0, TAU);
        g.fillStyle = '#e2e4ec'; g.fill();
        g.fillStyle = 'rgba(255,255,255,0.75)';
        g.beginPath(); g.arc(p.x - r * 0.3, p.y - r * 0.3, r * 0.3, 0, TAU); g.fill();
      }
      g.globalAlpha = 1;
    }

    function drawTexts(g) {
      for (let i = 0; i < texts.length; i++) {
        const q = texts[i];
        const k = q.t / q.life;
        const sc = q.t < 0.2 ? 0.4 + 0.6 * easeOutBack(q.t / 0.2) : 1;
        g.save();
        g.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
        g.translate(q.x, q.y); g.scale(sc, sc);
        txt(g, q.str, 0, 0, { size: q.size, color: q.color, stroke: q.stroke, strokeWidth: Math.max(8, q.size * 0.16) });
        g.restore();
      }
    }

    function timeLeft() {
      if (mode === 'play') return Math.max(0, GAME_TIME - playT);
      if (mode === 'end') return 0;
      return GAME_TIME;
    }

    function drawHud(g, t) {
      // 得点（左上）
      g.fillStyle = 'rgba(74,154,44,0.95)';
      A.roundRect(g, 24, 30, 420, 150, 40); g.fill();
      g.fillStyle = '#ffffff';
      A.roundRect(g, 24, 20, 420, 150, 40); g.fill();
      g.lineWidth = 5; g.strokeStyle = '#8fd46a'; g.stroke();
      g.save();
      g.beginPath(); g.arc(100, 95, 54, 0, TAU);
      g.fillStyle = '#eaf8df'; g.fill(); g.clip();
      g.translate(100, 140); g.scale(0.5, 0.5);
      drawMole(g, 'mole', 'normal', t, 0, false);
      g.restore();
      txt(g, 'とくてん', 170, 58, { size: 34, color: '#4a9a2c', align: 'left' });
      const bs = 1 + 0.28 * scoreBump;
      g.save();
      g.translate(348, 120); g.scale(bs, bs);
      txt(g, String(score), 0, 0, { size: 86, color: '#3b2f4a', align: 'right' });
      g.restore();
      txt(g, 'てん', 358, 132, { size: 40, color: '#3b2f4a', align: 'left' });
      // しんきろくを こえているときだけ出す。
      // ハイスコアの数字は出さない（上手な人の点数を見て 小さい子が遠慮しないように）
      const rec = best0 != null && score > best0;
      if (rec) {
        g.fillStyle = 'rgba(255,240,170,0.95)';
        A.roundRect(g, 24, 190, 420, 58, 29); g.fill();
        g.lineWidth = 4; g.strokeStyle = '#ffb514'; g.stroke();
        txt(g, 'しんきろく ペース！', 234, 220, { size: 34, color: '#a05a00' });
      }

      // コンボ（3連続から。左のあいているところに出す＝穴やのこり時間に重ならない）
      if (mode === 'play' && sk.combo >= 3) {
        const cb = 1 + 0.12 * scoreBump;
        g.save();
        g.translate(190, 287); g.scale(cb, cb);
        g.fillStyle = 'rgba(255,200,70,0.96)';
        A.roundRect(g, -166, -29, 332, 58, 29); g.fill();
        g.lineWidth = 4; g.strokeStyle = '#e08a00'; g.stroke();
        starPath(g, -128, 0, 17, 7, 5, anim * 2); g.fillStyle = '#fff6d0'; g.fill();
        g.lineWidth = 3; g.strokeStyle = '#c87b00'; g.stroke();
        txt(g, sk.combo + ' れんぞく！', 22, 2, { size: 38, color: '#7a4300' });
        g.restore();
      }
      // むずかしくなった合図（1.4秒だけ）
      if (mode === 'play' && speedT < 1.4 && speedMsg) {
        const k = speedT;
        const ss = k < 0.2 ? 0.5 + 0.5 * easeOutBack(k / 0.2) : 1;
        g.save();
        g.globalAlpha = k > 1.1 ? Math.max(0, (1.4 - k) / 0.3) : 1;
        g.translate(214, 355); g.scale(ss, ss);
        g.fillStyle = 'rgba(255,255,255,0.95)';
        A.roundRect(g, -190, -29, 380, 58, 29); g.fill();
        g.lineWidth = 4; g.strokeStyle = '#ff7f98'; g.stroke();
        txt(g, speedMsg, 0, 2, { size: 38, color: '#e8264a' });
        g.restore();
      }

      // のこり時間（中央上）
      const left = timeLeft();
      const frac = left / GAME_TIME;
      const urgent = mode === 'play' && left <= 5;
      const secs = Math.ceil(left - 1e-9);
      let pulse = 0;
      if (urgent) { const f = left - Math.floor(left); pulse = clamp((f - 0.55) / 0.45, 0, 1); }
      const sc = urgent ? 1.08 + 0.12 * pulse : 1;
      const col = frac > 1 / 3 ? '#5cbf45' : frac > 1 / 6 ? '#ffa62b' : '#ff4d6d';
      g.save();
      g.translate(960, 104); g.scale(sc, sc);
      g.beginPath(); g.arc(0, 8, 86, 0, TAU);
      g.fillStyle = urgent ? 'rgba(220,50,80,0.9)' : 'rgba(74,154,44,0.95)'; g.fill();
      g.beginPath(); g.arc(0, 0, 86, 0, TAU);
      g.fillStyle = urgent ? '#fff1f3' : '#ffffff'; g.fill();
      g.beginPath(); g.arc(0, 0, 68, 0, TAU);
      g.lineWidth = 16; g.strokeStyle = urgent ? '#ffd6dd' : '#e4f2da'; g.stroke();
      if (frac > 0) {
        g.beginPath(); g.arc(0, 0, 68, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
        g.lineCap = 'round'; g.strokeStyle = col; g.stroke();
      }
      txt(g, String(secs), 0, 4, { size: 84, color: urgent ? '#e8264a' : '#3b2f4a' });
      g.restore();
      txt(g, 'のこり', 852, 106, { size: 38, color: urgent ? '#e8264a' : '#2f6a1f', align: 'right', stroke: '#ffffff', strokeWidth: 10 });
      txt(g, 'びょう', 1068, 106, { size: 38, color: urgent ? '#e8264a' : '#2f6a1f', align: 'left', stroke: '#ffffff', strokeWidth: 10 });
    }

    function drawOverlay(g, t) {
      if (mode === 'count') {
        g.fillStyle = 'rgba(255,255,255,0.3)';
        g.fillRect(0, 0, W, H);
        const idx = Math.min(2, Math.floor(cd / COUNT_STEP));
        const k = (cd - idx * COUNT_STEP) / COUNT_STEP;
        const sc = 1 + 0.6 * Math.pow(1 - Math.min(1, k / 0.3), 2);
        const al = k > 0.85 ? Math.max(0, (1 - k) / 0.15) : 1;
        const cols = ['#ff7fa8', '#ffa62b', '#59b8ff'];
        g.save();
        g.globalAlpha = al;
        g.translate(960, 500); g.scale(sc, sc);
        txt(g, String(3 - idx), 0, 0, { size: 320, color: cols[idx], stroke: '#ffffff', strokeWidth: 24, shadow: 'rgba(60,40,80,0.28)', shadowOffset: 12 });
        g.restore();
        g.fillStyle = 'rgba(255,255,255,0.94)';
        A.roundRect(g, 500, 752, 920, 104, 52); g.fill();
        g.lineWidth = 5; g.strokeStyle = '#8fd46a'; g.stroke();
        txt(g, 'モグラを クリックして たたこう！', 960, 805, { size: 54, color: '#3f8a26' });
      } else if (mode === 'play' && playT < 0.8) {
        const k = playT / 0.8;
        const sc = 0.6 + 0.5 * easeOutBack(Math.min(1, k / 0.35));
        g.save();
        g.globalAlpha = k > 0.6 ? (1 - k) / 0.4 : 1;
        g.translate(960, 500); g.scale(sc, sc);
        txt(g, 'スタート！', 0, 0, { size: 200, color: '#ff7fa8', stroke: '#ffffff', strokeWidth: 22, shadow: 'rgba(60,40,80,0.28)', shadowOffset: 10 });
        g.restore();
      }
      if (mode === 'play') {
        const left = GAME_TIME - playT;
        if (left <= 5 && left > 3.7) {
          const k = (5 - left) / 1.3;
          const sc = k < 0.2 ? 0.6 + 0.4 * easeOutBack(k / 0.2) : 1;
          g.save();
          g.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
          g.translate(960, 256); g.scale(sc, sc);
          g.fillStyle = 'rgba(255,255,255,0.92)';
          A.roundRect(g, -250, -44, 500, 88, 44); g.fill();
          g.lineWidth = 5; g.strokeStyle = '#ff7f98'; g.stroke();
          txt(g, 'ラスト 5びょう！', 0, 2, { size: 56, color: '#e8264a' });
          g.restore();
        }
      }
      if (mode === 'end' && endT < 1.7) {
        const k = endT;
        g.fillStyle = 'rgba(255,255,255,' + (0.32 * Math.min(1, k / 0.2)) + ')';
        g.fillRect(0, 0, W, H);
        const sc = 0.5 + 0.5 * easeOutBack(Math.min(1, k / 0.35));
        g.save();
        g.globalAlpha = k > 1.4 ? Math.max(0, (1.7 - k) / 0.3) : 1;
        g.translate(960, 500); g.scale(sc, sc);
        txt(g, 'おしまい！', 0, 0, { size: 210, color: '#ff7fa8', stroke: '#ffffff', strokeWidth: 24, shadow: 'rgba(60,40,80,0.3)', shadowOffset: 12 });
        g.restore();
      }
    }

    function drawCursor(g) {
      if (api.phase !== 'play' || api.paused) return;
      if (mode !== 'count' && mode !== 'play') return;
      const p = api.input.pointer;
      const sw = swingT < 0.05 ? 1 : Math.max(0, 1 - (swingT - 0.05) / 0.16);
      // 当たったときだけ はね上げる（空振りのときは カーソルの位置のまま）
      const k = swingHit ? recoilK(swingT) : 0;
      drawHammer(g, p.x + RECOIL_X * k, p.y + RECOIL_Y * k, sw);
    }

    function draw(g) {
      const t = anim;
      let sx = 0, sy = 0;
      if (shakeT > 0) { const a = 7 * (shakeT / 0.28); sx = Math.sin(t * 90) * a; sy = Math.cos(t * 73) * a * 0.6; }
      g.fillStyle = '#86cff9'; g.fillRect(0, 0, W, H);
      g.save();
      g.translate(sx, sy);
      drawSky(g, t);
      g.drawImage(getGround(g), 0, 0, W, H);
      drawButterflies(g, t);
      for (let i = 0; i < holes.length; i++) {
        drawHoleTarget(g, holes[i], t);
        drawLip(g, holes[i].x, holes[i].y, holes[i].s);
      }
      if (mode === 'demo') drawSidePeek(g, t);
      drawParts(g);
      drawTexts(g);
      g.restore();
      if (mode !== 'demo') drawHud(g, t);
      drawOverlay(g, t);
      drawCursor(g);
    }

    const inst = {
      start: function () {
        mode = 'count'; cd = 0; playT = 0; endT = 0; score = 0; finished = false;
        holes.forEach(function (h) { h.state = 'empty'; h.pos = 0; h.cool = 0; h.t = 0; });
        parts.length = 0; texts.length = 0;
        lastTickSec = 99; lastGoldT = 0; lastKind = ''; lastHole = lastHole2 = -1;
        goldDue = GOLD_FIRST; goldN = 0;
        logT = 0; speedT = 9; speedMsg = ''; speedStep = 0; swingHit = false; coolT = 0; swingT = 9;
        skReset();
        api.setCursor('none');
        api.sfx('count');
      },
      update: function (dt) { if (!hold) tick(dt); },
      draw: draw,
      onPointerDown: function (x, y) { onDown(x, y); },
      destroy: function () { api.setCursor('default'); },
      // ---- 自動テスト用（ゲームの動きには影響しない） ----
      _test: {
        get mode() { return mode; },
        get score() { return score; },
        get playT() { return playT; },
        get cd() { return cd; },
        get counts() { return counts; },
        get stats() { return stats; },
        get finished() { return finished; },
        hold: function (v) { hold = !!v; },
        step: function (n) { for (let i = 0; i < (n || 1); i++) tick(STEP); },
        holes: function () { return holes.map(function (h) { return { i: h.i, state: h.state, kind: h.kind, pos: +h.pos.toFixed(3), id: h.id, cool: +h.cool.toFixed(3), x: h.x, y: h.y, s: h.s }; }); },
        // 穴 i に強制で出す（state を空にしてから）
        force: function (i, kind, stay) {
          const h = holes[i];
          h.state = 'empty'; h.cool = 0;
          spawnAt(h, kind || 'mole', stay || 5);
        },
        clearAll: function () { holes.forEach(function (h) { h.state = 'empty'; h.cool = 0; h.pos = 0; }); },
        // 叩くべき位置（仮想座標）。モグラの顔あたり
        aim: function (i) { const h = holes[i]; return { x: h.x, y: h.y - 100 * h.s }; },
        setScore: function (v) { score = v; },
        setPlayT: function (v) { playT = v; },
        // テスト用：実力推定を強制する（いちばん忙しい状態の負荷を見るため）
        setSkill: function (v) { sk.skill = clamp(v, 0, 1); sk.hit = v; sk.rt = v; sk.whiff = 1 - v; },
        click: function (x, y) { onDown(x, y); },
        difficulty: difficultyFor,
        // 実力推定のいまの値（テスト・調整用）
        get sk() {
          return {
            hit: +sk.hit.toFixed(4), rt: +sk.rt.toFixed(4), whiff: +sk.whiff.toFixed(4),
            combo: sk.combo, maxCombo: sk.maxCombo, raw: +sk.raw.toFixed(4), skill: +sk.skill.toFixed(4),
            level: +sk.level.toFixed(4), maxActive: sk.maxActive, hits: sk.hits, escapes: sk.escapes,
            avgRt: sk.rtN ? +(sk.rtSum / sk.rtN).toFixed(3) : null,
          };
        },
        get D() { return difficultyFor(sk.level); },
        consts: {
          GAME_TIME: GAME_TIME, COUNT_TIME: COUNT_TIME, RISE: RISE, SINK: SINK, STAY_MIN: STAY_MIN, COOL_MIN: COOL_MIN,
          MAX_ACTIVE_CAP: MAX_ACTIVE_CAP, INTERVAL_MIN: INTERVAL_MIN, SPAWN_PER_TICK: SPAWN_PER_TICK,
          BOMB_MAX_ACTIVE: BOMB_MAX_ACTIVE, GOLD_MAX_ACTIVE: GOLD_MAX_ACTIVE,
          GOLD_FIRST: GOLD_FIRST, GOLD_EVERY: GOLD_EVERY, GOLD_JITTER: GOLD_JITTER, SK: SK,
        },
        parts: function () { return parts.length; },
      },
    };
    return inst;
  }
})();
