/* =========================================================
   ① ドタバタホッケー（2人対戦 / CPU対戦）
   - 1P（左・あお）: W / S     2P（右・ピンク）: ↑ / ↓
   - 5点先取。5分たったらリードしている方の勝ち。同点なら「えんちょう」（つぎの1点で勝ち）
   - 左右の辺ぜんぶがゴール（四隅にひっかかる形はない）
   物理:
   - パックの移動は 1 回あたり最大 5px に分割（サブステップ）し、パドルもその間を補間して判定する
     → 高速でもすり抜けない（連続的な当たり判定）
   - パドルはカプセル形（丸い端）。パドルに「向かっている」ときだけ反射する
   - 加速は「前と違うパドルに当たったとき」だけ（同じパドルとの連続接触では加速しない）
   ========================================================= */
(function () {
  'use strict';

  const W = 1920, H = 1080, STEP = 1 / 120;
  const TAU = Math.PI * 2, DEG = Math.PI / 180;

  /* ---------- フィールド ---------- */
  const FX0 = 170, FX1 = 1750, FY0 = 250, FY1 = 1040;
  const CX = (FX0 + FX1) / 2, CY = (FY0 + FY1) / 2;
  const NET = 96;                         // ゴールネットの奥行き

  /* ---------- パック・パドル ---------- */
  const PR = 26;                          // パック半径
  const PAD_R = 40, PAD_L = 62;           // カプセル: 半径 / 直線部分の半分
  const PAD_HALF = PAD_R + PAD_L;         // パドルの半分の高さ (102)
  const HIT_D = PAD_R + PR;               // 中心線からの接触距離
  const PAD_X = [FX0 + 100, FX1 - 100];
  const PAD_MIN_Y = FY0 + PAD_HALF, PAD_MAX_Y = FY1 - PAD_HALF;
  const PAD_SPEED = 1000, PAD_ACC = 14000;

  /* ---------- スピード・角度 ---------- */
  const SERVE_SPEED = 600, HIT_ACCEL = 1.045, MAX_SPEED = 1500, DEMO_SPEED = 640;
  const EDGE_ANGLE = 47 * DEG;            // パドルの端に当てたときの角度
  const MOVE_ANGLE = 10 * DEG;            // パドルを動かしながら打ったときの追加角度
  const MAX_ANGLE = 55 * DEG;             // 反射角の上限
  const MIN_VX = 0.5;                     // 横方向の速さの下限（速さに対する比）
  const SUB_MAX = 5;                      // 1サブステップの最大移動量(px)
  const OT_RAMP = 60, OT_MAX = 3000;      // えんちょう中だけ、上限速度が 1秒ごとに +60 ずつ上がる（決着がつくように）

  /* ---------- しあい ---------- */
  const WIN_SCORE = 5, MATCH_TIME = 300;   // R4：2分 → 5分（本人の依頼 2026-11-14：うでが近い人どうしで 時間ぎれが 多かった）
  const COUNT_STEP = 0.5, COUNT_TIME = 1.5, GOAL_TIME = 1.8, OT_TIME = 2.4;
  const TELL_LEAD = 0.6;                  // 特殊パックの予告を先に見せる時間（カウントを そのぶん長くする）

  /* ---------- スペシャルモードの パック ---------- */
  // normal 以外は スペシャルモード（2p-special）でだけ出る。
  // 物理のちがいは w.mod（ノーマルでは null）だけを通すので、ノーマルの動きは 1ミリも変わらない。
  const MAX_CURVE = 58 * DEG;             // 曲がりの上限（cos58°=0.53 > MIN_VX=0.5 なので「急すぎ」にならない）
  const PUCK = {
    normal: { name: 'ノーマル', pts: 1, serve: SERVE_SPEED, accel: HIT_ACCEL, cap: MAX_SPEED },
    gold: {
      name: 'ゴールドパック', pts: 2, serve: 560, accel: HIT_ACCEL, cap: MAX_SPEED,
      tell: '2てん チャンス！', col: '#ffc62e', col2: '#ff9000',
    },
    fast: {
      name: 'ビュンパック', pts: 1, serve: 880, accel: 1.055, cap: MAX_SPEED,
      tell: 'はやいよ！ よく見て！', col: '#2fd3e8', col2: '#0a8fb0',
    },
    curve: {
      name: 'ふしぎパック', pts: 1, serve: 620, accel: HIT_ACCEL, cap: MAX_SPEED,
      tell: 'まがる！ うつたびに 向きが かわる', col: '#b06bff', col2: '#6d2fc4',
      curve: 0.62, wallKick: 1.3, flip: true,
    },
    slow: {
      name: 'ふわふわパック', pts: 1, serve: 380, accel: 1.11, cap: 1180,
      tell: 'ゆっくり…でも だんだん はやくなる', col: '#5fd98f', col2: '#1f9c5c',
      wave: 1.0, waveF: 2.4, wallKick: 0.55, edge: 1.2,
    },
  };
  const SPECIAL_P = 0.58;                 // 1点入ったあと、サーブが特殊パックになる確率
  const GOLD_MAX = 2;                     // ゴールドパックは 1試合 2回まで
  const NORMAL_RUN_MAX = 2;               // ふつうのパックが つづけて出るのは 2回まで（3回めは かならず特殊）
  const SPECIAL_W = { fast: 24, curve: 24, slow: 18, gold: 44 };

  /* ---------- CPU など（テスト用の自動操作もここ） ---------- */
  // 難易度 1〜4。速さだけでなく「反応・予測・かべを読む回数・ねらいのズレ・守備位置・復帰の遅さ」で作り分ける。
  //   react     考えなおす間隔（反応の遅れ・秒）
  //   speed     パドルの上限速度（人間と同じ 1000 が最大。movePad を通すので瞬間移動はしない）
  //   predict   軌道予測を使うか / reach  どの距離から予測に切りかえるか
  //   bounce    かべの はね返りを何回まで読むか（0 = 読まない）
  //   err/errSpeed  打点のズレ(px) / 速い球で増えるぶん（当たりはするが 返す角度が ずれる）
  //   missBase/missSteep/missBounce/missFat  「読みちがえて 空ぶる」確率（基本／急角度／かべを読みきれない／ゆさぶられた）
  //   fatAt/fatSpan  ゆさぶりと みなす 着地点のズレ(px)。大きいほど「よほど ふられたとき」しか 効かない
  //   steepRamp/fatLo/bounceRamp  弱点を「じわっと効く」形にする（きつい角度・強いゆさぶり・多いはね返り ほど 効く。0なら ON/OFF）
  //   aimOff    せめの ねらい（あいてのいない側へ返すための 打点のずらし量 px。0=せめない）
  //   home      守備位置の判断（球が相手側にあるとき CY + (puckY-CY)*home で待つ）。
  //             小さい＝いつも中央で待つ（返球は だいたい 同じ高さに もどってくるので、実は 動きのムダが多い）
  //             大きい＝球の高さに ついていって 待つ（上手な人の守りかた）
  //   recover/recoverSp  打ち返した直後の復帰の遅さ
  //   whiff     [確率, ズレ倍率] まれに大きく読みちがえる
  //   steepAt/steepErr/steepReact  急角度の球に弱い（しきい値・ズレ倍率・遅れる秒数）
  //   bounceErr 読めるかべ回数を超えたときに増えるズレ
  //   fatigue   ゆさぶられたときに弱くなる度合い(0〜1)
  const AI_LV = {
    1: { speed: 385, react: [0.36, 0.56], err: 52, errSpeed: 36, predict: 0, bounce: 0, reach: 0, aimOff: 0, home: 0.25,
         recover: 0.20, recoverSp: 0.55, hand: true, steepAt: 0.62, steepErr: 1.0, steepReact: 0, fatigue: 0,
         missBase: 0.26, missSteep: 0.12, missBounce: 0.20, missFat: 0 },
    2: { speed: 780, react: [0.20, 0.30], err: 38, errSpeed: 30, predict: 1, bounce: 0, reach: 700, aimOff: 20, home: 0.45,
         recover: 0.17, recoverSp: 0.62, hand: true, steepAt: 0.62, steepErr: 1.4, steepReact: 0.04, fatigue: 0.30,
         missBase: 0.095, missSteep: 0.09, missBounce: 0.17, missFat: 0.08 },
    3: { speed: 900, react: [0.13, 0.19], err: 28, errSpeed: 24, predict: 1, bounce: 1, reach: 2000, aimOff: 50, home: 0.65,
         recover: 0.14, recoverSp: 0.72, hand: false, steepAt: 0.70, steepErr: 2.0, steepReact: 0.06, fatigue: 0.50,
         missBase: 0.030, missSteep: 0.10, missBounce: 0.13, missFat: 0.13 },
    // R4（2026-11-14 本人の依頼「プロを もうちょっと強く」）：弱点（急角度・ゆさぶり・かべ）の効きを 半分くらいに。
    //   5分試合で測った勝率（R3 → R4）：十分なれた人+弱点ねらい 19% → 11%／ゲーム好きの大人+弱点ねらい 34% → 14%
    //   もっと強くするなら missSteep 0.50, missFat 0.012, fatigue 0.52, steepErr 1.65, steepReact 0.05, recover 0.11, recoverSp 0.60, missBounce 0.05（同 4% / 5%）
    4: { speed: 1000, react: [0.022, 0.038], err: 8, errSpeed: 7, predict: 1, bounce: 1, reach: 4000, aimOff: 102, home: 0.96,
         recover: 0.12, recoverSp: 0.55, hand: false, steepAt: 0.82, steepRamp: 0.52, steepErr: 1.8, steepReact: 0.06,
         fatigue: 0.60, fatAt: 300, fatSpan: 300, fatLo: 0.45,
         missBase: 0.0002, missSteep: 0.60, missBounce: 0.06, bounceRamp: 3, missFat: 0.015 },
  };
  const REACH_SAFE = 105;                 // 打点のズレが これ以内なら かならず当たる（当たる範囲は中心から ±128px）
  const CPU_NAME = ['しょきゅう', 'ちゅうきゅう', 'じょうきゅう', 'プロ'];
  const AI_CFG = {
    // 旧 R1 の CPU（いまは cpu-2 相当のフォールバック）と、テスト用の自動操作
    cpu: { speed: 660, react: [0.25, 0.35], err: 48, errSpeed: 45, reach: 0, naive: true },
    // ↓テスト用（人の代わり）。kid = 壁のはね返りを読まず、今の高さを遅れて追う
    kid: { speed: 1000, react: [0.25, 0.40], err: 40, errSpeed: 30, reach: 0, naive: true },
    // hum = 人間らしいボット（かべのはね返りは読む。react/err をテストから上書きして使う）
    hum: { speed: 1000, react: [0.25, 0.25], err: 40, errSpeed: 30, reach: 3000 },
    pro: { speed: 1000, react: [0.08, 0.14], err: 80, errSpeed: 60, reach: 3000 },
    perfect: { speed: 1000, react: [0, 0], err: 0, errSpeed: 0, reach: 3000 },
    demo: { speed: 900, react: [0.04, 0.08], err: 50, errSpeed: 0, reach: 3000 },
    // exploit = プロの弱点（急角度・ゆさぶり・かべ2回）をわざと突くボット
    exploit: { speed: 1000, react: [0.05, 0.08], edge: 88 },
  };

  /* ---------- 色 ---------- */
  const INK = '#3b2f4a';
  const TEAM = [
    { name: 'あお', top: '#93daff', bot: '#3f97f0', line: '#2470c4', main: '#4aa8ff', light: '#d6edff', net: ['#2d66b0', '#6db4f5'], tint: '74,168,255' },
    { name: 'ピンク', top: '#ffbfda', bot: '#f2639d', line: '#c93f78', main: '#ff6fa6', light: '#ffe0ec', net: ['#c03e76', '#f58db6'], tint: '255,111,166' },
  ];
  const CONFETTI_COLS = ['#ff6fa6', '#4aa8ff', '#ffd23f', '#7ed957', '#b48cff', '#ff9a2e'];

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOutBack(t) { t = clamp(t, 0, 1); const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  function RR(g, x, y, w, h, r) { Arcade.roundRect(g, x, y, w, h, r); }
  function TX(g, s, x, y, o) { Arcade.text(g, s, x, y, o); }
  function ell(g, x, y, rx, ry, rot) { g.beginPath(); g.ellipse(x, y, rx, ry, rot || 0, 0, TAU); }
  function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, TAU); }

  /* =========================================================
     物理
     ========================================================= */
  function newPad(k) { return { k: k, x: PAD_X[k], y: CY, prevY: CY, cy: CY, vy: 0 }; }
  function newWorld() {
    return {
      pads: [newPad(0), newPad(1)],
      puck: { x: CX, y: CY, vx: 0, vy: 0, sp: SERVE_SPEED, live: false, inNet: false, type: 'normal' },
      lastHit: -1, accel: HIT_ACCEL, maxSp: MAX_SPEED, typeCap: MAX_SPEED, hitCount: 0, serveCount: 0, pins: 0,
      mod: null,   // 特殊パックの物理（ノーマルは null＝まったく通らない）
    };
  }

  // 速さを変えずに、進む角度だけを変える（上限 ±58°。速度の上限・最低の横成分を壊さない）
  function setAngle(pk, ang) {
    const sp = Math.hypot(pk.vx, pk.vy);
    if (sp < 1) return;
    const dir = pk.vx < 0 ? -1 : 1;
    const a = clamp(ang, -MAX_CURVE, MAX_CURVE);
    pk.vx = dir * Math.cos(a) * sp;
    pk.vy = Math.sin(a) * sp;
  }
  function puckAngle(pk) { return Math.atan2(pk.vy, Math.abs(pk.vx)); }

  // パドル中心線（カプセルの芯）からの距離
  function segDist(pk, p, cy) {
    const yy = cy === undefined ? p.y : cy;
    const qy = clamp(pk.y, yy - PAD_L, yy + PAD_L);
    return Math.hypot(pk.x - p.x, pk.y - qy);
  }

  // パドルを動かす（dir: -1〜1, sp: 最高速度）
  function movePad(p, dir, sp, dt) {
    p.prevY = p.y;
    const dv = dir * sp - p.vy, a = PAD_ACC * dt;
    p.vy += clamp(dv, -a, a);
    p.y += p.vy * dt;
    if (p.y < PAD_MIN_Y) { p.y = PAD_MIN_Y; if (p.vy < 0) p.vy = 0; }
    if (p.y > PAD_MAX_Y) { p.y = PAD_MAX_Y; if (p.vy > 0) p.vy = 0; }
    p.cy = p.y;
  }

  function wallCollide(w, cb) {
    const pk = w.puck;
    if (pk.y < FY0 + PR) {
      pk.y = FY0 + PR;
      if (pk.vy < 0) { pk.vy = -pk.vy; wallMod(w); if (cb && cb.wall) cb.wall(pk.x, FY0); }
    } else if (pk.y > FY1 - PR) {
      pk.y = FY1 - PR;
      if (pk.vy > 0) { pk.vy = -pk.vy; wallMod(w); if (cb && cb.wall) cb.wall(pk.x, FY1); }
    }
  }
  // 特殊パックだけ: かべの はね返りかたを変える（ふしぎ=するどく / ふわふわ=あさく）
  function wallMod(w) {
    const m = w.mod;
    if (!m || !m.wallKick || m.wallKick === 1) return;
    setAngle(w.puck, puckAngle(w.puck) * m.wallKick);
  }

  function padCollide(w, k, cb) {
    const p = w.pads[k], pk = w.puck;
    const qy = clamp(pk.y, p.cy - PAD_L, p.cy + PAD_L);
    const dx = pk.x - p.x, dy = pk.y - qy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= HIT_D * HIT_D) return false;
    const d = Math.sqrt(d2);
    let nx, ny;
    if (d < 1e-6) { nx = k === 0 ? 1 : -1; ny = 0; } else { nx = dx / d; ny = dy / d; }
    // めり込みを戻す
    pk.x = p.x + nx * HIT_D;
    pk.y = qy + ny * HIT_D;
    // 壁とパドルにはさまれたら、パックは壁ぞいに置き、パドルのほうを止める
    if (pk.y < FY0 + PR || pk.y > FY1 - PR) {
      pk.y = clamp(pk.y, FY0 + PR, FY1 - PR);
      const ex = pk.x - p.x;
      const q2 = clamp(pk.y, p.cy - PAD_L, p.cy + PAD_L);
      if (ex * ex + (pk.y - q2) * (pk.y - q2) < HIT_D * HIT_D) {
        const off = Math.sqrt(Math.max(0, HIT_D * HIT_D - ex * ex)) + 0.05;
        const need = pk.y < p.cy ? pk.y + PAD_L + off : pk.y - PAD_L - off;
        p.cy = clamp(need, PAD_MIN_Y, PAD_MAX_Y);
        p.y = p.prevY = p.cy;
        p.vy = 0;
        w.pins++;
      }
    }
    // 速度: パドルに向かっているときだけ反射する
    const pvy = p.vy;
    const rvx = pk.vx, rvy = pk.vy - pvy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return true;
    const away = k === 0 ? 1 : -1;
    const front = k === 0 ? pk.x > p.x : pk.x < p.x;
    w.hitCount++;
    if (front) {
      // 当たった位置で角度が変わる（端ほど角度がつく）
      const off = clamp((pk.y - p.cy) / PAD_HALF, -1, 1);
      const edge = w.mod && w.mod.edge ? w.mod.edge : 1;
      let ang = off * EDGE_ANGLE * edge + clamp(pvy / PAD_SPEED, -1, 1) * MOVE_ANGLE;
      ang = clamp(ang, -MAX_ANGLE, MAX_ANGLE);
      const fresh = w.lastHit !== k;
      let sp = pk.sp;
      if (fresh) sp = Math.min(w.maxSp, sp * w.accel);
      sp = Math.min(sp, w.maxSp);
      pk.sp = sp;
      pk.vx = away * Math.cos(ang) * sp;
      pk.vy = Math.sin(ang) * sp;
      // ふしぎパックは「打つたびに まがる向きが 反転する」（見て おぼえられる きまり）
      if (w.mod && w.mod.flip && fresh) w.mod.cdir = -w.mod.cdir;
      w.lastHit = k;
      if (cb && cb.hit) cb.hit(k, fresh, pk.x - away * PR, pk.y);
    } else {
      // うしろ側（もうパドルを通りすぎた）: ふつうの反射。加速しない
      const sp = Math.min(pk.sp, w.maxSp);
      let vx = rvx - 2 * vn * nx, vy = rvy - 2 * vn * ny + pvy;
      const m = Math.hypot(vx, vy) || 1;
      vx = vx / m * sp; vy = vy / m * sp;
      if (Math.abs(vx) < MIN_VX * sp) {
        const sx = vx < 0 ? -1 : (vx > 0 ? 1 : -away);
        vx = sx * MIN_VX * sp;
        vy = (vy < 0 ? -1 : 1) * Math.sqrt(sp * sp - vx * vx);
      }
      pk.vx = vx; pk.vy = vy;
      w.lastHit = k;
      if (cb && cb.bump) cb.bump(k, pk.x, pk.y);
    }
    return true;
  }

  // 特殊パックの「曲がり」。1サブステップぶん、速さは変えずに角度だけ回す
  function curveStep(w, h) {
    const m = w.mod;
    if (!m) return;
    m.t += h;
    let rate = 0;
    if (m.curve) rate = m.curve * m.cdir;                        // ふしぎ: 一定の向きに まがる
    if (m.wave) rate += m.wave * Math.sin(m.t * m.waveF);        // ふわふわ: ゆらゆら
    if (rate) setAngle(w.puck, puckAngle(w.puck) + rate * h);
  }

  // パックを dt 秒すすめる。ゴールしたら得点した側(0/1)を返す。なければ -1
  function stepPuck(w, dt, cb) {
    const pk = w.puck, pads = w.pads;
    const dist = Math.hypot(pk.vx, pk.vy) * dt;
    const n = Math.max(1, Math.ceil(dist / SUB_MAX));
    const h = dt / n;
    let scorer = -1;
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      pads[0].cy = pads[0].prevY + (pads[0].y - pads[0].prevY) * f;
      pads[1].cy = pads[1].prevY + (pads[1].y - pads[1].prevY) * f;
      curveStep(w, h);
      pk.x += pk.vx * h;
      pk.y += pk.vy * h;
      wallCollide(w, cb);
      padCollide(w, 0, cb);
      padCollide(w, 1, cb);
      if (pk.x < FX0 - PR) { scorer = 1; break; }
      if (pk.x > FX1 + PR) { scorer = 0; break; }
    }
    pads[0].cy = pads[0].y;
    pads[1].cy = pads[1].y;
    return scorer;
  }

  // パックが x=tx に着くときの y（上下の壁の反射こみ）
  function predictY(pk, tx) {
    if (Math.abs(pk.vx) < 1) return pk.y;
    const t = (tx - pk.x) / pk.vx;
    if (t < 0) return pk.y;
    const lo = FY0 + PR, hi = FY1 - PR, span = hi - lo;
    let u = (pk.y + pk.vy * t - lo) % (2 * span);
    if (u < 0) u += 2 * span;
    return lo + (u > span ? 2 * span - u : u);
  }

  // x=tx に着くまでに かべで はね返る回数
  function bounceCount(pk, tx) {
    if (Math.abs(pk.vx) < 1 || Math.abs(pk.vy) < 1) return 0;
    const t = (tx - pk.x) / pk.vx;
    if (t < 0) return 0;
    const lo = FY0 + PR, hi = FY1 - PR, span = hi - lo;
    const d = Math.abs(pk.y + pk.vy * t - (pk.vy < 0 ? lo : hi));
    return Math.min(9, Math.ceil(Math.max(0, d) / span));
  }

  // 同じ予測だが、かべの はね返りは bmax 回までしか読まない（弱い CPU の「読みちがえ」を作る）
  function predictYn(pk, tx, bmax) {
    if (Math.abs(pk.vx) < 1) return pk.y;
    let rem = (tx - pk.x) / pk.vx;
    if (rem < 0) return pk.y;
    const lo = FY0 + PR, hi = FY1 - PR;
    let y = pk.y, vy = pk.vy, b = 0;
    for (let i = 0; i < 12; i++) {
      if (Math.abs(vy) < 1) return clamp(y, lo, hi);
      const tw = vy < 0 ? (lo - y) / vy : (hi - y) / vy;
      if (tw >= rem || tw < 0) return clamp(y + vy * rem, lo, hi);
      if (b >= bmax) return clamp(y + vy * rem, lo, hi);   // ここから先は読まない（まっすぐ行くと思いこむ）
      y = vy < 0 ? lo : hi;
      rem -= tw;
      vy = -vy;
      b++;
    }
    return clamp(y, lo, hi);
  }

  /* =========================================================
     CPU（と テスト用の自動操作）
     ========================================================= */
  // lv を付けると難易度つき CPU（AI_LV）になる。over でテストから設定を上書きできる
  function makeAI(kind, k, rand, lv, over) {
    const ai = {
      kind: kind, k: k, rand: rand, lv: lv || 0, t: 0, target: CY, err: 0, key: -1, rdir: 0,
      rec: 0, fat: 0, hc: -1, side: 1, lastAim: null, whiff: false, risky: false, miss: 0, shots: 0,
      sSteep: 0, sFat: 0, nSteep: 0, nBounce: 0, cfg: null, out: { dir: 0, sp: PAD_SPEED },
    };
    if (lv) ai.cfg = Object.assign({}, AI_LV[lv] || AI_LV[2]);
    else if (AI_CFG[kind]) ai.cfg = Object.assign({}, AI_CFG[kind]);
    if (over) ai.cfg = Object.assign(ai.cfg || {}, over);
    return ai;
  }

  // せめの ねらい: あいてのパドルが いない側へ 返すために、わざと パドルの中心から ずらして打つ。
  // ずらす量が aimOff（0 = せめない）。打点が中心から ずれるほど 返球の角度が つく。
  function aimAt(ai, w, arriveY, cfg) {
    if (ai.whiff) return arriveY + ai.err;                   // 空ぶり（わざと とどかない所をねらってしまう）
    let off = 0;
    if (cfg.edge && !ai.risky) {
      off = ai.side * cfg.edge;                              // パドルの はしで 打って 急角度にする（上下こうご）
    } else if (cfg.aimOff) {
      const opp = w.pads[1 - ai.k];
      off = (opp.y < CY ? 1 : -1) * cfg.aimOff;              // あいてが 上にいるなら 下へ 返す
    }
    // せめの ずらし と 打点のズレを 合わせても、ちゃんと 当たる範囲に おさめる
    return clamp(arriveY + clamp(off + ai.err, -REACH_SAFE, REACH_SAFE), PAD_MIN_Y - PAD_HALF, PAD_MAX_Y + PAD_HALF);
  }

  // lead = 自分の点 - あいての点
  function aiControl(ai, w, dt, lead) {
    const out = ai.out;
    const p = w.pads[ai.k], pk = w.puck;
    out.sp = PAD_SPEED;
    if (ai.kind === 'still') { out.dir = 0; return out; }
    if (ai.kind === 'random') {
      ai.t -= dt;
      if (ai.t <= 0) { ai.t = 0.05 + ai.rand() * 0.45; ai.rdir = Math.floor(ai.rand() * 3) - 1; }
      out.dir = ai.rdir;
      return out;
    }
    const cfg = ai.cfg || AI_CFG[ai.kind] || AI_CFG.cpu;
    const away = ai.k === 0 ? 1 : -1;
    const faceX = p.x + away * HIT_D;
    const toward = pk.live && (ai.k === 0 ? pk.vx < 0 : pk.vx > 0);
    const key = w.serveCount * 100000 + w.hitCount;

    /* --- 打ち返した直後は しばらく 復帰が遅い --- */
    if (ai.rec > 0) ai.rec -= dt;
    if (w.hitCount !== ai.hc) { if (w.lastHit === ai.k && cfg.recover) ai.rec = cfg.recover; ai.hc = w.hitCount; }

    /* --- 1回の打ち返しごとに「ねらいのズレ」「ゆさぶられ具合」を決める --- */
    if (toward && key !== ai.key) {
      ai.key = key;
      if (cfg.edge) ai.side = -ai.side;                      // 上下こうごに ゆさぶる
      if (ai.kind === 'exploit') {
        /* 幾何だけで動く さぐり用ボット（ズレも空ぶりもない） */
      } else if (cfg.react) {
        const spF = clamp((pk.sp - SERVE_SPEED) / (MAX_SPEED - SERVE_SPEED), 0, 1);
        let amp = cfg.err + (cfg.errSpeed || 0) * spF;
        ai.whiff = false;
        if (ai.lv) {
          // 【穴3】ゆさぶり: 前の球と 今の球の 着地点が はなれているほど 苦しくなる（続けて振られると たまる）
          const aim = predictYn(pk, faceX, 9);
          const swing = ai.lastAim == null ? 0 : Math.abs(aim - ai.lastAim);
          ai.lastAim = aim;
          // fatAt/fatSpan を 大きくすると「よほど 大きく ふられたとき」しか 弱点が出なくなる
          ai.fat = clamp(ai.fat * 0.5 + clamp((swing - (cfg.fatAt || 240)) / (cfg.fatSpan || 340), 0, 1), 0, 1);
          // 「読みちがえて 空ぶる」確率を 球のむずかしさから 決める
          let mp = cfg.missBase || 0;
          const steep = Math.abs(pk.vy) / Math.max(1, Math.abs(pk.vx));
          // はしねらいボット: 自分が ゆさぶられて くるしいときは むりせず ふつうに返す
          ai.risky = ai.fat > 0.7;
          // 【穴1】急角度の球に弱い。steepRamp があると「角度が きついほど じわっと効く」になり、
          //        ふつうの返球（ゆるい角度）では ほとんど効かず、パドルの はしで打った球にだけ 強く効く
          const sr = cfg.steepRamp
            ? clamp((steep - (cfg.steepAt || 0.62)) / cfg.steepRamp, 0, 1)
            : (steep > (cfg.steepAt || 0.62) ? 1 : 0);
          if (sr > 0) {
            amp *= 1 + ((cfg.steepErr || 1) - 1) * sr;
            mp += (cfg.missSteep || 0) * sr;
            if (cfg.steepReact) ai.t = Math.max(ai.t, cfg.steepReact * sr);
          }
          // 【穴2】読めるかべの回数を こえた球。bounceRamp があると「こえた回数が 多いほど 強く効く」
          const nb = bounceCount(pk, faceX) - cfg.bounce;
          const br = nb <= 0 ? 0 : (cfg.bounceRamp ? clamp(nb / cfg.bounceRamp, 0, 1) : 1);
          mp += (cfg.missBounce || 0) * br;
          // 【穴3】fatLo があると「よほど ゆさぶられたとき」だけ 効く
          const fr = cfg.fatLo ? clamp((ai.fat - cfg.fatLo) / (1 - cfg.fatLo), 0, 1) : ai.fat;
          mp += (cfg.missFat || 0) * fr;
          amp += 40 * (cfg.fatigue || 0) * ai.fat;
          // 調整用の記録（どの弱点が どれくらい 効いているか）
          ai.sSteep += steep; ai.sFat += ai.fat; ai.nSteep += sr; ai.nBounce += br;
          if (ai.rand() < mp) {
            ai.whiff = true;
            ai.err = (ai.rand() < 0.5 ? -1 : 1) * (150 + ai.rand() * 110);      // とどかない所をねらってしまう
            ai.miss++;
          }
          ai.shots++;
        }
        if (!ai.whiff) ai.err = (ai.rand() * 2 - 1) * Math.max(0, amp);
      }
    }

    /* --- 反応の遅れ（この間隔でしか ねらう場所を考えなおさない） --- */
    ai.t -= dt;
    if (ai.t <= 0) {
      ai.t = cfg.react[0] + ai.rand() * (cfg.react[1] - cfg.react[0]);
      if (ai.kind === 'exploit') {
        // プロの弱点ねらい: 予測した着地点から わざと ずらして パドルの「はし」で打つ → 急角度の返球
        if (!pk.live) ai.target = CY;
        else if (toward) ai.target = clamp(predictYn(pk, faceX, 4) - ai.side * cfg.edge, PAD_MIN_Y, PAD_MAX_Y);
        else ai.target = lerp(ai.target, CY, 0.4);
      } else if (!pk.live) {
        ai.target = CY + (pk.y - CY) * 0.3;
      } else if (toward) {
        if (ai.lv) {
          if (cfg.predict && Math.abs(pk.x - faceX) < cfg.reach) ai.target = aimAt(ai, w, predictYn(pk, faceX, cfg.bounce), cfg);
          else ai.target = pk.y + (ai.whiff ? ai.err : clamp(ai.err, -REACH_SAFE, REACH_SAFE));   // 予測せず「いまの高さ」を追う
        } else if (cfg.naive) ai.target = pk.y + ai.err;   // 旧 R1 のテスト用ボット
        else if (Math.abs(pk.x - faceX) < cfg.reach) ai.target = aimAt(ai, w, predictYn(pk, faceX, cfg.bounce == null ? 9 : cfg.bounce), cfg);
        else ai.target = lerp(ai.target, pk.y, 0.35);
      } else {
        // 守備位置にもどる（home が大きいほど 球の高さに ついていく＝上手な守り）
        const home = ai.lv ? cfg.home : 0.3;
        ai.target = lerp(ai.target, CY + (pk.y - CY) * home, ai.lv ? 0.5 : 0.6);
      }
    }

    /* --- 速度（上限内の連続移動。瞬間移動はしない） --- */
    let speed = cfg.speed;
    if (ai.lv ? cfg.hand : ai.kind === 'cpu') {
      // リードしすぎたら手かげん、負けているときは少しだけがんばる
      if (lead >= 2) speed *= 0.82;
      else if (lead === 1) speed *= 0.93;
      else if (lead <= -2) speed *= 1.06;
    }
    if (ai.lv) {
      speed *= 1 - 0.30 * (cfg.fatigue || 0) * ai.fat;       // 【穴3】ゆさぶられた直後は うごきが にぶる
      if (ai.rec > 0) speed *= cfg.recoverSp;                // 【穴4】打ち返した直後は もどりが遅い
    }
    const diff = ai.target - p.y;
    out.dir = Math.abs(diff) < 8 ? 0 : clamp(diff / 50, -1, 1);
    out.sp = clamp(speed, 120, PAD_SPEED);
    return out;
  }

  /* =========================================================
     キャラクター（パドル）
     o = { s, t, mood: normal|hit|happy|win|sad, lx, ly (見る方向 -1..1), squash 0..1, blink }
     ========================================================= */
  function teardrop(g, x, y, r) {
    g.beginPath();
    g.moveTo(x, y - r * 1.6);
    g.quadraticCurveTo(x + r * 1.1, y - r * 0.2, x + r, y);
    g.arc(x, y, r, 0, Math.PI);
    g.quadraticCurveTo(x - r * 1.1, y - r * 0.2, x, y - r * 1.6);
    g.closePath();
  }
  function star4(g, x, y, r) {
    g.beginPath();
    g.moveTo(x, y - r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.quadraticCurveTo(x, y, x, y + r);
    g.quadraticCurveTo(x, y, x - r, y);
    g.quadraticCurveTo(x, y, x, y - r);
    g.closePath();
  }
  function star5(g, x, y, r1, r2, rot) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = rot + i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? r2 : r1;
      if (i === 0) g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.closePath();
  }

  function drawBuddy(g, x, y, k, o) {
    const tm = TEAM[k];
    const s = o.s || 1, t = o.t || 0, mood = o.mood || 'normal';
    const face = k === 0 ? 1 : -1;
    const joy = mood === 'happy' || mood === 'win';
    let sx = 1, sy = 1, oy = 0, rot = 0;
    const q = o.squash || 0;
    if (q > 0) { sx = 1 - 0.1 * q; sy = 1 + 0.035 * q; }
    if (joy) oy = -Math.abs(Math.sin(t * (mood === 'win' ? 7 : 9))) * (mood === 'win' ? 22 : 12);
    else if (mood === 'sad') { sy *= 0.97; oy = 3; rot = -face * 0.05; }
    else oy = Math.sin(t * 3 + k * 1.7) * 1.2;

    g.save();
    g.translate(x, y);
    g.scale(s, s);
    // かげ
    g.fillStyle = 'rgba(60,30,100,0.15)';
    RR(g, -33, -92, 80, 204, 40);
    g.fill();
    g.translate(0, oy);
    if (rot) g.rotate(rot);
    g.scale(sx, sy);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    // ばんざいの うで（からだの うしろ）
    if (joy) {
      const wave = Math.sin(t * 12) * 0.25;
      for (let sd = -1; sd <= 1; sd += 2) {
        g.save();
        g.translate(sd * 32, -56);
        g.rotate(sd * (0.55 + wave));
        ell(g, 0, -18, 11, 21);
        g.fillStyle = tm.top; g.fill();
        g.lineWidth = 4; g.strokeStyle = tm.line; g.stroke();
        g.restore();
      }
    }
    // からだ
    RR(g, -40, -102, 80, 204, 40);
    const gr = g.createLinearGradient(0, -102, 0, 102);
    gr.addColorStop(0, tm.top);
    gr.addColorStop(1, tm.bot);
    g.fillStyle = gr;
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = tm.line;
    g.stroke();
    // おなか・つや
    g.fillStyle = 'rgba(255,255,255,0.3)';
    ell(g, face * 3, 46, 25, 42); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.65)';
    ell(g, -21, -64, 6.5, 17, 0.12); g.fill();
    circ(g, -20, -37, 3.5); g.fill();
    // おなかの前の 手
    if (!joy) {
      const hy = mood === 'hit' ? 2 : 14;
      g.fillStyle = tm.top; g.strokeStyle = tm.line; g.lineWidth = 3.5;
      for (let sd = -1; sd <= 1; sd += 2) { ell(g, sd * 23 + face * 2, hy, 9, 11, sd * 0.3); g.fill(); g.stroke(); }
    }
    // あたまの かざり
    if (k === 0) {
      const sw = Math.sin(t * 4) * 3;
      g.strokeStyle = tm.line; g.lineWidth = 4;
      g.beginPath(); g.moveTo(0, -100); g.quadraticCurveTo(1, -114, 5 + sw, -121); g.stroke();
      teardrop(g, 6 + sw, -128, 8);
      g.fillStyle = '#c9f0ff'; g.fill();
      g.lineWidth = 3.5; g.stroke();
      g.fillStyle = '#fff'; circ(g, 3 + sw, -130, 2.5); g.fill();
    } else {
      g.save();
      g.translate(0, -100);
      g.rotate(Math.sin(t * 3) * 0.06);
      g.fillStyle = '#ff92c2'; g.strokeStyle = tm.line; g.lineWidth = 3.5;
      for (let sd = -1; sd <= 1; sd += 2) {
        g.beginPath();
        g.moveTo(0, 0);
        g.quadraticCurveTo(sd * 12, -22, sd * 26, -13);
        g.quadraticCurveTo(sd * 31, 3, sd * 18, 7);
        g.quadraticCurveTo(sd * 8, 6, 0, 0);
        g.closePath(); g.fill(); g.stroke();
      }
      circ(g, 0, -1, 6.5); g.fillStyle = '#ff6fa6'; g.fill(); g.stroke();
      g.restore();
    }
    // かお
    const fx = face * 5, ey = -50;
    g.fillStyle = 'rgba(255,110,150,0.42)';
    ell(g, fx - 25, ey + 20, 9, 6); g.fill();
    ell(g, fx + 25, ey + 20, 9, 6); g.fill();
    const exL = fx - 14, exR = fx + 14;
    g.strokeStyle = INK; g.fillStyle = INK;
    if (mood === 'hit') {
      g.lineWidth = 4.5;
      g.beginPath();
      g.moveTo(exL - 7, ey - 7); g.lineTo(exL + 5, ey); g.lineTo(exL - 7, ey + 7);
      g.moveTo(exR + 7, ey - 7); g.lineTo(exR - 5, ey); g.lineTo(exR + 7, ey + 7);
      g.stroke();
    } else if (joy) {
      g.lineWidth = 5;
      g.beginPath(); g.arc(exL, ey + 4, 8, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      g.beginPath(); g.arc(exR, ey + 4, 8, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    } else if (o.blink) {
      g.lineWidth = 4.5;
      g.beginPath(); g.arc(exL, ey - 4, 8, Math.PI * 0.2, Math.PI * 0.8); g.stroke();
      g.beginPath(); g.arc(exR, ey - 4, 8, Math.PI * 0.2, Math.PI * 0.8); g.stroke();
    } else {
      g.fillStyle = '#fff';
      ell(g, exL, ey, 11, 14); g.fill();
      ell(g, exR, ey, 11, 14); g.fill();
      g.lineWidth = 2; g.strokeStyle = 'rgba(40,30,70,0.3)';
      ell(g, exL, ey, 11, 14); g.stroke();
      ell(g, exR, ey, 11, 14); g.stroke();
      const lx = clamp(o.lx || 0, -1, 1) * 3.5;
      const ly = mood === 'sad' ? 4.5 : clamp(o.ly || 0, -1, 1) * 4.5;
      g.fillStyle = INK;
      circ(g, exL + lx, ey + ly, 7); g.fill();
      circ(g, exR + lx, ey + ly, 7); g.fill();
      g.fillStyle = '#fff';
      circ(g, exL + lx - 2.2, ey + ly - 3, 2.6); g.fill();
      circ(g, exR + lx - 2.2, ey + ly - 3, 2.6); g.fill();
      if (mood === 'sad') {
        g.strokeStyle = INK; g.lineWidth = 4;
        g.beginPath();
        g.moveTo(exL - 9, ey - 15); g.lineTo(exL + 6, ey - 21);
        g.moveTo(exR + 9, ey - 15); g.lineTo(exR - 6, ey - 21);
        g.stroke();
      }
    }
    // くち
    const my = ey + 27;
    g.strokeStyle = INK; g.lineWidth = 4.5;
    if (mood === 'hit') {
      ell(g, fx, my + 2, 8, 10); g.fillStyle = '#7a2846'; g.fill();
      ell(g, fx, my + 7, 5, 3.5); g.fillStyle = '#ff8fa8'; g.fill();
    } else if (joy) {
      g.beginPath(); g.moveTo(fx - 14, my - 5); g.quadraticCurveTo(fx, my + 24, fx + 14, my - 5); g.closePath();
      g.fillStyle = '#7a2846'; g.fill();
      ell(g, fx, my + 5, 6, 3.5); g.fillStyle = '#ff8fa8'; g.fill();
    } else if (mood === 'sad') {
      g.beginPath(); g.arc(fx, my + 10, 9, Math.PI * 1.2, Math.PI * 1.8); g.stroke();
    } else {
      g.beginPath(); g.arc(fx, my - 5, 9, Math.PI * 0.18, Math.PI * 0.82); g.stroke();
    }
    // あせ / キラキラ
    if (mood === 'sad') {
      teardrop(g, -face * 33, -84 + (t * 30) % 12, 6);
      g.fillStyle = '#a9dcff'; g.fill();
      g.lineWidth = 2.5; g.strokeStyle = '#5aa6e6'; g.stroke();
    } else if (joy) {
      g.fillStyle = '#ffd23f';
      for (let i = 0; i < 3; i++) {
        const a = t * 2 + i * 2.1;
        const sr = 7 + Math.sin(t * 8 + i) * 3;
        star4(g, Math.cos(a) * 62, -90 + Math.sin(a) * 34, sr); g.fill();
      }
    }
    g.restore();
  }

  /* ---------- パック ----------
     o = { type, dir（進む向き -1/1）, t（秒） }。type ごとに 色だけでなく 形・かざりを変える */
  function drawPuck(g, x, y, r, spin, sc, o) {
    if (sc <= 0.01) return;
    const type = (o && o.type) || 'normal';
    const dir = (o && o.dir) || 1, t = (o && o.t) || 0;
    g.save();
    g.translate(x, y);
    g.scale(sc, sc);
    g.fillStyle = 'rgba(60,30,100,0.2)';
    ell(g, 5, 8, r, r * 0.92); g.fill();
    if (type === 'normal') {
      circ(g, 0, 0, r); g.fillStyle = '#ff9a2e'; g.fill();
      g.lineWidth = 3; g.strokeStyle = '#e07400'; g.stroke();
      const gr = g.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, 0, r * 0.82);
      gr.addColorStop(0, '#fff7b8');
      gr.addColorStop(1, '#ffd23f');
      circ(g, 0, 0, r * 0.8); g.fillStyle = gr; g.fill();
      star5(g, 0, 0, r * 0.46, r * 0.2, spin);
      g.fillStyle = '#ffffff'; g.fill();
      g.lineWidth = 2; g.strokeStyle = 'rgba(224,116,0,0.5)'; g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.7)';
      ell(g, -r * 0.38, -r * 0.42, r * 0.24, r * 0.13, -0.6); g.fill();
      g.restore();
      return;
    }
    const d = PUCK[type] || PUCK.normal;
    if (type === 'gold') {
      // 光の すじ（うしろ）
      g.save();
      g.rotate(t * 1.1);
      g.fillStyle = 'rgba(255,214,70,0.5)';
      for (let i = 0; i < 8; i++) {
        g.save(); g.rotate(i * TAU / 8);
        const L = r * (1.65 + Math.sin(t * 6 + i) * 0.18);
        g.beginPath(); g.moveTo(0, -r * 0.2); g.lineTo(L, 0); g.lineTo(0, r * 0.2); g.closePath(); g.fill();
        g.restore();
      }
      g.restore();
      circ(g, 0, 0, r * 1.06); g.fillStyle = '#ff9000'; g.fill();
      const gr = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
      gr.addColorStop(0, '#fff6c8'); gr.addColorStop(0.55, '#ffd23f'); gr.addColorStop(1, '#ffa81e');
      circ(g, 0, 0, r * 0.94); g.fillStyle = gr; g.fill();
      g.lineWidth = 3; g.strokeStyle = '#c57a00'; g.stroke();
      // 王かん（形でも ゴールドだと わかる）
      g.fillStyle = '#fff0a8'; g.strokeStyle = '#c57a00'; g.lineWidth = 2.5; g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(-r * 0.62, -r * 0.86); g.lineTo(-r * 0.42, -r * 1.42); g.lineTo(-r * 0.16, -r * 1.0);
      g.lineTo(0, -r * 1.55); g.lineTo(r * 0.16, -r * 1.0); g.lineTo(r * 0.42, -r * 1.42);
      g.lineTo(r * 0.62, -r * 0.86); g.closePath(); g.fill(); g.stroke();
      TX(g, '2', 0, r * 0.06, { size: r * 1.15, color: '#ffffff', stroke: '#c57a00', strokeWidth: r * 0.2, weight: 800 });
      g.restore();
      return;
    }
    if (type === 'fast') {
      // たてに のびた形＋進む向きの やじるし
      g.save();
      g.scale(1.14, 0.9);
      circ(g, 0, 0, r * 1.02); g.fillStyle = d.col2; g.fill();
      const gr = g.createLinearGradient(0, -r, 0, r);
      gr.addColorStop(0, '#d6fbff'); gr.addColorStop(0.5, d.col); gr.addColorStop(1, '#0fa6c8');
      circ(g, 0, 0, r * 0.9); g.fillStyle = gr; g.fill();
      g.restore();
      g.save();
      g.scale(dir >= 0 ? 1 : -1, 1);
      g.strokeStyle = '#ffffff'; g.lineWidth = r * 0.19; g.lineCap = 'round'; g.lineJoin = 'round';
      for (let i = 0; i < 3; i++) {
        const xx = -r * 0.5 + i * r * 0.42, a = 0.75 + 0.25 * Math.sin(t * 14 - i);
        g.globalAlpha = a;
        g.beginPath(); g.moveTo(xx, -r * 0.44); g.lineTo(xx + r * 0.3, 0); g.lineTo(xx, r * 0.44); g.stroke();
      }
      g.restore();
      g.restore();
      return;
    }
    if (type === 'curve') {
      // 波うつ輪郭＋うずまき
      g.beginPath();
      for (let i = 0; i <= 48; i++) {
        const a = i / 48 * TAU, rr = r * (1 + 0.1 * Math.sin(a * 7 + t * 5));
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
      const gr = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
      gr.addColorStop(0, '#f0ddff'); gr.addColorStop(0.6, d.col); gr.addColorStop(1, '#8a3ce0');
      g.fillStyle = gr; g.fill();
      g.lineWidth = 3; g.strokeStyle = d.col2; g.stroke();
      g.strokeStyle = '#ffffff'; g.lineWidth = r * 0.16; g.lineCap = 'round';
      g.beginPath();
      for (let i = 0; i <= 30; i++) {
        const a = spin * 0.6 + i * 0.32, rr = r * 0.1 + i * r * 0.021;
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke();
      g.restore();
      return;
    }
    // slow: 花びら＋ふわふわ
    const pulse = 1 + Math.sin(t * 3) * 0.07;
    g.scale(pulse, pulse);
    g.fillStyle = 'rgba(120,235,170,0.45)';
    for (let i = 0; i < 6; i++) {
      g.save(); g.rotate(spin * 0.3 + i * TAU / 6);
      ell(g, 0, -r * 0.95, r * 0.42, r * 0.62); g.fill();
      g.restore();
    }
    circ(g, 0, 0, r * 0.98); g.fillStyle = d.col2; g.fill();
    const gr2 = g.createRadialGradient(-r * 0.28, -r * 0.34, r * 0.1, 0, 0, r * 0.95);
    gr2.addColorStop(0, '#e6fff0'); gr2.addColorStop(0.6, d.col); gr2.addColorStop(1, '#35b872');
    circ(g, 0, 0, r * 0.88); g.fillStyle = gr2; g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 6; i++) {
      g.save(); g.rotate(spin * 0.3 + i * TAU / 6);
      ell(g, 0, -r * 0.44, r * 0.16, r * 0.26); g.fill();
      g.restore();
    }
    circ(g, 0, 0, r * 0.19); g.fillStyle = '#fff3a8'; g.fill();
    g.restore();
  }

  /* ---------- キーの絵 ---------- */
  function drawKeyCap(g, x, y, label, k, a) {
    const tm = TEAM[k];
    const w = label.length > 1 ? 104 : 66, h = 62;
    g.save();
    g.globalAlpha = a;
    RR(g, x - w / 2, y - h / 2 + 7, w, h, 14); g.fillStyle = tm.line; g.fill();
    RR(g, x - w / 2, y - h / 2, w, h, 14); g.fillStyle = '#ffffff'; g.fill();
    g.lineWidth = 4; g.strokeStyle = tm.line; g.stroke();
    TX(g, label, x, y + 2, { size: 40, color: tm.line });
    g.restore();
  }

  // 大きな文字（拡大・回転・フェードつき）
  function bigText(g, str, x, y, size, color, stroke, sc, alpha, rot) {
    if (alpha <= 0.01 || sc <= 0.01) return;
    g.save();
    g.globalAlpha = clamp(alpha, 0, 1);
    g.translate(x, y);
    if (rot) g.rotate(rot);
    g.scale(sc, sc);
    TX(g, str, 0, 0, { size: size, color: color, stroke: stroke, strokeWidth: Math.max(8, size * 0.12), shadow: 'rgba(60,30,100,0.3)', shadowOffset: Math.max(4, size * 0.05) });
    g.restore();
  }

  // 縦書き（「ー」は縦に）
  function vText(g, str, x, y, size, color, stroke) {
    const n = str.length;
    for (let i = 0; i < n; i++) {
      const ch = str[i];
      const yy = y + (i - (n - 1) / 2) * size * 1.02;
      if (ch === 'ー') {
        g.save(); g.translate(x, yy); g.rotate(Math.PI / 2);
        TX(g, ch, 0, 0, { size: size, color: color, stroke: stroke, strokeWidth: 9 });
        g.restore();
      } else TX(g, ch, x, yy, { size: size, color: color, stroke: stroke, strokeWidth: 9 });
    }
  }

  /* =========================================================
     背景（うごかない部分は 1 回だけ描いてキャッシュ）
     ========================================================= */
  function drawStatic(g) {
    // 会場の かべ
    let gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#d4ecff');
    gr.addColorStop(0.3, '#efe6ff');
    gr.addColorStop(1, '#f4ecfc');
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    // 観客席（3だん）
    const tiers = [[60, 132, '#f1e8ff', '#e2d4fa'], [132, 180, '#e9ddfc', '#d9c9f5'], [180, 230, '#e1d2f8', '#cfbdf0']];
    for (let i = 0; i < tiers.length; i++) {
      const tr = tiers[i];
      g.fillStyle = tr[2]; g.fillRect(0, tr[0], W, tr[1] - tr[0]);
      g.fillStyle = tr[3]; g.fillRect(0, tr[1] - 9, W, 9);
      g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(0, tr[0], W, 3);
    }
    // 天幕（しましま）
    const sw = 96;
    for (let i = 0; i * sw < W + sw; i++) {
      const x = i * sw;
      g.fillStyle = i % 2 ? '#ffffff' : '#7fc6ff';
      g.fillRect(x, 0, sw, 30);
      g.beginPath(); g.arc(x + sw / 2, 30, sw / 2, 0, Math.PI); g.fill();
    }
    g.strokeStyle = 'rgba(70,120,190,0.25)'; g.lineWidth = 3;
    for (let i = 0; i * sw < W + sw; i++) { g.beginPath(); g.arc(i * sw + sw / 2, 30, sw / 2, 0, Math.PI); g.stroke(); }

    // リンクの外わく
    RR(g, 34, 226, 1852, 850, 54); g.fillStyle = '#c4afe6'; g.fill();
    RR(g, 34, 216, 1852, 852, 54); g.fillStyle = '#ffffff'; g.fill();
    g.lineWidth = 5; g.strokeStyle = '#dccff3'; g.stroke();
    // 黄色いライン
    RR(g, FX0 - NET - 8, FY0 - 9, FX1 - FX0 + NET * 2 + 16, FY1 - FY0 + 18, 22);
    g.lineWidth = 6; g.strokeStyle = '#ffd56b'; g.stroke();

    // フィールド
    gr = g.createLinearGradient(FX0, 0, FX1, 0);
    gr.addColorStop(0, '#d3ebff');
    gr.addColorStop(0.4, '#f6fbff');
    gr.addColorStop(0.6, '#fff6fa');
    gr.addColorStop(1, '#ffd9e8');
    g.fillStyle = gr;
    g.fillRect(FX0, FY0, FX1 - FX0, FY1 - FY0);
    g.save();
    g.beginPath(); g.rect(FX0, FY0, FX1 - FX0, FY1 - FY0); g.clip();
    // つやの光
    g.fillStyle = 'rgba(255,255,255,0.32)';
    [[420, 150], [760, 70], [1300, 120]].forEach(function (s) {
      g.beginPath();
      g.moveTo(s[0], FY0); g.lineTo(s[0] + s[1], FY0); g.lineTo(s[0] + s[1] - 380, FY1); g.lineTo(s[0] - 380, FY1);
      g.closePath(); g.fill();
    });
    // 空気の穴
    g.fillStyle = 'rgba(120,100,170,0.13)';
    g.beginPath();
    let row = 0;
    for (let y = FY0 + 20; y < FY1; y += 38, row++) {
      for (let x = FX0 + 20 + (row % 2) * 19; x < FX1; x += 38) { g.moveTo(x + 2.4, y); g.arc(x, y, 2.4, 0, TAU); }
    }
    g.fill();
    // ゴール前のエリア
    for (let k = 0; k < 2; k++) {
      const gx = k === 0 ? FX0 : FX1, tint = TEAM[k].tint;
      g.beginPath();
      g.arc(gx, CY, 230, k === 0 ? -Math.PI / 2 : Math.PI / 2, k === 0 ? Math.PI / 2 : Math.PI * 1.5);
      g.closePath();
      g.fillStyle = 'rgba(' + tint + ',0.13)'; g.fill();
      g.lineWidth = 6; g.strokeStyle = 'rgba(' + tint + ',0.45)'; g.stroke();
      // かざりの丸
      const fx = k === 0 ? FX0 + 430 : FX1 - 430;
      for (let s = -1; s <= 1; s += 2) {
        circ(g, fx, CY + s * 225, 62); g.lineWidth = 5; g.strokeStyle = 'rgba(' + tint + ',0.3)'; g.stroke();
        circ(g, fx, CY + s * 225, 9); g.fillStyle = 'rgba(' + tint + ',0.4)'; g.fill();
      }
    }
    g.restore();
    // センターライン・センターサークル
    g.save();
    g.setLineDash([26, 18]);
    g.lineWidth = 8; g.strokeStyle = '#cdbbf0';
    g.beginPath(); g.moveTo(CX, FY0); g.lineTo(CX, FY1); g.stroke();
    g.restore();
    circ(g, CX, CY, 130); g.fillStyle = 'rgba(255,255,255,0.55)'; g.fill();
    g.lineWidth = 8; g.strokeStyle = '#cdbbf0'; g.stroke();
    // さくらのマーク
    g.fillStyle = 'rgba(255,160,195,0.28)';
    for (let i = 0; i < 5; i++) {
      g.save(); g.translate(CX, CY); g.rotate(i * TAU / 5);
      g.beginPath(); g.moveTo(0, 0);
      g.bezierCurveTo(-46, -30, -34, -86, -8, -92); g.lineTo(0, -80); g.lineTo(8, -92);
      g.bezierCurveTo(34, -86, 46, -30, 0, 0);
      g.fill(); g.restore();
    }

    // ゴールネットの おく
    for (let k = 0; k < 2; k++) {
      const tm = TEAM[k];
      const x0 = k === 0 ? FX0 - NET : FX1, gx = k === 0 ? FX0 : FX1;
      gr = g.createLinearGradient(k === 0 ? x0 : x0 + NET, 0, gx, 0);
      gr.addColorStop(0, tm.net[0]);
      gr.addColorStop(1, tm.net[1]);
      g.fillStyle = gr;
      g.fillRect(x0, FY0, NET, FY1 - FY0);
      // ゴールライン
      g.fillStyle = tm.main;
      g.fillRect(gx - 6, FY0, 12, FY1 - FY0);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillRect(gx - 2, FY0, 3, FY1 - FY0);
      // ポスト
      for (let s = 0; s < 2; s++) {
        const py = s === 0 ? FY0 - 6 : FY1 + 6;
        circ(g, gx, py, 17); g.fillStyle = tm.main; g.fill();
        g.lineWidth = 5; g.strokeStyle = '#ffffff'; g.stroke();
      }
    }
  }

  let staticCache = null, staticScale = 0;
  function getStatic(g) {
    let s = 1;
    try { const m = g.getTransform(); s = Math.hypot(m.a, m.b); } catch (e) { s = 1; }
    s = clamp(Math.round(s * 4) / 4, 0.5, 2);
    if (!staticCache || staticScale !== s) {
      const c = document.createElement('canvas');
      c.width = Math.round(W * s); c.height = Math.round(H * s);
      const cg = c.getContext('2d');
      cg.setTransform(s, 0, 0, s, 0, 0);
      drawStatic(cg);
      staticCache = c; staticScale = s;
    }
    return staticCache;
  }

  /* ---------- 観客 ---------- */
  const FAN_COLS = [['#ffd98a', '#f2b85a'], ['#c3eba6', '#8fd06a'], ['#ffc6d7', '#f597b5'], ['#b8deff', '#7fbcf0'], ['#ddc8ff', '#b796f0'], ['#ffd3ad', '#f5a874'], ['#ade9dc', '#6fcfb8'], ['#fff1a8', '#ead25a']];
  function makeFans() {
    const r = Arcade.rng(20261114);
    const rows = [{ y: 112, r: 20, gap: 56, off: 6 }, { y: 160, r: 24, gap: 64, off: 34 }, { y: 207, r: 28, gap: 72, off: 14 }];
    const fans = [];
    rows.forEach(function (row, ri) {
      for (let x = row.off + 24; x < W; x += row.gap) {
        const jx = x + (r() - 0.5) * 14;
        if (ri < 2 && jx > 560 && jx < 1360) continue;       // スコアボードの うら
        if (ri === 2 && jx > 800 && jx < 1120) continue;     // タイマーの うら
        fans.push({
          x: jx, y: row.y + (r() - 0.5) * 4, r: row.r * (0.9 + r() * 0.18), c: FAN_COLS[Math.floor(r() * FAN_COLS.length)],
          ear: Math.floor(r() * 4), side: jx < W / 2 ? 0 : 1, flag: r() < 0.55, hand: r() < 0.5 ? -1 : 1, ph: r() * TAU,
        });
      }
    });
    return fans;
  }
  function drawFan(g, f, t, ch) {
    const hop = ch > 0.02 ? Math.abs(Math.sin(t * 8.5 + f.ph)) * 15 * ch : 0;
    const x = f.x, r = f.r, y = f.y + Math.sin(t * 2.3 + f.ph) * 2 - hop;
    g.fillStyle = f.c[1];
    ell(g, x, y + r * 1.3, r * 0.95, r * 0.85); g.fill();
    if (f.flag) {
      const a = f.hand * 0.15 + Math.sin(t * 2.6 + f.ph) * 0.12 + (ch > 0.02 ? Math.sin(t * 11 + f.ph) * 0.4 * ch : 0);
      const hx = x + r * 0.85 * f.hand, hy = y + r * 0.95;
      const tx = hx + Math.sin(a) * r * 2.1, ty = hy - Math.cos(a) * r * 2.1;
      g.strokeStyle = '#9a7a5a'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(hx, hy); g.lineTo(tx, ty); g.stroke();
      g.fillStyle = TEAM[f.side].main;
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(tx + f.hand * r * 1.2, ty + r * 0.4 + Math.sin(t * 6 + f.ph) * 2); g.lineTo(tx, ty + r * 0.85); g.closePath(); g.fill();
      g.fillStyle = f.c[0];
      circ(g, hx, hy, r * 0.24); g.fill();
    }
    g.fillStyle = f.c[0];
    if (f.ear === 1) {
      circ(g, x - r * 0.72, y - r * 0.68, r * 0.34); g.fill();
      circ(g, x + r * 0.72, y - r * 0.68, r * 0.34); g.fill();
    } else if (f.ear === 2) {
      g.beginPath();
      g.moveTo(x - r * 0.9, y - r * 0.3); g.lineTo(x - r * 0.72, y - r * 1.2); g.lineTo(x - r * 0.18, y - r * 0.85);
      g.moveTo(x + r * 0.9, y - r * 0.3); g.lineTo(x + r * 0.72, y - r * 1.2); g.lineTo(x + r * 0.18, y - r * 0.85);
      g.fill();
    } else if (f.ear === 3) {
      ell(g, x - r * 0.38, y - r * 1.15, r * 0.2, r * 0.5, -0.15); g.fill();
      ell(g, x + r * 0.38, y - r * 1.15, r * 0.2, r * 0.5, 0.15); g.fill();
    }
    circ(g, x, y, r); g.fill();
    g.strokeStyle = 'rgba(90,60,130,0.25)'; g.lineWidth = 2; g.stroke();
    g.fillStyle = 'rgba(255,120,160,0.45)';
    ell(g, x - r * 0.55, y + r * 0.22, r * 0.18, r * 0.11); g.fill();
    ell(g, x + r * 0.55, y + r * 0.22, r * 0.18, r * 0.11); g.fill();
    g.fillStyle = INK; g.strokeStyle = INK; g.lineWidth = Math.max(2, r * 0.1);
    if (ch > 0.35) {
      g.beginPath(); g.arc(x - r * 0.34, y - r * 0.02, r * 0.16, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      g.beginPath(); g.arc(x + r * 0.34, y - r * 0.02, r * 0.16, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      ell(g, x, y + r * 0.34, r * 0.18, r * 0.2); g.fillStyle = '#7a2846'; g.fill();
    } else {
      circ(g, x - r * 0.34, y - r * 0.08, r * 0.1); g.fill();
      circ(g, x + r * 0.34, y - r * 0.08, r * 0.1); g.fill();
      g.beginPath(); g.arc(x, y + r * 0.12, r * 0.2, Math.PI * 0.2, Math.PI * 0.8); g.stroke();
    }
  }

  /* ---------- ゴールネット（ふくらむ） ---------- */
  function drawNet(g, k, bulge, by) {
    const gx = k === 0 ? FX0 : FX1, out = k === 0 ? -1 : 1;
    const depth = NET - 8;
    g.save();
    g.strokeStyle = 'rgba(255,255,255,0.72)';
    g.lineWidth = 2.5;
    g.beginPath();
    for (let y = FY0 + 13; y < FY1; y += 26) {
      const b = bulge * Math.exp(-Math.pow((y - by) / 120, 2));
      g.moveTo(gx, y);
      g.lineTo(gx + out * (depth + b), y);
    }
    for (let i = 1; i <= 4; i++) {
      const u = i / 4;
      for (let y = FY0; y <= FY1; y += 20) {
        const b = bulge * Math.exp(-Math.pow((y - by) / 120, 2)) * u;
        const x = gx + out * (depth * u + b);
        if (y === FY0) g.moveTo(x, y); else g.lineTo(x, y);
      }
    }
    g.stroke();
    g.restore();
    vText(g, 'ゴール', gx + out * NET * 0.47, CY, 50, '#ffffff', TEAM[k].line);
  }

  /* =========================================================
     メニューのサムネイル（552x300）
     ========================================================= */
  const TH = { x0: 46, x1: 506, y0: 62, y1: 288, padX: [90, 462], s: 0.5, r: 13 };
  let thumbBg = null;
  function buildThumbBg() {
    const c = document.createElement('canvas');
    c.width = 1104; c.height = 600;
    const g = c.getContext('2d');
    g.setTransform(2, 0, 0, 2, 0, 0);
    let gr = g.createLinearGradient(0, 0, 0, 300);
    gr.addColorStop(0, '#d4ecff'); gr.addColorStop(1, '#f1e8ff');
    g.fillStyle = gr; g.fillRect(0, 0, 552, 300);
    g.fillStyle = '#e6d9fb'; g.fillRect(0, 22, 552, 34);
    for (let i = 0; i < 13; i++) {
      g.fillStyle = i % 2 ? '#ffffff' : '#7fc6ff';
      g.fillRect(i * 46, 0, 46, 10);
      g.beginPath(); g.arc(i * 46 + 23, 10, 23, 0, Math.PI); g.fill();
    }
    RR(g, 6, 54, 540, 250, 24); g.fillStyle = '#c4afe6'; g.fill();
    RR(g, 6, 50, 540, 250, 24); g.fillStyle = '#ffffff'; g.fill();
    gr = g.createLinearGradient(TH.x0, 0, TH.x1, 0);
    gr.addColorStop(0, '#d3ebff'); gr.addColorStop(0.45, '#f8fbff'); gr.addColorStop(0.55, '#fff6fa'); gr.addColorStop(1, '#ffd9e8');
    g.fillStyle = gr; g.fillRect(TH.x0, TH.y0, TH.x1 - TH.x0, TH.y1 - TH.y0);
    g.fillStyle = 'rgba(120,100,170,0.13)';
    g.beginPath();
    for (let y = TH.y0 + 9; y < TH.y1; y += 16) for (let x = TH.x0 + 9; x < TH.x1; x += 16) { g.moveTo(x + 1.2, y); g.arc(x, y, 1.2, 0, TAU); }
    g.fill();
    g.save(); g.setLineDash([10, 7]); g.lineWidth = 4; g.strokeStyle = '#cdbbf0';
    g.beginPath(); g.moveTo(276, TH.y0); g.lineTo(276, TH.y1); g.stroke(); g.restore();
    circ(g, 276, (TH.y0 + TH.y1) / 2, 40); g.lineWidth = 4; g.strokeStyle = '#cdbbf0'; g.stroke();
    for (let k = 0; k < 2; k++) {
      const tm = TEAM[k];
      const x0 = k === 0 ? 16 : TH.x1, gx = k === 0 ? TH.x0 : TH.x1;
      gr = g.createLinearGradient(k === 0 ? x0 : x0 + 30, 0, gx, 0);
      gr.addColorStop(0, tm.net[0]); gr.addColorStop(1, tm.net[1]);
      g.fillStyle = gr; g.fillRect(x0, TH.y0, 30, TH.y1 - TH.y0);
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1.5;
      g.beginPath();
      for (let y = TH.y0 + 6; y < TH.y1; y += 12) { g.moveTo(x0, y); g.lineTo(x0 + 30, y); }
      for (let x = x0 + 7; x < x0 + 30; x += 8) { g.moveTo(x, TH.y0); g.lineTo(x, TH.y1); }
      g.stroke();
      g.fillStyle = tm.main; g.fillRect(gx - 3, TH.y0, 6, TH.y1 - TH.y0);
    }
    return c;
  }
  function thumbPuck(t) {
    const tri = function (u) { u = u - Math.floor(u); return 1 - Math.abs(2 * u - 1); };
    const xl = TH.padX[0] + PAD_R * TH.s + TH.r, xr = TH.padX[1] - PAD_R * TH.s - TH.r;
    const u = tri(t / 2.6);
    return { u: u, x: xl + (xr - xl) * u, y: TH.y0 + TH.r + (TH.y1 - TH.y0 - TH.r * 2) * tri(t / 1.9 + 0.15) };
  }
  function drawThumb(g, w, h, t) {
    if (!thumbBg) thumbBg = buildThumbBg();
    g.drawImage(thumbBg, 0, 0, 552, 300);
    // 観客
    g.save();
    g.beginPath(); g.rect(0, 0, 552, 50); g.clip();
    for (let i = 0; i < 14; i++) {
      const x = 18 + i * 40;
      const f = { x: x, y: 36, r: 12, c: FAN_COLS[i % FAN_COLS.length], ear: i % 4, side: x < 276 ? 0 : 1, flag: i % 3 === 0, hand: 1, ph: i * 1.7 };
      drawFan(g, f, t, 0.3 + 0.3 * Math.sin(t * 1.3 + i));
    }
    g.restore();
    // パック と パドル
    const P = thumbPuck(t);
    const midY = (TH.y0 + TH.y1) / 2;
    for (let k = 0; k < 2; k++) {
      const near = k === 0 ? 1 - P.u : P.u;
      const py = clamp(lerp(midY, P.y + Math.sin(t * 1.1 + k) * 10, Math.pow(near, 1.4)), TH.y0 + PAD_HALF * TH.s, TH.y1 - PAD_HALF * TH.s);
      drawBuddy(g, TH.padX[k], py, k, { s: TH.s, t: t, mood: near > 0.96 ? 'hit' : 'normal', lx: k === 0 ? 1 : -1, ly: (P.y - py) / 120, squash: near > 0.96 ? 1 : 0 });
    }
    for (let i = 6; i >= 1; i--) {
      const q = thumbPuck(t - i * 0.03);
      g.fillStyle = 'rgba(255,170,40,' + (0.32 * (1 - i / 7)) + ')';
      circ(g, q.x, q.y, TH.r * (1 - i / 9)); g.fill();
    }
    drawPuck(g, P.x, P.y, TH.r, t * 4, 1);
    if (P.u < 0.04 || P.u > 0.96) {
      const sx = P.u < 0.5 ? P.x - TH.r : P.x + TH.r;
      g.fillStyle = '#ffd23f';
      for (let i = 0; i < 4; i++) { star4(g, sx + Math.cos(i * 1.6) * 16, P.y + Math.sin(i * 1.6) * 16, 5); g.fill(); }
    }
  }

  /* =========================================================
     ゲーム本体
     ========================================================= */
  function create(api) {
    const seedP = parseInt(api.params.get('seed'), 10);
    const rand = api.rng(isFinite(seedP) ? seedP : ((Date.now() ^ 0x5bd1e995) >>> 0));
    const w = newWorld();
    const pk = w.puck;
    const fans = makeFans();
    w.accel = 1;   // デモ中は加速しない

    let mode = 'demo', modeId = '2p-normal', special = false, cpuLv = 1;
    let state = 'demo', st = 0, clock = 0;
    const score = [0, 0];
    let timeLeft = MATCH_TIME, overtime = false, otLive = 0;
    let rally = 0, maxRally = 0, serveTo = 0, serveAng = 0;
    let finished = false, winner = -1, endReason = '', finishCount = 0, goalCount = 0, pointCount = 0, lastScorer = -1;
    let countIdx = -1, countLen = COUNT_TIME, goT = 0, lastSec = 999, secPulse = 0, winSfxT = -1, rainT = 0;
    let demoWait = 0.5, wallSndT = 0, hitSndT = 0, shakeT = 0, rallyPop = 0;
    let puckScale = 1, puckTarget = 1, puckSpin = 0;
    // スペシャルモード
    let nextType = 'normal', goldUsed = 0, lastSpecial = '', lastPts = 1, normalRun = 0;
    let tellT = 0, tellType = '';
    const specialLog = [];          // {type, tell: 予告した時刻, live: 効果が始まった時刻}
    let proWin = false, winFx = 0, winT = -1, lastResult = null;
    const cheer = [0, 0], bump = [0, 0];
    const net = [{ a: 0, t: 9, y: CY }, { a: 0, t: 9, y: CY }];
    const padFx = [0, 1].map(function () { return { mood: 'normal', moodT: 0, squash: 0, blinkT: 1 + rand() * 3 }; });
    const parts = [], confetti = [], pops = [], trail = [];
    const demoAI = [makeAI('demo', 0, rand), makeAI('demo', 1, rand)];
    let cpuAI = makeAI('cpu', 1, rand, 1);
    const testAI = [null, null];
    const stats = { hits: 0, walls: 0, bumps: 0 };
    let tune = {}, forceType = null;

    /* ---------- 演出 ---------- */
    function setMood(k, m, dur) { padFx[k].mood = m; padFx[k].moodT = dur; }
    function sparks(x, y, k, n) {
      for (let i = 0; i < n; i++) {
        const a = (k === 0 ? 0 : Math.PI) + (rand() - 0.5) * 2.4;
        const v = 150 + rand() * 380;
        parts.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35 + rand() * 0.25, max: 0.6, size: 4 + rand() * 6, color: rand() < 0.5 ? '#ffd23f' : (rand() < 0.5 ? '#ffffff' : TEAM[k].main), star: rand() < 0.4 });
      }
      parts.push({ ring: true, x: x, y: y, life: 0.3, max: 0.3, size: 20, color: TEAM[k].main });
      if (parts.length > 260) parts.splice(0, parts.length - 260);
    }
    function popup(text, x, y, o) {
      o = o || {};
      pops.push({ text: text, x: x, y: y, t: 0, dur: o.dur || 0.6, size: o.size || 42, color: o.color || '#ffffff', stroke: o.stroke || INK, rise: o.rise == null ? 60 : o.rise });
      if (pops.length > 12) pops.shift();
    }
    function confettiBurst(scorer, n1, n2) {
      const gx = scorer === 0 ? FX1 : FX0, dir = scorer === 0 ? -1 : 1;
      for (let i = 0; i < n1; i++) {
        confetti.push({ x: gx, y: clamp(pk.y + (rand() - 0.5) * 260, FY0, FY1), vx: dir * (250 + rand() * 750), vy: -150 - rand() * 550, rot: rand() * TAU, vr: (rand() - 0.5) * 14, flip: rand() * TAU, w: 10 + rand() * 8, h: 6 + rand() * 6, c: CONFETTI_COLS[Math.floor(rand() * CONFETTI_COLS.length)], life: 3 + rand() });
      }
      for (let i = 0; i < n2; i++) {
        confetti.push({ x: rand() * W, y: -20 - rand() * 260, vx: (rand() - 0.5) * 120, vy: 80 + rand() * 160, rot: rand() * TAU, vr: (rand() - 0.5) * 10, flip: rand() * TAU, w: 10 + rand() * 8, h: 6 + rand() * 6, c: CONFETTI_COLS[Math.floor(rand() * CONFETTI_COLS.length)], life: 6 });
      }
      if (confetti.length > 420) confetti.splice(0, confetti.length - 420);
    }
    function hitSound(fresh) {
      if (hitSndT > 0 && !fresh) return;
      hitSndT = 0.08;
      const f = clamp((pk.sp - SERVE_SPEED) / (MAX_SPEED - SERVE_SPEED), 0, 1);
      api.sfx('hit');
      api.audio.tone({ f: 880 + f * 700, dur: 0.06, type: 'sine', vol: 0.08 });
      // ラリーが のびるほど 音が 高くなる（だんだん もりあがる）
      if (fresh && rally >= 4) {
        const n = Math.min(14, rally - 3);
        api.audio.tone({ f: 523 * Math.pow(1.0595, n * 2), dur: 0.09, type: 'triangle', vol: 0.07, delay: 0.02 });
      }
    }

    const cb = {
      hit: function (k, fresh, x, y) {
        stats.hits++;
        setMood(k, 'hit', 0.28);
        padFx[k].squash = 1;
        sparks(x, y, k, fresh ? 12 : 5);
        if (state === 'demo') return;
        hitSound(fresh);
        if (!fresh) return;
        rally++;
        if (rally > maxRally) maxRally = rally;
        rallyPop = 1;
        // 「えいっ！」の 吹き出しは パドルに かさならないよう 外がわ＆上に 大きく ずらす。
        // 上が つかえる（コートの てっぺん近く）ときは 下に出す
        const px = w.pads[k].x + (k === 0 ? 150 : -150);
        const up = w.pads[k].y - PAD_HALF - 60;
        const py = up < FY0 + 36 ? w.pads[k].y + PAD_HALF + 64 : up;
        const words = ['えいっ！', 'それっ！', 'えいっ！', 'やあっ！'];
        popup(words[Math.floor(rand() * words.length)], px, py, { color: '#ffffff', stroke: TEAM[k].line, size: 40, rise: 42 });
        // ラリーが のびるほど 観客が もりあがる
        if (rally >= 4) { const c = Math.min(0.85, 0.2 + rally * 0.055); cheer[0] = Math.max(cheer[0], c); cheer[1] = Math.max(cheer[1], c); }
        if (rally === 5 || rally === 10 || rally === 15 || (rally >= 20 && rally % 10 === 0)) {
          popup('ラリー ' + rally + '！' + (rally >= 20 ? ' めちゃすごい！' : (rally >= 10 ? ' すごい！' : '')), CX, 430,
            { size: 76, color: rally >= 10 ? '#ff8a3d' : '#ffe14d', stroke: '#b0632a', dur: 1.1, rise: 40 });
          api.sfx('sparkle');
          for (let s = 0; s < 2; s++) parts.push({ ring: true, x: w.pads[s].x, y: w.pads[s].y, life: 0.45, max: 0.45, size: 60, color: TEAM[s].main });
          cheer[0] = Math.max(cheer[0], 0.8); cheer[1] = Math.max(cheer[1], 0.8);
        }
      },
      bump: function (k, x, y) {
        stats.bumps++;
        padFx[k].squash = 0.6;
        sparks(x, y, k, 4);
        if (state !== 'demo') hitSound(false);
      },
      wall: function (x, y) {
        stats.walls++;
        for (let i = 0; i < 4; i++) parts.push({ x: x, y: y, vx: (rand() - 0.5) * 220, vy: (y < CY ? 1 : -1) * (60 + rand() * 140), life: 0.3, max: 0.3, size: 4 + rand() * 4, color: '#ffffff' });
        if (state !== 'demo' && wallSndT <= 0) { api.sfx('wall'); wallSndT = 0.06; }
      },
    };

    /* ---------- 進行 ---------- */
    function humanDir(k) {
      const I = api.input;
      let up, down;
      if (mode === 'cpu' && k === 0) { up = I.anyDown('KeyW', 'ArrowUp'); down = I.anyDown('KeyS', 'ArrowDown'); }
      else if (k === 0) { up = I.isDown('KeyW'); down = I.isDown('KeyS'); }
      else { up = I.isDown('ArrowUp'); down = I.isDown('ArrowDown'); }
      return (down ? 1 : 0) - (up ? 1 : 0);
    }
    function controls(dt) {
      const lead0 = score[0] - score[1];
      for (let k = 0; k < 2; k++) {
        let dir = 0, sp = PAD_SPEED;
        const ai = state === 'demo' ? demoAI[k] : (testAI[k] || (k === 1 && mode === 'cpu' ? cpuAI : null));
        if (finished) dir = 0;
        else if (ai) { const r = aiControl(ai, w, dt, k === 0 ? lead0 : -lead0); dir = r.dir; sp = r.sp; }
        else dir = humanDir(k);
        movePad(w.pads[k], dir, sp, dt);
      }
    }
    /* ---------- スペシャルモード: つぎの パックを きめる ---------- */
    function pickType() {
      if (forceType) return forceType;
      if (!special || finished) return 'normal';
      if (score[0] + score[1] < 1) return 'normal';          // 最初の1点までは ふつうのパックだけ
      // R5：ふつうのパックばかり つづかないように。NORMAL_RUN_MAX 回つづいたら かならず 特殊を出す
      if (normalRun < NORMAL_RUN_MAX && rand() >= SPECIAL_P) return 'normal';
      const list = [];
      let total = 0;
      for (const key in SPECIAL_W) {
        if (key === 'gold') {
          // ゴールドは 1試合2回まで / どちらかが あと1点のときは 出さない / 続けては 出さない
          if (goldUsed >= GOLD_MAX) continue;
          if (score[0] >= WIN_SCORE - 1 || score[1] >= WIN_SCORE - 1) continue;
          if (lastSpecial === 'gold') continue;
        }
        let wgt = SPECIAL_W[key];
        if (key === lastSpecial) wgt *= 0.5;                  // 同じのが 続きにくいように
        total += wgt;
        list.push([key, total]);
      }
      if (!total) return 'normal';
      const r = rand() * total;
      for (let i = 0; i < list.length; i++) if (r < list[i][1]) return list[i][0];
      return 'normal';
    }
    // パックの種類を 物理に反映（normal なら w.mod は null ＝ ふつうの処理だけを通る）
    function applyType(t) {
      const d = PUCK[t] || PUCK.normal;
      pk.type = t;
      w.accel = tune.accel || d.accel;
      w.typeCap = d.cap;
      w.maxSp = overtime ? Math.min(OT_MAX, d.cap + OT_RAMP * otLive) : d.cap;
      w.mod = t === 'normal' ? null
        : { curve: d.curve || 0, wave: d.wave || 0, waveF: d.waveF || 2, wallKick: d.wallKick || 1, edge: d.edge || 1, cdir: rand() < 0.5 ? -1 : 1, t: 0, flip: !!d.flip };
      return d;
    }
    function resetForServe() {
      state = 'count'; st = 0; countIdx = -1;
      pk.x = CX; pk.y = CY; pk.vx = 0; pk.vy = 0; pk.sp = SERVE_SPEED; pk.live = false; pk.inNet = false;
      pk.type = 'normal';
      w.mod = null;
      trail.length = 0;
      puckScale = 0; puckTarget = 1;
      w.lastHit = -1;
      rally = 0;
      serveAng = (12 + rand() * 16) * DEG * (rand() < 0.5 ? -1 : 1);
      if (!finished) { setMood(0, 'normal', 0); setMood(1, 'normal', 0); }
      // つぎの パックを きめて、特殊なら サーブの前に かならず 予告を出す
      nextType = pickType();
      if (nextType !== 'normal') {
        countLen = COUNT_TIME + TELL_LEAD;
        tellType = nextType; tellT = countLen;
        specialLog.push({ type: nextType, tell: clock, live: -1 });
        api.sfx('whoosh');
        api.audio.tone({ f: 520, f2: 1040, dur: 0.3, type: 'triangle', vol: 0.12 });
      } else {
        countLen = COUNT_TIME;
        tellType = ''; tellT = 0;
      }
    }
    function serve() {
      const dir = serveTo === 0 ? -1 : 1;
      const d = applyType(nextType);
      if (nextType === 'normal') {
        normalRun++;                       // ふつうのパックが 何回つづいたか
      } else {
        normalRun = 0;
        lastSpecial = nextType;
        if (nextType === 'gold') goldUsed++;
        for (let i = specialLog.length - 1; i >= 0; i--) if (specialLog[i].live < 0) { specialLog[i].live = clock; break; }
      }
      const sp = d.serve;
      pk.x = CX; pk.y = CY;
      pk.sp = sp;
      pk.vx = Math.cos(serveAng) * sp * dir;
      pk.vy = Math.sin(serveAng) * sp;
      pk.live = true;
      puckScale = 1;
      w.lastHit = -1;
      w.serveCount++;
      rally = 0;
      state = 'live'; st = 0; goT = 0.7;
      api.sfx('go');
      tellT = 0;
    }
    function onGoal(scorer) {
      if (state !== 'live' || finished) return;   // 二重に点が入らないように
      state = 'goal'; st = 0; goT = 0;
      const loser = 1 - scorer;
      const pts = (PUCK[pk.type] || PUCK.normal).pts;
      lastPts = pts;
      score[scorer] += pts;
      goalCount++;
      pointCount += pts;
      lastScorer = scorer;
      serveTo = loser;
      pk.live = false;
      pk.inNet = true;
      w.mod = null;                               // ネットの中では 特殊な物理を 切る
      net[loser].t = 9; net[loser].y = pk.y;
      setMood(scorer, 'happy', GOAL_TIME);
      setMood(loser, 'sad', GOAL_TIME);
      cheer[scorer] = 1; cheer[loser] = Math.max(cheer[loser], 0.25);
      bump[scorer] = 1;
      shakeT = 0.25;
      confettiBurst(scorer, pts > 1 ? 100 : 60, pts > 1 ? 100 : 60);
      api.sfx('goal');
      api.audio.noise({ dur: 1.2, vol: 0.07, f: 1300, f2: 700, q: 0.4, attack: 0.08 });
      if (pts > 1) {
        api.sfx('coin');
        api.audio.tone({ f: 784, f2: 1568, dur: 0.35, type: 'square', vol: 0.1, delay: 0.1 });
      }
      if (score[scorer] >= WIN_SCORE || overtime) endMatch(scorer, overtime ? 'ot' : 'goal');
    }
    function timeUp() {
      pk.live = false;
      goT = 0;
      puckTarget = 0;
      api.sfx('finish');
      if (score[0] !== score[1]) {
        state = 'over'; st = 0;
        endMatch(score[0] > score[1] ? 0 : 1, 'time');
      } else {
        overtime = true;
        state = 'ot'; st = 0;
        serveTo = rand() < 0.5 ? 0 : 1;
        cheer[0] = cheer[1] = 0.7;
        api.sfx('whoosh');
      }
    }
    function endMatch(win, reason) {
      if (finished) return;
      finished = true;
      winner = win;
      endReason = reason;
      finishCount++;
      proWin = mode === 'cpu' && cpuLv === 4 && win === 0;
      const lvName = CPU_NAME[cpuLv - 1];
      const names = mode === 'cpu' ? ['あお（あなた）', 'ピンク（CPU ' + lvName + '）'] : ['あお（1P）', 'ピンク（2P）'];
      let sub = 'いちばん長いラリー: ' + maxRally + '回';
      if (reason === 'time') sub += '<br>タイムアップ！ 点の多いほうの かち';
      else if (reason === 'ot') sub += '<br>えんちょうせんで けっちゃく！';
      if (mode === 'cpu' && win === 0) sub += '<br>CPU「' + lvName + '」に かった！';
      if (mode === 'cpu' && win === 1) sub += '<br>つぎは かてるかな？';
      if (special) sub += '<br>スペシャルモード';
      setMood(win, 'win', 999);
      setMood(1 - win, 'sad', 999);
      cheer[win] = 1;
      winSfxT = 0.9;
      rainT = proWin ? 7 : 4;
      winFx = 1; winT = 0;
      confettiBurst(win, proWin ? 160 : 90, proWin ? 200 : 110);
      if (proWin) {
        api.sfx('newrecord');
        [523, 659, 784, 1047, 1319].forEach(function (f, i) {
          api.audio.tone({ f: f, dur: 0.22, type: 'triangle', vol: 0.13, delay: 0.9 + i * 0.11 });
        });
      }
      lastResult = {
        ribbon: proWin ? 'でんせつの しょうり' : 'しあい しゅうりょう',
        headline: proWin ? 'プロに かった！！' : names[win] + 'の かち！',
        // 大きい数字は あくまで 試合結果。score は クリア者リスト用の 0/1 なので 表示には出さない
        big: score[0] + ' - ' + score[1],
        sub: sub,
        // score: プロ戦で 人（1P）が かったときだけ 1。それ以外は 0（クリア者リストに のらない）
        score: proWin ? 1 : 0,
        delay: proWin ? 3400 : 2600,
      };
      api.finish(lastResult);
    }
    function puckNet(dt) {
      if (!pk.inNet) return;
      pk.x += pk.vx * dt; pk.y += pk.vy * dt;
      const damp = Math.exp(-5 * dt);
      pk.vx *= damp; pk.vy *= damp;
      if (pk.y < FY0 + PR) { pk.y = FY0 + PR; pk.vy = Math.abs(pk.vy) * 0.4; }
      if (pk.y > FY1 - PR) { pk.y = FY1 - PR; pk.vy = -Math.abs(pk.vy) * 0.4; }
      const side = pk.x < CX ? 0 : 1;
      const back = side === 0 ? FX0 - NET + PR + 6 : FX1 + NET - PR - 6;
      if ((side === 0 && pk.x < back) || (side === 1 && pk.x > back)) {
        const v = Math.abs(pk.vx);
        pk.x = back;
        pk.vx = -pk.vx * 0.15;
        if (v > 60) { net[side].a = Math.min(34, v * 0.035); net[side].t = 0; net[side].y = pk.y; }
      }
    }
    function trailPush() {
      trail.push(pk.x, pk.y);
      if (trail.length > 32) trail.splice(0, trail.length - 32);
    }
    function demoUpdate(dt) {
      controls(dt);
      if (!pk.live) {
        demoWait -= dt;
        if (demoWait <= 0) {
          const a = (15 + rand() * 18) * DEG * (rand() < 0.5 ? -1 : 1), d = rand() < 0.5 ? -1 : 1;
          pk.x = CX; pk.y = CY; pk.sp = DEMO_SPEED;
          pk.vx = Math.cos(a) * DEMO_SPEED * d; pk.vy = Math.sin(a) * DEMO_SPEED;
          pk.live = true; puckScale = 1; w.lastHit = -1; w.serveCount++;
        }
        return;
      }
      const sc = stepPuck(w, dt, cb);
      trailPush();
      if (sc >= 0) { pk.live = false; pk.x = CX; pk.y = CY; trail.length = 0; puckScale = 0; demoWait = 1.0; }
    }

    function fxUpdate(dt) {
      for (let k = 0; k < 2; k++) {
        const f = padFx[k];
        if (f.moodT > 0) { f.moodT -= dt; if (f.moodT <= 0) f.mood = 'normal'; }
        f.squash = Math.max(0, f.squash - dt * 5);
        f.blinkT -= dt;
        if (f.blinkT < -0.12) f.blinkT = 2 + rand() * 2.5;
        bump[k] = Math.max(0, bump[k] - dt * 1.6);
        cheer[k] = Math.max(0, cheer[k] - dt * 0.4);
        net[k].t += dt;
      }
      if (finished && state === 'over') cheer[winner] = 1;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= dt;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        if (!p.ring) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.exp(-4 * dt); p.vy *= Math.exp(-4 * dt); }
      }
      for (let i = confetti.length - 1; i >= 0; i--) {
        const c = confetti[i];
        c.life -= dt;
        c.vy = Math.min(c.vy + 520 * dt, 230);
        c.vx *= Math.exp(-1.6 * dt);
        c.x += (c.vx + Math.sin(clock * 3 + c.flip) * 40) * dt;
        c.y += c.vy * dt;
        c.rot += c.vr * dt;
        c.flip += dt * 7;
        if (c.life <= 0 || c.y > H + 30) confetti.splice(i, 1);
      }
      for (let i = pops.length - 1; i >= 0; i--) { pops[i].t += dt; if (pops[i].t >= pops[i].dur) pops.splice(i, 1); }
      if (rainT > 0) {
        rainT -= dt;
        if (Math.floor((rainT + dt) / 0.15) !== Math.floor(rainT / 0.15)) confettiBurst(winner, 0, 5);
      }
      shakeT = Math.max(0, shakeT - dt);
      goT = Math.max(0, goT - dt);
      if (tellT > 0) tellT = Math.max(0, tellT - dt);
      if (winFx > 0) winFx = Math.max(0, winFx - dt * 0.33);
      if (winT >= 0) winT += dt;
      secPulse = Math.max(0, secPulse - dt * 2.5);
      rallyPop = Math.max(0, rallyPop - dt * 3);
      wallSndT -= dt; hitSndT -= dt;
      puckScale += (puckTarget - puckScale) * Math.min(1, dt * 10);
      if (Math.abs(puckTarget - puckScale) < 0.01) puckScale = puckTarget;
      puckSpin += dt * (pk.live ? (pk.vx > 0 ? 1 : -1) * pk.sp / 150 : 0.6);
    }

    function update(dt) {
      clock += dt; st += dt;
      fxUpdate(dt);
      if (state === 'demo') { demoUpdate(dt); return; }
      if (state === 'count') {
        controls(dt);
        // 特殊パックのときは 先に 予告を見せてから 3・2・1（予告は かならず 効果より前）
        const ct = st - (countLen - COUNT_TIME);
        const i = Math.floor(ct / COUNT_STEP);
        if (ct >= 0 && i !== countIdx && i < 3) { countIdx = i; api.sfx('count'); }
        if (st >= countLen) serve();
      } else if (state === 'live') {
        controls(dt);
        const sc = stepPuck(w, dt, cb);
        trailPush();
        if (sc >= 0) onGoal(sc);
        else if (overtime) {
          otLive += dt;
          w.maxSp = Math.min(OT_MAX, w.typeCap + OT_RAMP * otLive);
        } else {
          timeLeft -= dt;
          const sec = Math.ceil(timeLeft);
          if (sec !== lastSec) { lastSec = sec; if (sec <= 10 && sec > 0) { api.sfx('tick'); secPulse = 1; } }
          if (timeLeft <= 0) { timeLeft = 0; timeUp(); }
        }
      } else if (state === 'goal') {
        controls(dt);
        puckNet(dt);
        if (st >= GOAL_TIME) {
          if (finished) { state = 'over'; st = 0; } else resetForServe();
        }
      } else if (state === 'ot') {
        controls(dt);
        if (st >= OT_TIME) resetForServe();
      } else if (state === 'over') {
        controls(dt);
        puckNet(dt);
      }
      if (winSfxT > 0) { winSfxT -= dt; if (winSfxT <= 0) api.sfx('win'); }
    }

    // 葉の id（2p-normal / 2p-special / cpu-1..4）を読む。
    // エンジンの 2段メニューが入る前は 親の id（2p / cpu）が来ることがあるので、それも受ける
    function parseMode(id) {
      const s = String(id || '2p-normal');
      // R4：CPU と スペシャル（cpusp-1..4）。'cpu' より先に見る
      if (s.indexOf('cpusp') === 0) {
        const n = parseInt(s.slice(6), 10);
        const lv = isFinite(n) ? clamp(n, 1, 4) : 1;
        return { mode: 'cpu', special: true, lv: lv, id: 'cpusp-' + lv };
      }
      if (s.indexOf('cpu') === 0) {
        const n = parseInt(s.slice(4), 10);
        return { mode: 'cpu', special: false, lv: isFinite(n) ? clamp(n, 1, 4) : 1, id: 'cpu-' + (isFinite(n) ? clamp(n, 1, 4) : 1) };
      }
      const sp = s.indexOf('special') >= 0;
      return { mode: '2p', special: sp, lv: 1, id: sp ? '2p-special' : '2p-normal' };
    }
    function start(opts) {
      const m = parseMode(opts && opts.mode);
      mode = m.mode; special = m.special; cpuLv = m.lv; modeId = m.id;
      w.accel = HIT_ACCEL;
      w.typeCap = MAX_SPEED;
      w.mod = null;
      pk.type = 'normal';
      score[0] = score[1] = 0;
      timeLeft = MATCH_TIME; overtime = false; otLive = 0; w.maxSp = MAX_SPEED;
      rally = 0; maxRally = 0;
      finished = false; winner = -1; endReason = ''; goalCount = 0; pointCount = 0; finishCount = 0; lastScorer = -1;
      winSfxT = -1; rainT = 0; lastSec = 999; goT = 0;
      nextType = 'normal'; goldUsed = 0; lastSpecial = ''; lastPts = 1; normalRun = 0;
      tellT = 0; tellType = ''; specialLog.length = 0;
      proWin = false; winFx = 0; winT = -1; lastResult = null; countLen = COUNT_TIME;
      for (let k = 0; k < 2; k++) {
        const p = w.pads[k];
        p.y = p.prevY = p.cy = CY; p.vy = 0;
        padFx[k].mood = 'normal'; padFx[k].moodT = 0;
        cheer[k] = 0; bump[k] = 0; net[k].t = 9;
      }
      parts.length = 0; confetti.length = 0; pops.length = 0;
      cpuAI = makeAI('cpu', 1, rand, cpuLv, tune.cpu || null);
      if (tune.accel) w.accel = tune.accel;
      serveTo = mode === 'cpu' ? 0 : (rand() < 0.5 ? 0 : 1);
      resetForServe();
    }

    /* ---------- 描画 ---------- */
    function drawPuckAll(g) {
      if (puckScale <= 0.01) return;
      const f = clamp((pk.sp - SERVE_SPEED) / (MAX_SPEED - SERVE_SPEED), 0, 1);
      const sp2 = pk.type !== 'normal' ? PUCK[pk.type] : null;
      if (pk.live && trail.length >= 4) {
        const n = trail.length / 2;
        const hue = (48 - f * 62 + 360) % 360;
        for (let i = 0; i < n - 1; i++) {
          const u = (i + 1) / n;
          if (sp2) {
            g.globalAlpha = 0.3 * u;
            g.fillStyle = sp2.col;
            circ(g, trail[i * 2], trail[i * 2 + 1], PR * (0.35 + 0.6 * u)); g.fill();
            g.globalAlpha = 1;
            continue;
          }
          g.fillStyle = 'hsla(' + hue + ',100%,60%,' + (0.3 * u).toFixed(3) + ')';
          circ(g, trail[i * 2], trail[i * 2 + 1], PR * (0.35 + 0.6 * u)); g.fill();
        }
        if (f > 0.4) {
          const m = Math.hypot(pk.vx, pk.vy) || 1, ux = pk.vx / m, uy = pk.vy / m;
          g.strokeStyle = 'rgba(255,255,255,' + (0.7 * (f - 0.3)).toFixed(3) + ')';
          g.lineWidth = 4; g.lineCap = 'round';
          g.beginPath();
          for (let s = -1; s <= 1; s++) {
            const ox = -uy * s * 16, oy = ux * s * 16, len = 50 + f * 50 - Math.abs(s) * 18;
            g.moveTo(pk.x - ux * (PR + 6) + ox, pk.y - uy * (PR + 6) + oy);
            g.lineTo(pk.x - ux * (PR + 6 + len) + ox, pk.y - uy * (PR + 6 + len) + oy);
          }
          g.stroke();
        }
      }
      drawPuck(g, pk.x, pk.y, PR, puckSpin, puckScale, { type: pk.type, dir: pk.vx >= 0 ? 1 : -1, t: clock });
    }
    function drawHints(g) {
      let a = 0;
      if (state === 'count') a = Math.min(1, st / 0.2);
      else if (state === 'live' && st < 0.5) a = 1 - st / 0.5;
      if (a <= 0) return;
      for (let k = 0; k < 2; k++) {
        const p = w.pads[k];
        const bob = Math.sin(clock * 6) * 4;
        const isCpu = (mode === 'cpu' && k === 1) || testAI[k];
        if (isCpu) {
          g.save(); g.globalAlpha = a;
          RR(g, p.x - 58, p.y - PAD_HALF - 82, 116, 54, 27); g.fillStyle = TEAM[k].line; g.fill();
          TX(g, 'CPU', p.x, p.y - PAD_HALF - 54, { size: 36, color: '#ffffff' });
          g.restore();
          continue;
        }
        const up = k === 0 ? (mode === 'cpu' ? ['W', '↑'] : ['W']) : ['↑'];
        const dn = k === 0 ? (mode === 'cpu' ? ['S', '↓'] : ['S']) : ['↓'];
        const yU = p.y - PAD_HALF - 72 - bob, yD = p.y + PAD_HALF + 52 + bob;
        for (let i = 0; i < up.length; i++) drawKeyCap(g, p.x + (i - (up.length - 1) / 2) * 76, yU, up[i], k, a);
        for (let i = 0; i < dn.length; i++) drawKeyCap(g, p.x + (i - (dn.length - 1) / 2) * 76, yD, dn[i], k, a);
      }
    }
    function drawServeArrow(g) {
      if (state !== 'count' || puckScale < 0.5) return;
      const dir = serveTo === 0 ? -1 : 1;
      const ux = Math.cos(serveAng) * dir, uy = Math.sin(serveAng);
      const pulse = (st * 2) % 1;
      g.save();
      g.translate(CX, CY);
      g.rotate(Math.atan2(uy, ux));
      g.fillStyle = TEAM[serveTo].main;
      g.strokeStyle = '#ffffff'; g.lineWidth = 4; g.lineJoin = 'round';
      g.lineWidth = 5;
      for (let i = 0; i < 3; i++) {
        const x = 50 + i * 40 + pulse * 12;
        g.globalAlpha = 0.95 - i * 0.25;
        g.beginPath(); g.moveTo(x, -26); g.lineTo(x + 30, 0); g.lineTo(x, 26); g.lineTo(x + 10, 0); g.closePath();
        g.stroke(); g.fill();
      }
      g.restore();
    }
    function drawRally(g) {
      if (state !== 'live' || rally < 2) return;
      // ラリーが のびるほど 色が かわって もりあがる（むらさき → オレンジ → 赤＋ほのお）
      const hot = clamp((rally - 4) / 10, 0, 1);
      const col = rally >= 14 ? '#e8380a' : (rally >= 8 ? '#ef7a12' : '#7a4fc8');
      const line = rally >= 14 ? '#ff9a2e' : (rally >= 8 ? '#ffc46b' : '#cdbbf0');
      const sc = (1 + rallyPop * 0.25) * (1 + hot * 0.22);
      g.save();
      g.translate(CX, FY1 - 6);
      g.scale(sc, sc);
      if (hot > 0) {
        g.globalAlpha = 0.3 + 0.3 * Math.sin(clock * 9);
        circ(g, 0, 0, 100 + hot * 34); g.fillStyle = line; g.fill();
        g.globalAlpha = 1;
      }
      RR(g, -110, -27, 220, 54, 27); g.fillStyle = 'rgba(255,255,255,0.92)'; g.fill();
      g.lineWidth = 4 + hot * 3; g.strokeStyle = line; g.stroke();
      TX(g, 'ラリー ' + rally, 0, 2, { size: 36, color: col });
      if (rally >= 14) {
        // ほのお（色だけに たよらない めじるし）
        for (let s = -1; s <= 1; s += 2) {
          const fx = s * 126, h = 30 + Math.sin(clock * 11 + s) * 7;
          g.beginPath();
          g.moveTo(fx, 16);
          g.quadraticCurveTo(fx + 15, 2, fx + 5, -h);
          g.quadraticCurveTo(fx + 2, -h * 0.45, fx - 4, -h * 0.75);
          g.quadraticCurveTo(fx - 16, -h * 0.2, fx, 16);
          g.closePath();
          g.fillStyle = '#ff8a1f'; g.fill();
        }
      }
      g.restore();
    }
    /* ---------- スペシャル: 予告バナー / いま出ているパックの名まえ ---------- */
    function drawTell(g) {
      if (tellT <= 0 || !tellType) return;
      const d = PUCK[tellType];
      const u = clamp((countLen - st) / countLen, 0, 1);
      const inS = easeOutBack(clamp((countLen - tellT + 0.0001) / 0.3, 0, 1));
      const a = u < 0.12 ? u / 0.12 : 1;
      const wob = Math.sin(clock * 6) * 0.02;
      g.save();
      g.globalAlpha = clamp(a, 0, 1);
      g.translate(CX, 300);
      g.scale(inS * (1 + wob), inS * (1 + wob));
      RR(g, -540, -66, 1080, 132, 50); g.fillStyle = 'rgba(70,40,120,0.25)'; g.fill();
      RR(g, -540, -74, 1080, 132, 50); g.fillStyle = '#ffffff'; g.fill();
      g.lineWidth = 8; g.strokeStyle = d.col; g.stroke();
      drawPuck(g, -440, -8, 40, clock * 3, 1, { type: tellType, dir: 1, t: clock });
      TX(g, 'つぎは ' + d.name + '！', -370, -36, { size: 48, color: d.col2, align: 'left' });
      TX(g, d.tell, -370, 22, { size: 38, color: '#5b4a7a', align: 'left' });
      g.restore();
    }
    function drawPuckTag(g) {
      if (state !== 'live' || pk.type === 'normal') return;
      const d = PUCK[pk.type];
      g.save();
      g.translate(CX, FY0 + 44);
      RR(g, -200, -32, 400, 64, 32); g.fillStyle = 'rgba(255,255,255,0.92)'; g.fill();
      g.lineWidth = 5; g.strokeStyle = d.col; g.stroke();
      drawPuck(g, -160, 0, 20, clock * 3, 1, { type: pk.type, dir: 1, t: clock });
      TX(g, d.name, 20, 2, { size: 36, color: d.col2 });
      g.restore();
    }
    function drawHud(g) {
      const bx = CX, y0 = 10;
      RR(g, bx - 380, y0 + 10, 760, 160, 46); g.fillStyle = 'rgba(80,50,130,0.22)'; g.fill();
      RR(g, bx - 380, y0, 760, 160, 46); g.fillStyle = '#ffffff'; g.fill();
      g.lineWidth = 6; g.strokeStyle = '#dccff3'; g.stroke();
      for (let k = 0; k < 2; k++) {
        const tm = TEAM[k];
        const cx = bx + (k === 0 ? -210 : 210);
        const px = cx - 150, py = y0 + 12;
        RR(g, px, py, 300, 136, 34);
        const gr = g.createLinearGradient(0, py, 0, py + 136);
        gr.addColorStop(0, tm.top); gr.addColorStop(1, tm.bot);
        g.fillStyle = gr; g.fill();
        RR(g, px + 12, py + 7, 276, 36, 18); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fill();
        const label = k === 0 ? (mode === 'cpu' ? 'あお（あなた）' : '1P あお') : (mode === 'cpu' ? 'CPU ' + CPU_NAME[cpuLv - 1] : '2P ピンク');
        TX(g, label, cx, py + 30, { size: 34, color: '#ffffff', stroke: tm.line, strokeWidth: 8 });
        const b = bump[k];
        const s = 1 + Math.sin(b * Math.PI) * 0.45 * b;
        g.save(); g.translate(cx, py + 92); g.scale(s, s);
        TX(g, String(score[k]), 0, 0, { size: 92, color: '#ffffff', stroke: tm.line, strokeWidth: 14 });
        g.restore();
        if (!overtime && !finished && state !== 'demo' && score[k] === WIN_SCORE - 1) {
          const bx2 = bx + (k === 0 ? -250 : 250);
          const wob = Math.sin(clock * 5) * 3;
          RR(g, bx2 - 96, y0 + 158 + wob, 192, 52, 26); g.fillStyle = tm.main; g.fill();
          g.lineWidth = 4; g.strokeStyle = '#ffffff'; g.stroke();
          TX(g, 'あと1点！', bx2, y0 + 186 + wob, { size: 34, color: '#ffffff', stroke: tm.line, strokeWidth: 6 });
        }
      }
      TX(g, '-', bx, y0 + 84, { size: 84, color: '#7a68a0' });
      // のこり時間
      if (overtime) {
        const s = 1 + Math.sin(clock * 4) * 0.03;
        g.save(); g.translate(bx, y0 + 190); g.scale(s, s);
        RR(g, -250, -32, 500, 64, 32); g.fillStyle = '#f3e8ff'; g.fill();
        g.lineWidth = 5; g.strokeStyle = '#b07cff'; g.stroke();
        TX(g, 'えんちょう！ つぎの1点で かち', 0, 2, { size: 34, color: '#7a3fd0' });
        g.restore();
      } else {
        const sec = Math.max(0, Math.ceil(timeLeft));
        const mm = Math.floor(sec / 60), ss = sec % 60;
        const hurry = sec <= 10 && state !== 'demo';
        const s = 1 + secPulse * 0.12;
        g.save(); g.translate(bx, y0 + 190); g.scale(s, s);
        RR(g, -140, -32, 280, 64, 32); g.fillStyle = hurry ? '#fff0de' : '#ffffff'; g.fill();
        g.lineWidth = 5; g.strokeStyle = hurry ? '#ff9a2e' : '#dccff3'; g.stroke();
        TX(g, 'のこり ' + mm + ':' + (ss < 10 ? '0' : '') + ss, 0, 2, { size: 40, color: hurry ? '#e8630a' : '#4b3b6b' });
        g.restore();
      }
    }
    function drawMessages(g) {
      if (state === 'count') {
        const ct = st - (countLen - COUNT_TIME);
        if (ct >= 0) {
          const i = Math.min(2, Math.floor(ct / COUNT_STEP));
          const u = (ct - i * COUNT_STEP) / COUNT_STEP;
          const sc = 1.5 - 0.5 * easeOutBack(u * 2.4);
          bigText(g, String(3 - i), CX, 430, 230, '#ffffff', '#7a5cc0', sc, u > 0.8 ? 1 - (u - 0.8) * 3 : 1);
        }
        if (overtime) bigText(g, 'つぎの1点で かち！', CX, 790, 62, '#7a3fd0', '#ffffff', 1, 1);
        else if (score[0] + score[1] === 0) bigText(g, 'あいての ゴールに 入れよう！', CX, 790, 58, '#6a4bc0', '#ffffff', 1, 1);
      }
      if (goT > 0) {
        const u = 1 - goT / 0.7;
        bigText(g, 'ゴー！', CX, 430, 180, '#ffe14d', '#ff8a1f', 0.7 + 0.3 * easeOutBack(u * 3), goT < 0.25 ? goT / 0.25 : 1);
      }
      if (state === 'goal' && lastScorer >= 0) {
        const tm = TEAM[lastScorer];
        const sc = easeOutBack(st / 0.35) * (1 + Math.sin(st * 6) * 0.03);
        const a = st > GOAL_TIME - 0.3 ? (GOAL_TIME - st) / 0.3 : 1;
        bigText(g, 'ゴール！', CX, 480, 220, tm.main, '#ffffff', sc, a, Math.sin(st * 5) * 0.03);
        if (lastPts > 1) {
          bigText(g, 'ゴールドパック！ ' + tm.name + 'に 2点！', CX, 650, 72, '#e08800', '#ffffff', easeOutBack((st - 0.15) / 0.3), a);
          bigText(g, '＋2', CX, 800, 130, '#ffd23f', '#c57a00', easeOutBack((st - 0.3) / 0.35) * (1 + Math.sin(st * 9) * 0.05), a);
        } else {
          bigText(g, tm.name + 'に 1点！', CX, 650, 70, tm.line, '#ffffff', easeOutBack((st - 0.15) / 0.3), a);
        }
      }
      if (state === 'ot') {
        const a = st > OT_TIME - 0.3 ? (OT_TIME - st) / 0.3 : 1;
        bigText(g, 'じかん ぎれ！', CX, 380, 70, '#6a4bc0', '#ffffff', easeOutBack(st / 0.3), a);
        bigText(g, 'えんちょう！', CX, 520, 190, '#c08cff', '#ffffff', easeOutBack((st - 0.2) / 0.35), a, Math.sin(st * 5) * 0.03);
        bigText(g, 'つぎの1点で かち！', CX, 680, 72, '#7a3fd0', '#ffffff', easeOutBack((st - 0.4) / 0.3), a);
      }
      if (state === 'over' && endReason === 'time' && st < 1.9) {
        const a = st > 1.6 ? (1.9 - st) / 0.3 : 1;
        bigText(g, 'タイムアップ！', CX, 500, 190, '#ffe14d', '#ff8a1f', easeOutBack(st / 0.35), a);
      }
      // 勝ちが決まった瞬間から（ゴール演出中も）出す。結果パネルが出るまで ずっと見える
      if (finished && winner >= 0 && winT >= 0) drawWinBanner(g);
    }
    // 勝利の 帯（紙吹雪のうえに もう一段 うれしく）。プロに勝ったときは 専用の金色バージョン
    function drawWinBanner(g) {
      const tm = TEAM[winner];
      const u = clamp(winT / 0.45, 0, 1);
      const sc = easeOutBack(u);
      if (sc <= 0.01) return;
      const col = proWin ? '#ffd23f' : tm.main, col2 = proWin ? '#c57a00' : tm.line;
      g.save();
      g.translate(CX, 300);
      g.scale(sc, sc);
      // うしろの 光の輪
      g.save();
      g.rotate(clock * 0.5);
      g.globalAlpha = 0.3;
      g.fillStyle = col;
      for (let i = 0; i < 12; i++) {
        g.save(); g.rotate(i * TAU / 12);
        g.beginPath(); g.moveTo(0, -26); g.lineTo(470 + Math.sin(clock * 4 + i) * 26, 0); g.lineTo(0, 26); g.closePath(); g.fill();
        g.restore();
      }
      g.restore();
      // 帯
      RR(g, -500, -62, 1000, 124, 62); g.fillStyle = 'rgba(70,40,120,0.25)'; g.fill();
      RR(g, -500, -70, 1000, 124, 62); g.fillStyle = '#ffffff'; g.fill();
      g.lineWidth = 9; g.strokeStyle = col; g.stroke();
      // トロフィー
      g.save();
      g.translate(-392, -10 + Math.sin(clock * 5) * 4);
      g.fillStyle = col; g.strokeStyle = col2; g.lineWidth = 4; g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(-26, -34); g.lineTo(26, -34); g.lineTo(21, 2);
      g.quadraticCurveTo(0, 24, -21, 2); g.closePath(); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(-26, -26); g.quadraticCurveTo(-48, -22, -32, -2); g.stroke();
      g.beginPath(); g.moveTo(26, -26); g.quadraticCurveTo(48, -22, 32, -2); g.stroke();
      RR(g, -7, 20, 14, 16, 4); g.fill(); g.stroke();
      RR(g, -24, 34, 48, 14, 7); g.fill(); g.stroke();
      star4(g, 0, -12, 11); g.fillStyle = '#fff'; g.fill();
      g.restore();
      const txt = proWin ? 'プロに かった！！' : tm.name + 'の かち！';
      TX(g, txt, 20, -8, { size: proWin ? 78 : 84, color: col2, stroke: '#ffffff', strokeWidth: 12 });
      g.restore();
      if (proWin) {
        // 王かん（レアな達成感）
        const p = w.pads[0];
        const hy = p.y - PAD_HALF - 66 + Math.sin(clock * 4) * 5;
        g.save();
        g.translate(p.x, hy);
        g.rotate(Math.sin(clock * 2.4) * 0.1);
        g.fillStyle = '#ffd23f'; g.strokeStyle = '#c57a00'; g.lineWidth = 4; g.lineJoin = 'round';
        g.beginPath();
        g.moveTo(-38, 14); g.lineTo(-30, -34); g.lineTo(-10, -4); g.lineTo(0, -44);
        g.lineTo(10, -4); g.lineTo(30, -34); g.lineTo(38, 14); g.closePath();
        g.fill(); g.stroke();
        g.fillStyle = '#ff6fa6';
        circ(g, 0, 2, 6); g.fill();
        g.restore();
      }
    }
    function drawParts(g) {
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const u = clamp(p.life / p.max, 0, 1);
        g.globalAlpha = u;
        if (p.ring) {
          circ(g, p.x, p.y, p.size + (1 - u) * 40);
          g.lineWidth = 5 * u + 1; g.strokeStyle = p.color; g.stroke();
        } else if (p.star) {
          g.fillStyle = p.color; star4(g, p.x, p.y, p.size * (0.5 + u * 0.7)); g.fill();
        } else {
          g.fillStyle = p.color; circ(g, p.x, p.y, p.size * (0.4 + u * 0.6)); g.fill();
        }
      }
      g.globalAlpha = 1;
      for (let i = 0; i < pops.length; i++) {
        const p = pops[i];
        const u = p.t / p.dur;
        const a = u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1;
        const sc = easeOutBack(Math.min(1, u * 4));
        g.save();
        g.globalAlpha = clamp(a, 0, 1);
        g.translate(p.x, p.y - u * p.rise);
        g.scale(sc, sc);
        TX(g, p.text, 0, 0, { size: p.size, color: p.color, stroke: p.stroke, strokeWidth: Math.max(7, p.size * 0.16) });
        g.restore();
      }
    }
    function drawConfetti(g) {
      for (let i = 0; i < confetti.length; i++) {
        const c = confetti[i];
        g.save();
        g.translate(c.x, c.y);
        g.rotate(c.rot);
        g.scale(Math.abs(Math.cos(c.flip)) * 0.8 + 0.2, 1);
        g.globalAlpha = Math.min(1, c.life);
        g.fillStyle = c.c;
        g.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
        g.restore();
      }
    }

    function draw(g) {
      g.save();
      g.fillStyle = '#efe6fb';
      g.fillRect(0, 0, W, H);
      if (shakeT > 0) { const m = 7 * shakeT / 0.25; g.translate(Math.sin(clock * 97) * m, Math.cos(clock * 71) * m); }
      g.drawImage(getStatic(g), 0, 0, W, H);
      // 観客
      g.save();
      g.beginPath(); g.rect(0, 0, W, 216); g.clip();
      for (let i = 0; i < fans.length; i++) drawFan(g, fans[i], clock, cheer[fans[i].side]);
      g.restore();
      // ネット（ゴールに入ったパックは ネットの うしろ）
      if (pk.inNet) drawPuckAll(g);
      for (let k = 0; k < 2; k++) {
        const n = net[k];
        drawNet(g, k, n.a * Math.exp(-5 * n.t) * Math.cos(n.t * 13), n.y);
      }
      // パックが向かっているゴールを うっすら光らせる
      if (pk.live) {
        const k = pk.vx < 0 ? 0 : 1, gx = k === 0 ? FX0 : FX1;
        const d = Math.abs(pk.x - gx);
        if (d < 700) {
          const a = (1 - d / 700) * 0.32;
          const gr = g.createLinearGradient(gx, 0, gx + (k === 0 ? 220 : -220), 0);
          gr.addColorStop(0, 'rgba(' + TEAM[k].tint + ',' + a.toFixed(3) + ')');
          gr.addColorStop(1, 'rgba(' + TEAM[k].tint + ',0)');
          g.fillStyle = gr;
          g.fillRect(k === 0 ? gx : gx - 220, FY0, 220, FY1 - FY0);
        }
      }
      drawRally(g);
      drawPuckTag(g);
      // キャラクター
      for (let k = 0; k < 2; k++) {
        const p = w.pads[k], f = padFx[k];
        const dx = pk.x - p.x, dy = pk.y - (p.y - 50), m = Math.hypot(dx, dy) || 1;
        drawBuddy(g, p.x, p.y, k, { t: clock, mood: f.mood, lx: dx / m, ly: dy / m, squash: f.squash, blink: f.blinkT < 0 });
      }
      drawHints(g);
      drawServeArrow(g);
      if (!pk.inNet) drawPuckAll(g);
      drawParts(g);
      g.restore();
      drawHud(g);
      drawTell(g);
      drawMessages(g);
      drawConfetti(g);
    }

    /* ---------- テスト用 ---------- */
    function check() {
      const v = [];
      const vals = [pk.x, pk.y, pk.vx, pk.vy, pk.sp, w.pads[0].y, w.pads[1].y];
      for (let i = 0; i < vals.length; i++) if (!isFinite(vals[i])) { v.push('nan'); return v; }
      if (pk.y < FY0 + PR - 0.01 || pk.y > FY1 - PR + 0.01) v.push('puckY ' + pk.y.toFixed(2));
      if (pk.x < FX0 - NET - 1 || pk.x > FX1 + NET + 1) v.push('puckX ' + pk.x.toFixed(2));
      for (let k = 0; k < 2; k++) {
        const p = w.pads[k];
        if (p.y < PAD_MIN_Y - 0.01 || p.y > PAD_MAX_Y + 0.01) v.push('padY' + k);
        if (pk.live) {
          const gap = segDist(pk, p) - HIT_D;
          if (gap < -0.5) v.push('overlap' + k + ' ' + gap.toFixed(2));
        }
      }
      if (pk.live) {
        const sp = Math.hypot(pk.vx, pk.vy);
        if (sp > w.maxSp + 0.01) v.push('speed ' + sp.toFixed(1));
        if (!overtime && w.maxSp !== w.typeCap) v.push('cap');
        if (Math.abs(pk.vx) < MIN_VX * sp * 0.99) v.push('steep');
        if (!special && pk.type !== 'normal') v.push('type ' + pk.type);
        if (!special && w.mod) v.push('mod');
      }
      if (score[0] + score[1] !== pointCount) v.push('score');
      if (pointCount < goalCount) v.push('points');
      if (finishCount > 1) v.push('finish x' + finishCount);
      // CPU・自動操作がルール違反をしていないか（1フレームの移動量が 上限速度×dt 以内）
      for (let k = 0; k < 2; k++) {
        const d = Math.abs(w.pads[k].y - w.pads[k].prevY);
        if (d > PAD_SPEED * STEP + 0.01) v.push('padJump' + k + ' ' + d.toFixed(2));
      }
      return v;
    }
    const inst = {
      start: start,
      update: update,
      draw: draw,
      onKeyDown: function () {},
      onKeyUp: function () {},
      destroy: function () { parts.length = 0; confetti.length = 0; pops.length = 0; },
    };
    inst._test = {
      get state() { return state; },
      get mode() { return mode; },
      get modeId() { return modeId; },
      get special() { return special; },
      get cpuLv() { return cpuLv; },
      get proWin() { return proWin; },
      get lastResult() { return lastResult; },
      get puckType() { return pk.type; },
      get lastPts() { return lastPts; },
      get goldUsed() { return goldUsed; },
      get tell() { return { t: tellT, type: tellType, len: countLen }; },
      get specialLog() { return specialLog.map(function (s) { return { type: s.type, tell: s.tell, live: s.live }; }); },
      get clock() { return clock; },
      get pointCount() { return pointCount; },
      get score() { return score.slice(); },
      get timeLeft() { return timeLeft; },
      get overtime() { return overtime; },
      get rally() { return rally; },
      get maxRally() { return maxRally; },
      get finished() { return finished; },
      get winner() { return winner; },
      get endReason() { return endReason; },
      get finishCount() { return finishCount; },
      get goalCount() { return goalCount; },
      get puck() { return { x: pk.x, y: pk.y, vx: pk.vx, vy: pk.vy, sp: pk.sp, live: pk.live }; },
      get pads() { return w.pads.map(function (p) { return { x: p.x, y: p.y, vy: p.vy }; }); },
      get maxSp() { return w.maxSp; },
      get stats() { return { hits: stats.hits, walls: stats.walls, bumps: stats.bumps, pins: w.pins }; },
      // CPU・ボットが どれくらい 空ぶったか（弱点の効きを しらべる用）
      get aiStats() {
        return [0, 1].map(function (k) {
          const a = testAI[k] || (k === 1 && mode === 'cpu' ? cpuAI : null);
          if (!a) return null;
          const n = Math.max(1, a.shots);
          return {
            shots: a.shots, miss: a.miss, fat: Math.round(a.fat * 100) / 100,
            steep: Math.round(a.sSteep / n * 100) / 100,      // 入ってくる球の 平均の きつさ（|vy/vx|）
            fatAvg: Math.round(a.sFat / n * 100) / 100,       // 平均の ゆさぶられ具合
            steepHit: Math.round(a.nSteep / n * 100) / 100,   // 急角度の弱点が どれくらい 効いたか(0〜1)
            bounceHit: Math.round(a.nBounce / n * 100) / 100, // かべ読みきれずの割合
          };
        });
      },
      consts: { FX0: FX0, FX1: FX1, FY0: FY0, FY1: FY1, CX: CX, CY: CY, PR: PR, PAD_R: PAD_R, PAD_L: PAD_L, PAD_HALF: PAD_HALF, HIT_D: HIT_D, PAD_X: PAD_X, PAD_MIN_Y: PAD_MIN_Y, PAD_MAX_Y: PAD_MAX_Y, MAX_SPEED: MAX_SPEED, OT_MAX: OT_MAX, SERVE_SPEED: SERVE_SPEED, PAD_SPEED: PAD_SPEED, MATCH_TIME: MATCH_TIME, WIN_SCORE: WIN_SCORE, STEP: STEP },
      check: check,
      // kind: 'still'|'random'|'kid'|'hum'|'pro'|'perfect'|'exploit'|'cpu' / lv: 1..4 で難易度つきCPU
      setAI: function (k, kind, over, lv) {
        testAI[k] = kind ? makeAI(kind, k, rand, lv || 0, over || null) : null;
      },
      // この回のモードを 直接 切りかえて やりなおす（エンジンの2段メニューが入る前のテスト用）
      restart: function (id) { start({ mode: id }); },
      // 調整用（テストのみ）: CPU の設定・加速率を上書き。start() でも引きつがれる
      tune: function (o) { tune = Object.assign(tune, o); if (tune.cpu) cpuAI.cfg = Object.assign(cpuAI.cfg || {}, tune.cpu); if (tune.accel) w.accel = tune.accel; },
      // テスト用: つぎのサーブのパックを 指定する（null で もとにもどす）
      forceType: function (t) { forceType = t || null; },
      setScore: function (a, b) { score[0] = a; score[1] = b; goalCount = a + b; pointCount = a + b; },
      setTime: function (t) { timeLeft = t; },
      skipCount: function () { if (state === 'count') serve(); },
      // パックを好きな位置・速度で置く（ライブ状態にする）
      place: function (x, y, vx, vy) {
        if (state === 'count') serve();
        pk.x = x; pk.y = y; pk.vx = vx; pk.vy = vy; pk.sp = Math.hypot(vx, vy); pk.live = true; pk.inNet = false;
        w.lastHit = -1; state = 'live'; trail.length = 0;
      },
      setPad: function (k, y) { const p = w.pads[k]; p.y = p.prevY = p.cy = clamp(y, PAD_MIN_Y, PAD_MAX_Y); p.vy = 0; },
      // 物理だけの射撃テスト: パドル k に向けてパックを撃つ
      shoot: function (o) {
        const k = o.k | 0, p = w.pads[k], other = w.pads[1 - k];
        p.y = p.prevY = p.cy = o.padY; p.vy = o.padVy || 0;
        const away = k === 0 ? 1 : -1;
        const a = (o.angle || 0) * DEG, sp = o.speed;
        const vx = -away * Math.cos(a) * sp, vy = Math.sin(a) * sp;
        const dist = o.dist || 500;
        const tt = dist / Math.abs(vx);
        const sy = o.padY + o.offset - vy * tt;
        pk.x = p.x + away * dist; pk.y = sy; pk.vx = vx; pk.vy = vy; pk.sp = sp; pk.live = true; pk.inNet = false;
        const keepMax = w.maxSp, keepAccel = w.accel, keepMod = w.mod, keepType = pk.type, keepCap = w.typeCap;
        w.lastHit = -1; w.accel = HIT_ACCEL; w.maxSp = MAX_SPEED;
        // 特殊パックの物理でも撃てる（すり抜け検査用）
        if (o.type && o.type !== 'normal') {
          const d2 = PUCK[o.type];
          pk.type = o.type;
          w.accel = d2.accel; w.maxSp = w.typeCap = Math.max(d2.cap, sp);
          w.mod = { curve: d2.curve || 0, wave: d2.wave || 0, waveF: d2.waveF || 2, wallKick: d2.wallKick || 1, edge: d2.edge || 1, cdir: 1, t: 0, flip: !!d2.flip };
        } else { w.mod = null; pk.type = 'normal'; }
        let minGap = 1e9, res = 'none', i = 0;
        for (i = 0; i < 1200; i++) {
          if (o.move) movePad(p, o.move, PAD_SPEED, STEP); else { p.prevY = p.y; p.vy = 0; }
          other.prevY = other.y;
          const sc = stepPuck(w, STEP, null);
          minGap = Math.min(minGap, segDist(pk, p) - HIT_D);
          if (pk.y < FY0 + PR - 0.01 || pk.y > FY1 - PR + 0.01) { res = 'outY'; break; }
          if (sc >= 0) { res = 'goal'; break; }
          if (pk.vx * away > 0 && Math.abs(pk.x - p.x) > 250) { res = 'bounce'; break; }
        }
        const r = { res: res, minGap: minGap, sp: Math.hypot(pk.vx, pk.vy), angle: Math.atan2(pk.vy, Math.abs(pk.vx)) / DEG, startY: sy, steps: i };
        pk.live = false; pk.x = CX; pk.y = CY; pk.vx = pk.vy = 0;
        w.maxSp = keepMax; w.accel = keepAccel; w.mod = keepMod; pk.type = keepType; w.typeCap = keepCap;
        return r;
      },
      // 長時間まわして、毎ステップ ルールが守られているか調べる
      soak: function (steps, o) {
        o = o || {};
        const out = { steps: 0, viol: [], matches: 0, wins: [0, 0], goals: 0, maxSp: 0, maxRally: 0, finals: [], reasons: {}, minGap: 1e9, padMove: [0, 0], secs: [], rallies: [], types: {}, badTell: 0 };
        let mStart = 0, curRally = 0, seenLog = 0;
        let prevGoals = goalCount;
        const py = [w.pads[0].y, w.pads[1].y];
        for (let i = 0; i < steps; i++) {
          update(STEP);
          out.steps++;
          const v = check();
          if (v.length && out.viol.length < 20) out.viol.push(i + ':' + state + ':' + v.join(','));
          if (pk.live) {
            out.maxSp = Math.max(out.maxSp, Math.hypot(pk.vx, pk.vy));
            out.minGap = Math.min(out.minGap, segDist(pk, w.pads[0]) - HIT_D, segDist(pk, w.pads[1]) - HIT_D);
          }
          for (let k = 0; k < 2; k++) { out.padMove[k] += Math.abs(w.pads[k].y - py[k]); py[k] = w.pads[k].y; }
          if (goalCount !== prevGoals) { out.goals += Math.max(0, goalCount - prevGoals); prevGoals = goalCount; }
          out.maxRally = Math.max(out.maxRally, maxRally);
          if (state === 'live') curRally = rally;
          else if (curRally > 0) { out.rallies.push(curRally); curRally = 0; }
          // 特殊パックの 予告 → 効果 の順番を 検査（予告なしで効果が始まったら badTell）
          while (seenLog < specialLog.length) {
            const s = specialLog[seenLog];
            if (s.live < 0) break;
            out.types[s.type] = (out.types[s.type] || 0) + 1;
            if (!(s.tell >= 0 && s.live > s.tell + 0.9)) out.badTell++;
            seenLog++;
          }
          if (finished && state === 'over' && st > 0.3 && o.restart) {
            out.matches++;
            out.secs.push(Math.round((i - mStart) / 120));
            mStart = i;
            out.wins[winner]++;
            out.finals.push(score[0] + '-' + score[1]);
            out.reasons[endReason] = (out.reasons[endReason] || 0) + 1;
            start({ mode: o.mode || modeId });
            prevGoals = 0;
            seenLog = 0;
          }
        }
        out.minGap = Math.round(out.minGap * 100) / 100;
        out.maxSp = Math.round(out.maxSp);
        out.padMove = out.padMove.map(Math.round);
        return out;
      },
    };
    return inst;
  }

  /* =========================================================
     登録
     ========================================================= */
  const GOAL_ICON = '<svg viewBox="0 0 64 64">' +
    '<rect x="42" y="8" width="17" height="48" rx="4" fill="#ffd0e2" stroke="#d2457a" stroke-width="3"/>' +
    '<path d="M47 10v44M53 10v44M44 20h13M44 32h13M44 44h13" stroke="#d2457a" stroke-width="1.6" opacity=".6"/>' +
    '<path d="M4 38h13M7 28h10" stroke="#ffb02e" stroke-width="5" stroke-linecap="round" opacity=".55"/>' +
    '<circle cx="29" cy="32" r="11" fill="#ffd23f" stroke="#ff9b2f" stroke-width="4"/>' +
    '<path d="M29 25l2 4.5 5 .5-3.8 3.2 1.2 4.8-4.4-2.6-4.4 2.6 1.2-4.8-3.8-3.2 5-.5z" fill="#fff"/></svg>';

  const SPECIAL_ICON = '<svg viewBox="0 0 64 64">' +
    '<path d="M32 4l3 7 3-7 2 9 5-5-1 8" fill="none" stroke="#ffb02e" stroke-width="2.5" stroke-linecap="round" opacity=".7"/>' +
    '<circle cx="22" cy="40" r="13" fill="#ffd23f" stroke="#c57a00" stroke-width="3"/>' +
    '<path d="M14 31l2-9 4 6 2-9 3 9 4-6 1 9z" fill="#fff0a8" stroke="#c57a00" stroke-width="2.4" stroke-linejoin="round"/>' +
    '<text x="22" y="46" font-size="15" font-weight="800" text-anchor="middle" fill="#fff" stroke="#c57a00" stroke-width="2.4" paint-order="stroke">2</text>' +
    '<circle cx="47" cy="22" r="8" fill="#b06bff" stroke="#6d2fc4" stroke-width="2.5"/>' +
    '<circle cx="50" cy="45" r="8" fill="#2fd3e8" stroke="#0a8fb0" stroke-width="2.5"/>' +
    '<path d="M46 41l4 4-4 4" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  Arcade.register({
    id: 'hockey',
    order: 1,
    title: 'ドタバタホッケー',
    shortTitle: 'ホッケー',
    catch: '2人で たいせん！ 1人なら CPUと（4だんかい）',
    tags: ['2人 / CPU', 'キーボード', '1〜5分'],
    modesCompact: true,
    theme: { main: '#59b8ff', dark: '#2f8ee0', light: '#e3f3ff' },
    bgm: 'hockey',
    howto: [
      { icon: '<span class="key p1">W</span><span class="key p1">S</span>', html: '<b>1P（あお・ひだり）</b> 上・下に うごく' },
      { icon: '<span class="key p2">↑</span><span class="key p2">↓</span>', html: '<b>2P（ピンク・みぎ）</b> 上・下に うごく' },
      { icon: GOAL_ICON, html: 'あいての ゴールに 入れたら <b>1点</b>！ <b>5点</b>で かち' },
      { icon: SPECIAL_ICON, html: '<b>スペシャル</b>は ふしぎな パックが でる。<b>きんいろ</b>は 入れると <b>2点</b>！' },
    ],
    modes: [
      {
        id: '2p', label: 'ふたりで あそぶ', sub: '2人で たいせん', desc: '1P は W・S キー、2P は ↑・↓ キーで うごかそう',
        children: [
          { id: '2p-normal', label: 'ノーマル', sub: 'ふつうの ホッケー', desc: 'まっすぐ とんでくる パックで たいせん。はじめては こっち', recommend: true },
          { id: '2p-special', label: 'スペシャル', sub: 'ふしぎな パックが でる', desc: 'きんいろの パックは 2てん！ はやい・まがる パックも でてくるよ' },
        ],
      },
      {
        id: 'cpu', label: 'CPUと あそぶ', sub: '1人で あそべる', desc: '1P（あお）を W・S でも ↑・↓ でも うごかせるよ',
        children: [
          { id: 'cpu-1', label: 'しょきゅう', sub: 'いちばん やさしい', desc: 'ゆっくり うごく。パックを おいかけきれなくて ミスも するよ', recommend: true },
          { id: 'cpu-2', label: 'ちゅうきゅう', sub: 'なれてきた人に', desc: 'だいたい 返してくる。おちついて ねらえば かてる' },
          { id: 'cpu-3', label: 'じょうきゅう', sub: 'つよいよ', desc: 'はやく 反応して 着地点を よんでくる。コースを ねらおう' },
          { id: 'cpu-4', label: 'プロ', sub: 'かなり つよい', desc: 'ほとんど 返される。パドルの はしで 急な角度に するのが ねらいめ' },
        ],
      },
      {
        id: 'cpusp', label: 'CPUと スペシャル', sub: '1人で ふしぎな パック', desc: 'CPUと スペシャルで たいせん。きんいろは 2てん！ W・S でも ↑・↓ でも うごかせるよ',
        children: [
          { id: 'cpusp-1', label: 'しょきゅう', sub: 'いちばん やさしい', desc: 'ゆっくり うごく CPU。ふしぎな パックに なれよう', recommend: true },
          { id: 'cpusp-2', label: 'ちゅうきゅう', sub: 'なれてきた人に', desc: 'だいたい 返してくる。きんいろの パックを ねらおう' },
          { id: 'cpusp-3', label: 'じょうきゅう', sub: 'つよいよ', desc: 'はやく 反応して くる。まがる パックで ゆさぶろう' },
          { id: 'cpusp-4', label: 'プロ', sub: 'かなり つよい', desc: 'スペシャルの プロ。「プロに かった人」に のるのは ノーマルの プロだけ' },
        ],
      },
    ],
    bestText: '1人のときは CPUと たいせん（4だんかい）',
    // クリア者リスト: 「プロ」に かった人だけ 名前を のこせる（点数では ならべない）
    rank: {
      boards: [{ id: 'hockey.pro', label: 'プロに かった人', short: 'プロ', unit: '', kind: 'clear' }],
      // プロ戦のときだけ クリア者リストの対象。ほかのモードは null（なにも出ない）
      boardOf: function (opts) { return opts && opts.mode === 'cpu-4' ? 'hockey.pro' : null; },
    },
    drawThumb: drawThumb,
    create: create,
  });
})();
