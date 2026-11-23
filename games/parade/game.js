/* =========================================================
   なんびきパレード（parade） — 1〜3人 協力の 数える・観察ゲーム
   - どうぶつの パレードが 流れていく
   - 「うさぎは なんびき？」「あかい ぼうしの子は？」などの お題に 数字で答える
   - 1人／2人／3人モード。人数が ふえるほど 数が多く・はやくなる
   - ランキングは 難易度ごとの「クリアした人・チーム」
   操作：マウスで 数字を おす（キーボードの 数字・Enter・BackSpace でも OK）
   ========================================================= */
(function () {
  'use strict';
  const A = window.Arcade;
  const W = A.W, H = A.H;

  const OL = '#4a3a2a';
  const LIFE_MAX = 3;
  const SHOW_Q = 2.6;        // お題を 見せる時間
  const AFTER = 0.8;         // パレードが 終わってから 入力が 出るまで
  const JUDGE_T = 0.9;       // ○✕ を 見せる時間（そのあと こたえあわせへ）
  const REV_IN = 0.45;       // こたえあわせ：ならべ終わるまで
  const REV_HOLD = 2.4;      // こたえあわせ：数えおわってから つぎへ 行くまで

  /* ---------- どうぶつ ---------- */
  // col＝基本の色／lite＝光があたる側／deep＝影側／belly＝おなかの明るい面
  // inner＝耳の中／nose＝はな の色
  const KINDS = {
    rabbit: { name: 'うさぎ', col: '#f3ece0', dark: '#ded7c6', lite: '#fffdf8', deep: '#cfc3ab', belly: '#fffcf4', inner: '#f7b3c6', nose: '#e07b9a' },
    cat:    { name: 'ねこ',   col: '#f6a15c', dark: '#dd7e34', lite: '#ffd3a4', deep: '#cf6f24', belly: '#fde6c8', inner: '#f6a6b8', nose: '#e8738f' },
    bear:   { name: 'くま',   col: '#b1764a', dark: '#8c5a33', lite: '#d9a478', deep: '#78482a', belly: '#f0d8b4', inner: '#cc9269', nose: '#4a2c1e' },
    dog:    { name: 'いぬ',   col: '#e2b267', dark: '#a9792f', lite: '#f9dda9', deep: '#ab7e36', belly: '#fff1d6', inner: '#d08f52', nose: '#4a3a2a' },
    pig:    { name: 'ぶた',   col: '#f6b9c8', dark: '#dd90a4', lite: '#ffe3ea', deep: '#d4859b', belly: '#fff0f4', inner: '#e8869e', nose: '#ef8ca6' },
    frog:   { name: 'かえる', col: '#8fd47a', dark: '#5fae49', lite: '#c9ee9f', deep: '#4e9a3c', belly: '#eff7cd', inner: '#a6dd8f', nose: '#3f7a33' },
  };
  const KIND_IDS = ['rabbit', 'cat', 'bear', 'dog', 'pig', 'frog'];

  // ぼうしは 色が お題なので かたちは そろえる。
  // ただし 色だけだと 遠目に まぎれるので、前に 色ごとの 小さな しるしを 付ける
  const HATS = {
    none:   { name: 'なし',     col: null },
    red:    { name: 'あかい',   col: '#e8364a', lite: '#ff9aa6', deep: '#a6142a', mark: 'dot' },
    blue:   { name: 'あおい',   col: '#3f8ae0', lite: '#9fccff', deep: '#1d5496', mark: 'star' },
    yellow: { name: 'きいろい', col: '#f7c92e', lite: '#ffeea6', deep: '#bd8e00', mark: 'tri' },
    green:  { name: 'みどりの', col: '#44ab3f', lite: '#a4e398', deep: '#1d7524', mark: 'dia' },
  };
  const HAT_IDS = ['red', 'blue', 'yellow', 'green'];

  const ITEMS = {
    none:    { name: 'なし' },
    banana:  { name: 'バナナ' },
    balloon: { name: 'ふうせん' },
    flag:    { name: 'はた' },
  };
  const ITEM_IDS = ['banana', 'balloon', 'flag'];

  /* ---------- 難易度 ---------- */
  // kinds＝出てくる しゅるい数、total＝ぜんぶの数、v＝ながれる速さ、gap＝あいだ、lanes＝列
  // qt＝つかう お題の しゅるい（1…しゅるい / 2…ぼうしの色 / 3…もちもの / 4…しゅるい＋ぼうし / 5…わらっている）
  //    ※ 同じ数字を 2回 書くと、その お題が 出やすく なる（げきむずの 4・5）
  // qPlus＝その難易度だけ 出題数を ふやす（げきむずだけ ＋1もん）
  // R6b の 直し：
  //   ・どうぶつを 1.25倍 大きく した（ANIM_SCALE）ので、重ならないように gap を 広げた
  //   ・むずかしい／げきむず だけ 数・速さ・お題の しゅるいを 一段 きつく した
  //   ・やさしい／ふつう は 小さい子の 入口なので 中身は そのまま（gap だけ 絵に あわせた）
  const LEVELS = {
    easy:  { id: 'easy',  label: 'やさしい',   kinds: 2, total: 10, v: 300, gap: 198, lanes: 1, qt: [1],          hatP: 0.5, itemP: 0.4 },
    normal:{ id: 'normal',label: 'ふつう',     kinds: 3, total: 15, v: 380, gap: 186, lanes: 1, qt: [1, 2, 3],    hatP: 0.6, itemP: 0.5 },
    hard:  { id: 'hard',  label: 'むずかしい', kinds: 5, total: 27, v: 545, gap: 188, lanes: 2, qt: [2, 3, 4, 5], hatP: 0.72, itemP: 0.62 },
    chaos: { id: 'chaos', label: 'げきむず',   kinds: 6, total: 36, v: 640, gap: 180, lanes: 2, qt: [2, 3, 4, 4, 5, 5], hatP: 0.8, itemP: 0.7, qPlus: 1 },
  };
  const LEVEL_IDS = ['easy', 'normal', 'hard', 'chaos'];
  // 人数による ちょうせい（spec：1人＝すこし簡単／2人＝標準／3人＝むずかしめ）
  const PLAYERS = {
    1: { n: 1, label: '1人', q: 4, total: 0.85, v: 0.90 },
    2: { n: 2, label: '2人', q: 5, total: 1.00, v: 1.00 },
    3: { n: 3, label: '3人', q: 6, total: 1.20, v: 1.10 },
  };
  // R6b：1人のときの「割引」。作者の指摘「一人のやつとか もう少し 難しく」への 直し。
  //   むずかしい・げきむず だけ ほとんど 割り引かない（数 0.85→0.96倍・速さ 0.90→0.97倍）。
  //   やさしい・ふつう は 小さい子の 入口なので R6 のまま（さわらない）。
  const SOLO = {
    easy:   { total: 0.85, v: 0.90 },
    normal: { total: 0.85, v: 0.90 },
    hard:   { total: 0.96, v: 0.97 },
    chaos:  { total: 0.96, v: 0.97 },
  };
  // その 難易度・人数での ほんとうの ちょうせい値
  function playerOf(levelId, players) {
    const P = PLAYERS[players] || PLAYERS[1];
    const s = (P.n === 1) ? SOLO[levelId] : null;
    if (!s) return P;
    return { n: P.n, label: P.label, q: P.q, total: s.total, v: s.v };
  }
  // 出題数（人数 ＋ 難易度の おまけ）
  function qCountOf(levelId, players) {
    const L = LEVELS[levelId] || LEVELS.easy, P = PLAYERS[players] || PLAYERS[1];
    return P.q + (L.qPlus || 0);
  }

  // どうぶつを 画面に 描く 大きさ（R6b：作者の 指摘で 1.00 → 1.25）
  const ANIM_SCALE = 1.25;
  // drawAnimal 1ぴき分の 入れもの（絵の 中の 座標）。こたえあわせで ならべるときに つかう
  const ABOX = { w: 184, h: 226, cx: 14, cy: -17 };

  /* ---------- お題の じょうけんに 合うか ----------
     ★ 答えの 数も、こたえあわせの しるしも、ぜんぶ この関数 1つだけを つかう。
        2か所に 書くと 答えと 画面が ずれるので、ぜったいに 分けないこと。 */
  function matches(a, crit) {
    if (!crit) return false;
    if (crit.kind && a.kind !== crit.kind) return false;
    if (crit.hat && a.hat !== crit.hat) return false;
    if (crit.item && a.item !== crit.item) return false;
    if (crit.smile && !a.smile) return false;
    return true;
  }
  function countMatches(list, crit) {
    let n = 0;
    for (let i = 0; i < list.length; i++) if (matches(list[i], crit)) n++;
    return n;
  }

  /* =========================================================
     絵（すべてコードで描く）
     ========================================================= */
  const TAU = Math.PI * 2;

  function ell(g, cx, cy, rx, ry, rot) {
    g.beginPath(); g.ellipse(cx, cy, rx, ry, rot || 0, 0, TAU);
  }
  function starPath(g, cx, cy, r1, r2, n, rot) {
    g.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const r = (i % 2) ? r2 : r1;
      const an = (rot || 0) + i * Math.PI / n;
      const px = cx + Math.cos(an) * r, py = cy + Math.sin(an) * r;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
  }
  // グラデーションは 毎フレーム 作ると おもいので ため込む
  // （座標は 描くときの 座標系で よまれるので、使いまわしても ずれない）
  const GCACHE = new WeakMap();
  function cached(g, key, make) {
    let m = GCACHE.get(g);
    if (!m) { m = Object.create(null); GCACHE.set(g, m); }
    let v = m[key];
    if (v === undefined) { v = make(g); m[key] = v; }
    return v;
  }
  // ② 面は グラデーション（光は 左上から）
  function lin(g, key, K, x0, y0, x1, y1) {
    return cached(g, key, function (gg) {
      const gr = gg.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, K.lite); gr.addColorStop(0.46, K.col); gr.addColorStop(1, K.deep);
      return gr;
    });
  }
  function rad(g, key, x0, y0, r0, x1, y1, r1, c0, c1, c2) {
    return cached(g, key, function (gg) {
      const gr = gg.createRadialGradient(x0, y0, r0, x1, y1, r1);
      gr.addColorStop(0, c0);
      if (c2) { gr.addColorStop(0.5, c1); gr.addColorStop(1, c2); } else { gr.addColorStop(1, c1); }
      return gr;
    });
  }
  // ③ ツヤ（ななめの 白い楕円）
  function gloss(g, cx, cy, rx, ry, rot, al) {
    g.fillStyle = 'rgba(255,255,255,' + (al || 0.5) + ')';
    ell(g, cx, cy, rx, ry, rot === undefined ? -0.7 : rot); g.fill();
  }

  // しゅるいごとの かたち（からだ・あたまの 大きさを 変えて シルエットで 見分ける）
  //   bw,bh,by＝からだの 半径と たての 位置／hx,hy＝あたまの 半径
  const SHAPE = {
    rabbit: { bw: 33, bh: 41, by: 26, hx: 33, hy: 33 },
    cat:    { bw: 36, bh: 37, by: 25, hx: 36, hy: 33 },
    bear:   { bw: 47, bh: 42, by: 24, hx: 40, hy: 37 },
    dog:    { bw: 39, bh: 36, by: 26, hx: 36, hy: 34 },
    pig:    { bw: 45, bh: 39, by: 25, hx: 37, hy: 34 },
    frog:   { bw: 51, bh: 33, by: 30, hx: 42, hy: 30 },
  };

  /* ---------- ぼうし（お題の 絵でも 使う）----------
     brimY＝つばの たての 位置、rx＝つばの 半径 */
  function drawHat(g, hatId, brimY, rx) {
    const Hh = HATS[hatId];
    if (!Hh || !Hh.col) return;
    const top = brimY - rx * 1.25 - 6;       // とんがりの さき
    const cw = rx * 0.62;                    // とんがりの ねもと
    g.save();
    g.lineJoin = 'round'; g.lineCap = 'round';
    // とんがり
    g.beginPath();
    g.moveTo(-cw, brimY - 2);
    g.quadraticCurveTo(-cw * 0.5, top + 6, 1, top);
    g.quadraticCurveTo(cw * 0.6, top + 10, cw, brimY - 2);
    g.closePath();
    const hk = hatId + ':' + Math.round(brimY) + ':' + Math.round(rx);
    g.fillStyle = cached(g, hk + ':cone', function (gg) {
      const cg = gg.createLinearGradient(-cw, top, cw * 0.7, brimY);
      cg.addColorStop(0, Hh.lite); cg.addColorStop(0.5, Hh.col); cg.addColorStop(1, Hh.deep);
      return cg;
    });
    g.fill();
    g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
    // しろい おび（とんがりの はばに 合わせた 台形）
    const bw1 = cw * 0.74, bw2 = cw * 0.56;
    g.beginPath();
    g.moveTo(-bw1, brimY - 11); g.lineTo(bw1, brimY - 11);
    g.lineTo(bw2, brimY - 20); g.lineTo(-bw2, brimY - 20);
    g.closePath();
    g.fillStyle = 'rgba(255,255,255,0.88)'; g.fill();
    // つば
    ell(g, 0, brimY, rx, rx * 0.26);
    g.fillStyle = cached(g, hk + ':brim', function (gg) {
      const bgr = gg.createLinearGradient(-rx, brimY - 8, rx * 0.6, brimY + 8);
      bgr.addColorStop(0, Hh.lite); bgr.addColorStop(0.5, Hh.col); bgr.addColorStop(1, Hh.deep);
      return bgr;
    });
    g.fill();
    g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
    // ③ ツヤ
    gloss(g, -rx * 0.42, brimY - 24, rx * 0.2, rx * 0.1, -1.1, 0.6);
    // ⑦ 色ごとの しるし（遠目でも 色が わかるように）
    const mx = 0, my = brimY - rx * 0.56;
    g.lineWidth = 3; g.strokeStyle = 'rgba(74,58,42,0.85)';
    g.fillStyle = '#fff';
    if (Hh.mark === 'star') { starPath(g, mx, my, 9, 4, 5, -Math.PI / 2); g.fill(); g.stroke(); }
    else if (Hh.mark === 'tri') { g.beginPath(); g.moveTo(mx, my - 8); g.lineTo(mx + 8, my + 6); g.lineTo(mx - 8, my + 6); g.closePath(); g.fill(); g.stroke(); }
    else if (Hh.mark === 'dia') { g.beginPath(); g.moveTo(mx, my - 9); g.lineTo(mx + 7, my); g.lineTo(mx, my + 9); g.lineTo(mx - 7, my); g.closePath(); g.fill(); g.stroke(); }
    else { g.beginPath(); g.arc(mx, my, 7, 0, TAU); g.fill(); g.stroke(); }
    // ぼんぼり
    g.beginPath(); g.arc(1, top - 7, 9, 0, TAU);
    g.fillStyle = rad(g, hk + ':pom', -3, top - 11, 1, 1, top - 7, 11, '#fff', '#ffd9e2');
    g.fill();
    g.lineWidth = 4; g.strokeStyle = OL; g.stroke();
    g.restore();
  }

  /* ---------- もちもの（お題の 絵でも 使う）---------- */
  function drawItem(g, itemId) {
    g.save();
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = OL;
    if (itemId === 'banana') {
      // バナナ：三日月＋へた＋すじ
      g.beginPath();
      g.moveTo(-16, -20);
      g.bezierCurveTo(-24, 6, -6, 24, 20, 18);
      g.bezierCurveTo(0, 12, -6, -6, -8, -22);
      g.closePath();
      g.fillStyle = cached(g, 'it:banana', function (gg) {
        const bg = gg.createLinearGradient(-18, -20, 14, 20);
        bg.addColorStop(0, '#fff6c0'); bg.addColorStop(0.45, '#f7c92e'); bg.addColorStop(1, '#d79a08');
        return bg;
      });
      g.fill();
      g.lineWidth = 5.5; g.stroke();
      g.strokeStyle = 'rgba(190,140,10,0.55)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(-10, -14); g.bezierCurveTo(-15, 4, -2, 15, 14, 13); g.stroke();
      gloss(g, -9, -8, 8, 3.4, -1.0, 0.65);
      // へた
      g.strokeStyle = OL; g.lineWidth = 5;
      g.beginPath(); g.moveTo(-12, -21); g.lineTo(-14, -31); g.stroke();
      g.fillStyle = '#7a5a2a';
      ell(g, 19, 19, 5, 4, 0.4); g.fill();
    } else if (itemId === 'balloon') {
      // ふうせん：ひも＋丸い玉＋むすびめ
      g.strokeStyle = '#9b7a52'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, 22); g.quadraticCurveTo(7, 2, 2, -12); g.stroke();
      ell(g, 2, -34, 19, 23);
      g.fillStyle = rad(g, 'it:balloon', -6, -44, 2, 2, -34, 28, '#ffd3e0', '#ff7fa8', '#e0426f');
      g.fill();
      g.lineWidth = 5.5; g.strokeStyle = OL; g.stroke();
      gloss(g, -7, -44, 7.5, 4, -0.7, 0.8);
      g.fillStyle = '#ff7fa8';
      g.beginPath(); g.moveTo(-5, -12); g.lineTo(5, -12); g.lineTo(0, -4); g.closePath();
      g.fill(); g.lineWidth = 4; g.stroke();
    } else {
      // はた：ぼう＋三角＋ほし
      g.strokeStyle = '#9b7a52'; g.lineWidth = 6;
      g.beginPath(); g.moveTo(-2, 24); g.lineTo(-2, -40); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(-4, 20); g.lineTo(-4, -36); g.stroke();
      g.beginPath();
      g.moveTo(1, -40); g.quadraticCurveTo(22, -34, 38, -28);
      g.quadraticCurveTo(20, -20, 1, -12); g.closePath();
      g.fillStyle = cached(g, 'it:flag', function (gg) {
        const fg = gg.createLinearGradient(0, -40, 30, -12);
        fg.addColorStop(0, '#b6ecff'); fg.addColorStop(0.5, '#5ec2e8'); fg.addColorStop(1, '#2a8cb8');
        return fg;
      });
      g.fill();
      g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
      starPath(g, 15, -27, 7, 3, 5, -Math.PI / 2);
      g.fillStyle = '#fff8c0'; g.fill();
      g.lineWidth = 2.5; g.strokeStyle = 'rgba(74,58,42,0.7)'; g.stroke();
      // ぼうの あたまの 玉
      g.beginPath(); g.arc(-2, -44, 6, 0, TAU);
      g.fillStyle = '#ffd34d'; g.fill(); g.lineWidth = 4; g.strokeStyle = OL; g.stroke();
    }
    g.restore();
  }

  /* =========================================================
     どうぶつ 本体
       a = { kind, hat, item, smile, ph, icon? }
       a.icon が true のときは うごきを 止めて お題の 絵として 描く
     ========================================================= */
  function drawAnimal(g, x, y, a, t) {
    const kind = KINDS[a.kind] ? a.kind : 'cat';
    const K = KINDS[kind], S = SHAPE[kind];
    const icon = !!a.icon;
    const ph = a.ph || 0;
    const w = icon ? 0 : Math.sin(t * 7 + ph);
    const bob = w * 7;
    const sm = !!a.smile;
    const hy = S.hy, hx = S.hx;
    const headTop = -26 - hy;
    const foot = function (i) { return icon ? 0 : Math.sin(t * 7 + ph + i * Math.PI) * 9; };

    g.save();
    g.translate(x, y + bob);

    // ⑥ 地面の 影（はねても 影は 地面に のこる）
    if (!icon) {
      g.save(); g.translate(0, -bob);
      g.fillStyle = 'rgba(0,0,0,0.13)';
      ell(g, 2, 84, 42, 10); g.fill();
      g.restore();
    }
    g.rotate(w * 0.05);
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = OL; g.lineWidth = 6;

    /* ---------- しっぽ（からだより うしろ） ---------- */
    if (kind === 'cat') {
      g.beginPath();
      g.moveTo(-26, S.by + 4);
      g.bezierCurveTo(-60, S.by + 2, -70, -10, -50, -30 + w * 6);
      g.strokeStyle = OL; g.lineWidth = 17; g.stroke();
      g.strokeStyle = K.col; g.lineWidth = 10; g.stroke();
      g.strokeStyle = K.dark; g.setLineDash([7, 13]); g.stroke(); g.setLineDash([]);
    } else if (kind === 'rabbit') {
      ell(g, -34, S.by + 12, 16, 15);
      g.fillStyle = rad(g, 'rabbit:tail', -40, S.by + 5, 2, -34, S.by + 12, 20, '#ffffff', K.deep);
      g.fill();
      g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
    } else if (kind === 'dog') {
      g.beginPath();
      g.moveTo(-30, S.by);
      g.quadraticCurveTo(-50, S.by - 14, -48 + w * 12, -22 + w * 8);
      g.strokeStyle = OL; g.lineWidth = 16; g.stroke();
      g.strokeStyle = K.dark; g.lineWidth = 9; g.stroke();
      g.strokeStyle = '#fff7e6'; g.lineWidth = 9;
      g.beginPath();
      g.moveTo(-46 + w * 11, -16 + w * 7); g.lineTo(-48 + w * 12, -22 + w * 8);
      g.stroke();
    } else if (kind === 'pig') {
      g.save();
      g.translate(-42, S.by + 2);
      g.beginPath();
      for (let i = 0; i <= 28; i++) {
        const k = i / 28, an = -1.2 + k * 2.3 * TAU, rr = 3 + k * 11;
        const px = Math.cos(an) * rr * 0.75, py = Math.sin(an) * rr;
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.strokeStyle = OL; g.lineWidth = 10; g.stroke();
      g.strokeStyle = K.col; g.lineWidth = 5.5; g.stroke();
      g.restore();
    } else if (kind === 'bear') {
      ell(g, -42, S.by + 14, 12, 11);
      g.fillStyle = K.dark; g.fill();
      g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
    }

    /* ---------- 足 ---------- */
    if (kind === 'frog') {
      [-1, 1].forEach(function (sd, i) {
        g.save();
        g.translate(sd * 32 + foot(i) * 0.4, 64); g.rotate(sd * 0.22);
        ell(g, 0, 0, 21, 9);
        g.fillStyle = lin(g, kind + ':ft', K, -18, -10, 14, 10); g.fill();
        g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
        g.strokeStyle = 'rgba(74,58,42,0.5)'; g.lineWidth = 3;
        g.beginPath();
        g.moveTo(-6, -7); g.lineTo(-7, 7); g.moveTo(6, -7); g.lineTo(7, 7);
        g.stroke();
        g.restore();
      });
    } else if (kind === 'pig') {
      [-1, 1].forEach(function (sd, i) {
        g.save();
        g.translate(sd * 19 + foot(i) * 0.4, 62);
        A.roundRect(g, -11, -9, 22, 20, 7);
        g.fillStyle = lin(g, 'pig:ft', K, -11, -9, 9, 11); g.fill();
        g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
        g.strokeStyle = 'rgba(74,58,42,0.6)'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(0, 2); g.lineTo(0, 10); g.stroke();
        g.restore();
      });
    } else {
      [-1, 1].forEach(function (sd, i) {
        g.save();
        g.translate(sd * 19 + foot(i) * 0.4, 63);
        ell(g, 0, 0, 14, 11, sd * 0.12);
        g.fillStyle = lin(g, kind + ':paw', K, -13, -10, 11, 11); g.fill();
        g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
        g.strokeStyle = 'rgba(74,58,42,0.45)'; g.lineWidth = 2.6;
        g.beginPath();
        g.moveTo(-5, -5); g.lineTo(-5, 4); g.moveTo(4, -5); g.lineTo(4, 4);
        g.stroke();
        g.restore();
      });
    }

    /* ---------- からだ ---------- */
    ell(g, 0, S.by, S.bw, S.bh);
    g.fillStyle = lin(g, kind + ':body', K, -S.bw, S.by - S.bh, S.bw * 0.65, S.by + S.bh); g.fill();
    g.lineWidth = 6; g.strokeStyle = OL; g.stroke();
    // おなかの 明るい面
    ell(g, 0, S.by + 7, S.bw * 0.6, S.bh * 0.6);
    g.fillStyle = K.belly; g.fill();
    // ③ ツヤ
    gloss(g, -S.bw * 0.45, S.by - S.bh * 0.55, S.bw * 0.3, S.bh * 0.13, -0.7, 0.4);
    // 模様（からだから はみ出さない 大きさで 描く）
    if (kind === 'cat') {
      g.strokeStyle = 'rgba(190,100,30,0.65)'; g.lineWidth = 8; g.lineCap = 'round';
      [-6, 8, 20].forEach(function (dy) {
        g.beginPath();
        g.moveTo(-S.bw * 0.78, S.by + dy - 6);
        g.quadraticCurveTo(-12, S.by + dy, -S.bw * 0.74, S.by + dy + 8);
        g.stroke();
      });
    } else if (kind === 'dog') {
      ell(g, 15, S.by + 2, 16, 15, 0.3);
      g.fillStyle = 'rgba(150,110,60,0.55)'; g.fill();
      ell(g, -19, S.by + 19, 10, 7.5, -0.3);
      g.fillStyle = 'rgba(150,110,60,0.4)'; g.fill();
    } else if (kind === 'frog') {
      g.fillStyle = 'rgba(70,140,55,0.45)';
      [[-26, 2, 8], [20, -4, 7], [4, 18, 6]].forEach(function (p) {
        ell(g, p[0], S.by + p[1], p[2], p[2] * 0.8); g.fill();
      });
    } else if (kind === 'bear') {
      ell(g, 0, S.by + 10, S.bw * 0.46, S.bh * 0.42);
      g.fillStyle = 'rgba(255,245,220,0.5)'; g.fill();
    }

    /* ---------- 手（からだの 前） ---------- */
    [-1, 1].forEach(function (sd) {
      g.save();
      g.translate(sd * (S.bw - 5), S.by + 2 + (sd > 0 && a.item !== 'none' ? -8 : 0));
      g.rotate(sd * (sd > 0 && a.item !== 'none' ? -0.6 : 0.35));
      ell(g, 0, 0, 16, 10);
      g.fillStyle = lin(g, kind + ':hand', K, -15, -9, 13, 10); g.fill();
      g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
      g.restore();
    });

    /* ---------- 耳 ---------- */
    if (kind === 'rabbit') {
      [[-15, -0.2], [15, 0.2]].forEach(function (p) {
        g.save(); g.translate(p[0], headTop + 12); g.rotate(p[1] + w * 0.07);
        ell(g, 0, -36, 12, 38);
        g.fillStyle = lin(g, 'rabbit:ear', K, -12, -70, 10, 0); g.fill();
        g.lineWidth = 5.5; g.strokeStyle = OL; g.stroke();
        ell(g, 0, -37, 5.5, 25);
        g.fillStyle = K.inner; g.fill();
        gloss(g, -4, -56, 3.5, 9, -0.1, 0.45);
        g.restore();
      });
    } else if (kind === 'cat') {
      // ねこ：とがった 耳
      [[-23, -1], [23, 1]].forEach(function (p, ei) {
        g.beginPath();
        g.moveTo(p[0] - 17, headTop + 20);
        g.lineTo(p[0] + p[1] * 7, headTop - 30);
        g.lineTo(p[0] + 17, headTop + 15);
        g.closePath();
        g.fillStyle = lin(g, 'cat:ear' + ei, K, p[0] - 17, headTop - 26, p[0] + 15, headTop + 20); g.fill();
        g.lineWidth = 5.5; g.strokeStyle = OL; g.stroke();
        g.beginPath();
        g.moveTo(p[0] - 8, headTop + 14);
        g.lineTo(p[0] + p[1] * 5, headTop - 15);
        g.lineTo(p[0] + 8, headTop + 12);
        g.closePath();
        g.fillStyle = K.inner; g.fill();
      });
    } else if (kind === 'dog') {
      // いぬ：長く たれた 耳
      [[-33, -0.42], [33, 0.42]].forEach(function (p) {
        g.save(); g.translate(p[0], headTop + 14); g.rotate(p[1] + w * 0.06);
        ell(g, 0, 31, 13.5, 39);
        g.fillStyle = lin(g, 'dog:ear', K, -13, -8, 11, 66); g.fill();
        g.lineWidth = 5.5; g.strokeStyle = OL; g.stroke();
        g.fillStyle = 'rgba(120,80,30,0.42)';
        ell(g, 1, 40, 7.5, 21); g.fill();
        g.restore();
      });
    } else if (kind === 'pig') {
      // ぶた：小さく とがって そとに たおれた 耳
      [[-25, -1], [25, 1]].forEach(function (p, ei) {
        g.beginPath();
        g.moveTo(p[0] - p[1] * 10, headTop + 20);
        g.lineTo(p[0] + p[1] * 10, headTop - 22);
        g.lineTo(p[0] + p[1] * 21, headTop + 8);
        g.closePath();
        g.fillStyle = lin(g, 'pig:ear' + ei, K, p[0] - 12, headTop - 20, p[0] + 16, headTop + 18); g.fill();
        g.lineWidth = 5.5; g.strokeStyle = OL; g.stroke();
        g.beginPath();
        g.moveTo(p[0] - p[1] * 3, headTop + 14);
        g.lineTo(p[0] + p[1] * 9, headTop - 11);
        g.lineTo(p[0] + p[1] * 14, headTop + 7);
        g.closePath();
        g.fillStyle = K.inner; g.fill();
      });
    } else if (kind === 'bear') {
      // くま：大きな まるい 耳
      [[-33, headTop + 7], [33, headTop + 7]].forEach(function (p, ei) {
        g.beginPath(); g.arc(p[0], p[1], 20, 0, TAU);
        g.fillStyle = lin(g, 'bear:ear' + ei, K, p[0] - 20, p[1] - 20, p[0] + 16, p[1] + 18); g.fill();
        g.lineWidth = 5.5; g.strokeStyle = OL; g.stroke();
        g.beginPath(); g.arc(p[0], p[1] + 1, 10, 0, TAU);
        g.fillStyle = K.inner; g.fill();
      });
    }

    /* ---------- あたま ---------- */
    ell(g, 0, -26, hx, hy);
    g.fillStyle = rad(g, kind + ':head', -hx * 0.4, -26 - hy * 0.5, 3, 0, -26, hx * 1.5, K.lite, K.col, K.deep);
    g.fill();
    g.lineWidth = 6; g.strokeStyle = OL; g.stroke();
    gloss(g, -hx * 0.42, -26 - hy * 0.52, hx * 0.3, hy * 0.17, -0.7, 0.5);

    /* ---------- 口のまわり ---------- */
    if (kind === 'bear') {
      // くま：口のまわりが 大きく 明るい（これが くま の めじるし）
      ell(g, 0, -11, 23, 17);
      g.fillStyle = '#f3e1c4'; g.fill();
      g.lineWidth = 3.5; g.strokeStyle = 'rgba(74,44,30,0.45)'; g.stroke();
    } else if (kind === 'dog') {
      ell(g, 0, -9, 21, 15);
      g.fillStyle = K.belly; g.fill();
      g.lineWidth = 3.5; g.strokeStyle = 'rgba(74,58,42,0.4)'; g.stroke();
    }

    // いぬ：目の まわりの ぶち（いぬ の めじるし）
    if (kind === 'dog') {
      ell(g, -17, -33, 16, 15, -0.25);
      g.fillStyle = 'rgba(150,100,40,0.8)'; g.fill();
      ell(g, 20, -40, 9, 7, 0.4);
      g.fillStyle = 'rgba(150,100,40,0.45)'; g.fill();
    }

    /* ---------- ほっぺ（わらうと 濃く 大きく） ---------- */
    g.fillStyle = sm ? 'rgba(255,110,150,0.6)' : 'rgba(255,110,150,0.42)';
    const chx = hx * 0.62, chr = sm ? 11 : 9;
    ell(g, -chx, -14, chr, chr * 0.66); g.fill();
    ell(g, chx, -14, chr, chr * 0.66); g.fill();

    /* ---------- 目（かえる以外） ---------- */
    const ex = kind === 'bear' ? 15 : 14, ey = kind === 'bear' ? -32 : -30;
    if (kind !== 'frog') {
      if (sm) {
        // ⑤ わらっている：目を 細める（遠目でも わかる）
        g.strokeStyle = '#2b1a14'; g.lineWidth = 6; g.lineCap = 'round';
        [-1, 1].forEach(function (sd) {
          g.beginPath();
          g.moveTo(sd * ex - 10, ey + 4);
          g.quadraticCurveTo(sd * ex, ey - 12, sd * ex + 10, ey + 4);
          g.stroke();
        });
      } else {
        [-1, 1].forEach(function (sd) {
          const px = sd * ex;
          g.fillStyle = '#2b1a14'; ell(g, px, ey, 7.5, 9.5); g.fill();
          g.fillStyle = '#fff'; ell(g, px - 2.6, ey - 3.6, 3.1, 3.5); g.fill();
          g.beginPath(); g.arc(px + 2.6, ey + 3.8, 1.7, 0, TAU); g.fill();
        });
      }
    }

    /* ---------- はな・口（しゅるいごと） ---------- */
    if (kind === 'pig') {
      // ぶた：大きな はな＋あな2つ
      ell(g, 0, -13, 18, 14);
      g.fillStyle = rad(g, 'pig:nose', -6, -19, 2, 0, -13, 20, '#ffd3de', K.nose);
      g.fill();
      g.lineWidth = 4.5; g.strokeStyle = OL; g.stroke();
      g.fillStyle = '#b3607a';
      ell(g, -6, -13, 3.4, 5); g.fill();
      ell(g, 6, -13, 3.4, 5); g.fill();
      gloss(g, -7, -19, 5, 2.6, -0.4, 0.75);
    } else if (kind === 'cat') {
      // ねこ：ひげ＋小さな 三角の はな
      g.strokeStyle = 'rgba(74,58,42,0.55)'; g.lineWidth = 3;
      g.beginPath();
      g.moveTo(-14, -14); g.lineTo(-hx - 22, -22);
      g.moveTo(-14, -9); g.lineTo(-hx - 24, -8);
      g.moveTo(-14, -5); g.lineTo(-hx - 20, 4);
      g.moveTo(14, -14); g.lineTo(hx + 22, -22);
      g.moveTo(14, -9); g.lineTo(hx + 24, -8);
      g.moveTo(14, -5); g.lineTo(hx + 20, 4);
      g.stroke();
      g.beginPath();
      g.moveTo(-7, -17); g.lineTo(7, -17); g.lineTo(0, -10); g.closePath();
      g.fillStyle = K.nose; g.fill();
      g.lineWidth = 3.5; g.strokeStyle = OL; g.stroke();
    } else if (kind === 'rabbit') {
      g.beginPath();
      g.moveTo(-6, -16); g.lineTo(6, -16); g.lineTo(0, -10); g.closePath();
      g.fillStyle = K.nose; g.fill();
      g.lineWidth = 3.5; g.strokeStyle = OL; g.stroke();
    } else if (kind === 'bear' || kind === 'dog') {
      ell(g, 0, -17, kind === 'bear' ? 10 : 11, kind === 'bear' ? 7.5 : 8);
      g.fillStyle = K.nose; g.fill();
      g.lineWidth = 3.5; g.strokeStyle = OL; g.stroke();
      gloss(g, -3.5, -19.5, 3.4, 1.8, -0.3, 0.7);
    } else {
      // かえる：はなの あな
      g.fillStyle = 'rgba(63,122,51,0.8)';
      g.beginPath(); g.arc(-6, -21, 2.4, 0, TAU); g.fill();
      g.beginPath(); g.arc(6, -21, 2.4, 0, TAU); g.fill();
    }

    // 口
    g.lineCap = 'round';
    if (kind === 'frog') {
      // かえる：よこに ひろい 口
      if (sm) {
        g.beginPath();
        g.moveTo(-30, -16); g.quadraticCurveTo(0, 12, 30, -16);
        g.quadraticCurveTo(0, -4, -30, -16); g.closePath();
        g.fillStyle = '#c2455a'; g.fill();
        g.lineWidth = 4.5; g.strokeStyle = OL; g.stroke();
        g.fillStyle = '#ff9db0'; ell(g, 0, 2, 9, 4.5); g.fill();
      } else {
        g.strokeStyle = OL; g.lineWidth = 5;
        g.beginPath(); g.moveTo(-29, -16); g.quadraticCurveTo(0, -4, 29, -16); g.stroke();
      }
    } else if (sm) {
      const my = kind === 'pig' ? 1 : (kind === 'bear' || kind === 'dog' ? -6 : -8);
      g.beginPath();
      g.moveTo(-13, my); g.quadraticCurveTo(0, my + 20, 13, my); g.closePath();
      g.fillStyle = '#c2455a'; g.fill();
      g.lineWidth = 4; g.strokeStyle = OL; g.stroke();
      g.fillStyle = '#ff9db0'; ell(g, 0, my + 8, 6.5, 3.6); g.fill();
    } else {
      const my = kind === 'pig' ? 3 : (kind === 'bear' || kind === 'dog' ? -5 : -7);
      g.strokeStyle = OL; g.lineWidth = 4;
      g.beginPath();
      g.moveTo(-9, my - 2); g.quadraticCurveTo(-4.5, my + 4, 0, my - 2);
      g.quadraticCurveTo(4.5, my + 4, 9, my - 2);
      g.stroke();
    }
    // うさぎの 前歯
    if (kind === 'rabbit' && !sm) {
      g.fillStyle = '#fff';
      A.roundRect(g, -6.5, -6, 6, 9, 2); g.fill();
      g.lineWidth = 2.5; g.strokeStyle = 'rgba(74,58,42,0.7)'; g.stroke();
      A.roundRect(g, 0.5, -6, 6, 9, 2); g.fill(); g.stroke();
    }

    /* ---------- ぼうし ---------- */
    if (a.hat && a.hat !== 'none') drawHat(g, a.hat, headTop + 8, hx * 0.95);

    /* ---------- かえるの 出目（ぼうしより 前） ---------- */
    if (kind === 'frog') {
      [-1, 1].forEach(function (sd, si) {
        const px = sd * 27, py = headTop - 2;
        g.beginPath(); g.arc(px, py, 16, 0, TAU);
        g.fillStyle = rad(g, 'frog:eye' + si, px - 6, py - 7, 2, px, py, 19, K.lite, K.col);
        g.fill();
        g.lineWidth = 5.5; g.strokeStyle = OL; g.stroke();
        if (sm) {
          g.strokeStyle = '#2b1a14'; g.lineWidth = 5;
          g.beginPath();
          g.moveTo(px - 9, py + 3); g.quadraticCurveTo(px, py - 9, px + 9, py + 3);
          g.stroke();
        } else {
          g.fillStyle = '#fff'; ell(g, px, py + 1, 10.5, 10.5); g.fill();
          g.fillStyle = '#2b1a14'; ell(g, px + sd * 1.5, py + 1, 5, 6.5); g.fill();
          g.fillStyle = '#fff'; ell(g, px + sd * 1.5 - 1.8, py - 2, 2.4, 2.6); g.fill();
          g.beginPath(); g.arc(px + sd * 1.5 + 2, py + 5, 1.4, 0, TAU); g.fill();
        }
      });
    }

    /* ---------- わらっている しるし（きらめき） ---------- */
    if (sm) {
      g.lineWidth = 2.5; g.strokeStyle = 'rgba(240,180,41,0.9)';
      [[-(hx + 13), -40, 8], [hx + 13, -52, 6.5]].forEach(function (p) {
        starPath(g, p[0], p[1], p[2], p[2] * 0.34, 4, 0.3);
        g.fillStyle = 'rgba(255,245,170,0.95)'; g.fill(); g.stroke();
      });
    }

    /* ---------- もちもの（右手に かかげる） ---------- */
    if (a.item && a.item !== 'none') {
      g.save();
      g.translate(S.bw + 12, 4 + w * 4);
      drawItem(g, a.item);
      g.restore();
    }
    g.restore();
  }

  /* =========================================================
     お題の 絵（crit → 絵）
       cell＝入れたい 四角の 大きさ。原点を 中心に 描く
     ========================================================= */
  function drawCritArt(g, crit, cell) {
    if (!crit) return;
    if (crit.kind) {
      const a = {
        kind: crit.kind, hat: crit.hat || 'none', item: 'none',
        smile: !!crit.smile, lane: 0, ph: 0, icon: true,
      };
      const s = cell / 190;
      g.save(); g.scale(s, s); g.translate(0, 24); drawAnimal(g, 0, 0, a, 0); g.restore();
    } else if (crit.hat) {
      const s = cell / 126;
      g.save(); g.scale(s, s); g.translate(0, -5); drawHat(g, crit.hat, 42, 52); g.restore();
    } else if (crit.item) {
      // もちものは かたちが ちがうので、中心と 大きさを 品物ごとに そろえる
      const B = ({ banana: [3, -5, 72], balloon: [2, -19, 96], flag: [16, -12, 96] })[crit.item] || [0, 0, 90];
      const s = cell / B[2];
      g.save(); g.scale(s, s); g.translate(-B[0], -B[1]); drawItem(g, crit.item); g.restore();
    }
  }
  // お題の 絵を 置くための うすい まる（文字と 絵を 分ける）
  function drawArtPlate(g, cx, cy, r) {
    g.save();
    g.beginPath(); g.arc(cx, cy, r, 0, TAU);
    const pg = g.createRadialGradient(cx - r * 0.4, cy - r * 0.5, r * 0.1, cx, cy, r * 1.1);
    pg.addColorStop(0, '#fffdf6'); pg.addColorStop(1, '#ffeccf');
    g.fillStyle = pg; g.fill();
    g.strokeStyle = '#f0b26a'; g.lineWidth = 5; g.setLineDash([13, 11]); g.stroke();
    g.setLineDash([]);
    g.restore();
  }
  /* テスト用：お題の 絵を どこに 描いたかの 記録（画面の 座標）
     big＝お題の 画面／small＝パレード中の 帯／pad＝こたえる 画面／review＝こたえあわせ */
  const ART_LOG = { big: null, small: null, pad: null, review: null };
  function markArt(g, where, artCx, cy, r, textLeft, crit) {
    let m = null;
    try { m = g.getTransform(); } catch (e) { m = null; }
    const tp = function (px, py) {
      if (!m) return { x: px, y: py };
      return { x: m.a * px + m.c * py + m.e, y: m.b * px + m.d * py + m.f };
    };
    const c = tp(artCx, cy), edge = tp(artCx + r, cy), tl = tp(textLeft, cy);
    const prev = ART_LOG[where];
    ART_LOG[where] = {
      n: (prev ? prev.n : 0) + 1,
      x: Math.round(c.x), y: Math.round(c.y),
      r: Math.round(edge.x - c.x),
      textX: Math.round(tl.x),
      crit: crit ? Object.keys(crit).sort().join('+') : null,
    };
  }

  // お題（絵＋文字）を よこ ならびで 描く。cx,cy＝ならびの 中心
  function drawQuestionRow(g, q, cx, cy, cell, size, maxTextW, where) {
    const txt = q ? q.text : '';
    g.save();
    g.font = A.font(size);
    let tw = g.measureText(txt).width;
    let fs = size;
    if (tw > maxTextW) {
      fs = Math.max(26, Math.floor(size * maxTextW / tw));
      g.font = A.font(fs);
      tw = g.measureText(txt).width;
    }
    g.restore();
    const gap = Math.round(cell * 0.14);
    const totalW = cell + gap + tw;
    const left = cx - totalW / 2;
    const artCx = left + cell / 2;
    drawArtPlate(g, artCx, cy, cell * 0.5);
    g.save();
    g.translate(artCx, cy);
    drawCritArt(g, q ? q.crit : null, cell * 0.94);
    g.restore();
    A.text(g, txt, left + cell + gap, cy, { size: fs, color: '#3a2a1c', align: 'left' });
    if (where) markArt(g, where, artCx, cy, cell * 0.5, left + cell + gap, q ? q.crit : null);
    return { artCx: artCx, textW: tw, size: fs, w: totalW };
  }

  /* =========================================================
     背景：お祭りの 沿道
     ※ 背景は 彩度を おとす。主役は どうぶつ
     ========================================================= */
  function drawBg(g, t, scroll) {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#ffdcb0');
    sky.addColorStop(0.42, '#ffeed6');
    sky.addColorStop(1, '#fdf8ec');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);

    // ---- おひさま（左上）----
    g.save();
    const sx = 250, sy = 150;
    const sg = g.createRadialGradient(sx, sy, 10, sx, sy, 230);
    sg.addColorStop(0, 'rgba(255,240,190,0.95)');
    sg.addColorStop(0.3, 'rgba(255,224,160,0.45)');
    sg.addColorStop(1, 'rgba(255,220,150,0)');
    g.fillStyle = sg; g.beginPath(); g.arc(sx, sy, 230, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,214,130,0.55)'; g.lineWidth = 7; g.lineCap = 'round';
    for (let i = 0; i < 12; i++) {
      const an = i * TAU / 12 + t * 0.12;
      g.beginPath();
      g.moveTo(sx + Math.cos(an) * 96, sy + Math.sin(an) * 96);
      g.lineTo(sx + Math.cos(an) * 128, sy + Math.sin(an) * 128);
      g.stroke();
    }
    g.beginPath(); g.arc(sx, sy, 78, 0, TAU);
    g.fillStyle = '#ffe9a8'; g.fill();
    g.strokeStyle = 'rgba(230,170,60,0.5)'; g.lineWidth = 6; g.stroke();
    g.restore();

    // ---- とおくの くも ----
    g.save();
    g.fillStyle = 'rgba(255,255,255,0.62)';
    for (let i = 0; i < 5; i++) {
      const x = ((i * 470 - scroll * 0.05) % (W + 520) + W + 520) % (W + 520) - 260;
      const y = 180 + (i % 3) * 64;
      [[0, 0, 62, 30], [-52, 10, 44, 22], [54, 12, 40, 20]].forEach(function (p) {
        ell(g, x + p[0], y + p[1], p[2], p[3]); g.fill();
      });
    }
    g.restore();

    // ---- とおくの 町（彩度を おとす）----
    g.save();
    for (let i = 0; i < 8; i++) {
      const x = ((i * 272 - scroll * 0.16) % (W + 320) + W + 320) % (W + 320) - 160;
      const hh = 196 + (i % 3) * 36;
      const top = 600 - hh;
      const wall = ['#e9cdb4', '#cfd9e4', '#eadfbe', '#dcd0c4'][i % 4];
      g.fillStyle = wall;
      g.fillRect(x, top, 196, hh);
      g.strokeStyle = 'rgba(90,70,50,0.18)'; g.lineWidth = 4;
      g.strokeRect(x, top, 196, hh);
      // やね
      g.fillStyle = ['#c09086', '#9fa8b4', '#c0a888'][i % 3];
      g.beginPath();
      g.moveTo(x - 18, top); g.lineTo(x + 98, top - 62); g.lineTo(x + 214, top); g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(90,70,50,0.2)'; g.lineWidth = 4; g.stroke();
      // まど
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 2; c++) {
          g.fillStyle = 'rgba(255,240,205,0.85)';
          A.roundRect(g, x + 32 + c * 86, top + 34 + r * 78, 56, 46, 8); g.fill();
          g.strokeStyle = 'rgba(120,95,70,0.3)'; g.lineWidth = 3; g.stroke();
        }
      }
      // ひさし（しましま）
      for (let k = 0; k < 4; k++) {
        g.fillStyle = k % 2 ? 'rgba(220,120,110,0.5)' : 'rgba(255,250,240,0.7)';
        g.fillRect(x + 18 + k * 40, 574, 40, 16);
      }
      g.strokeStyle = 'rgba(90,70,50,0.18)'; g.lineWidth = 3;
      g.strokeRect(x + 18, 574, 160, 16);
    }
    g.restore();

    // ---- のぼり（たての はた）----
    g.save();
    for (let i = 0; i < 6; i++) {
      const x = ((i * 400 - scroll * 0.3) % (W + 520) + W + 520) % (W + 520) - 260;
      g.strokeStyle = '#b99a6e'; g.lineWidth = 7; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, 656); g.lineTo(x, 430); g.stroke();
      const col = ['#d8656f', '#5f94c8', '#d8ad4a'][i % 3];
      g.beginPath();
      g.moveTo(x + 3, 436);
      g.lineTo(x + 50, 436 + Math.sin(t * 1.6 + i) * 5);
      g.lineTo(x + 50, 580 + Math.sin(t * 1.6 + i) * 5);
      g.lineTo(x + 3, 580);
      g.closePath();
      g.fillStyle = col; g.globalAlpha = 0.82; g.fill(); g.globalAlpha = 1;
      g.strokeStyle = 'rgba(80,60,45,0.25)'; g.lineWidth = 3; g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.8)';
      [0, 1, 2].forEach(function (k) {
        g.beginPath(); g.arc(x + 26, 474 + k * 46, 11, 0, TAU); g.fill();
      });
      g.beginPath(); g.arc(x, 426, 8, 0, TAU);
      g.fillStyle = '#e8c87a'; g.fill();
      g.strokeStyle = 'rgba(80,60,45,0.3)'; g.lineWidth = 3; g.stroke();
    }
    g.restore();

    // ---- 沿道の 観客（色は おさえる）----
    g.save();
    const pbody = ['#b9a79a', '#a6b4c0', '#c0a9a0', '#a9b49c', '#bfb094', '#b0a4bb'];
    const pskin = ['#e8cbb0', '#dcb894', '#f0d6bd'];
    for (let i = 0; i < 30; i++) {
      const x = ((i * 76 - scroll * 0.4) % (W + 220) + W + 220) % (W + 220) - 110;
      const hh = 28 + (i % 3) * 7;
      const base = 652 + (i % 2) * 5;
      g.fillStyle = pbody[i % pbody.length];
      A.roundRect(g, x - 14, base - hh, 28, hh + 8, 11); g.fill();
      // ふっている 手
      g.strokeStyle = pskin[i % 3]; g.lineWidth = 6; g.lineCap = 'round';
      const wav = Math.sin(t * 5 + i) * 7;
      g.beginPath();
      g.moveTo(x + 10, base - hh + 8); g.lineTo(x + 20, base - hh - 6 + wav);
      g.stroke();
      g.beginPath(); g.arc(x, base - hh - 11, 12, 0, TAU);
      g.fillStyle = pskin[i % 3]; g.fill();
      g.fillStyle = 'rgba(70,55,45,0.55)';
      g.beginPath(); g.arc(x, base - hh - 19, 12, Math.PI * 1.08, Math.PI * 1.92); g.fill();
    }
    // さく
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(0, 648); g.lineTo(W, 648); g.stroke();
    for (let x = -((scroll * 0.4) % 76); x < W + 76; x += 76) {
      g.beginPath(); g.moveTo(x, 640); g.lineTo(x, 662); g.stroke();
    }
    g.restore();

    // ---- 道 ----
    const road = g.createLinearGradient(0, 660, 0, H);
    road.addColorStop(0, '#eae2d1');
    road.addColorStop(1, '#d6cdb8');
    g.fillStyle = road; g.fillRect(0, 660, W, H - 660);
    g.strokeStyle = '#bdb39c'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, 662); g.lineTo(W, 662); g.stroke();
    // まんなかの じゅうたん（パレードの コース）
    g.save();
    g.globalAlpha = 0.45;
    g.fillStyle = '#f6f0e2';
    g.fillRect(0, 770, W, 150);
    g.globalAlpha = 0.3;
    g.fillStyle = '#cfc2a6';
    for (let x = -((scroll * 0.6) % 180); x < W; x += 180) g.fillRect(x, 770, 92, 150);
    g.restore();
    // 道の しま
    g.save();
    g.globalAlpha = 0.55;
    g.fillStyle = '#f7f2e6';
    for (let x = -((scroll * 0.9) % 160); x < W; x += 160) g.fillRect(x, 1000, 90, 14);
    g.restore();

    // ---- 万国旗（上に 2れつ）----
    drawGarland(g, 56, 30, '#b08a5a', 100, 0.4);
    drawGarland(g, 124, 22, '#c0996a', 112, 2.1);

    // ---- 紙ふぶき（上のほうだけ。キャラの 邪魔を しない）----
    g.save();
    const ccols = ['#f4a0ad', '#ffd98a', '#9fd7a0', '#9fc6ef', '#d7aee8'];
    for (let i = 0; i < 40; i++) {
      const r1 = ((i * 97) % 100) / 100, r2 = ((i * 53) % 100) / 100, r3 = ((i * 29) % 100) / 100;
      const x = (r1 * W + Math.sin(t * 0.9 + i) * 46 + W) % W;
      const yy = ((t * (52 + r2 * 56) + r3 * 820) % 820) - 40;
      const al = yy > 520 ? Math.max(0, (640 - yy) / 120) * 0.5 : 0.5;
      if (al <= 0) continue;
      g.globalAlpha = al;
      g.fillStyle = ccols[i % ccols.length];
      g.save();
      g.translate(x, yy);
      g.rotate(t * (1.4 + r2) + i);
      g.fillRect(-6, -3.5, 12, 7);
      g.restore();
    }
    g.restore();
  }

  // 万国旗：ひもに 四角い はたが ならぶ
  function drawGarland(g, y0, sag, rope, step, phase) {
    const cols = ['#e07b86', '#e8c45c', '#73b76c', '#6fa4d8', '#b98cc8', '#e09a6a'];
    g.save();
    g.lineCap = 'round';
    g.strokeStyle = rope; g.lineWidth = 5;
    g.beginPath();
    for (let x = 0; x <= W; x += 24) {
      const y = y0 + Math.sin(x / 300 + phase) * sag + Math.sin(x / 90) * 4;
      if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    for (let i = 0; i * step <= W + step; i++) {
      const x = i * step + 20;
      const y = y0 + Math.sin(x / 300 + phase) * sag + Math.sin(x / 90) * 4;
      const tilt = Math.cos(x / 300 + phase) * 0.12;
      g.save();
      g.translate(x, y);
      g.rotate(tilt);
      if (i % 2) {
        // 四角い はた
        g.fillStyle = cols[i % cols.length];
        g.globalAlpha = 0.92;
        g.fillRect(-26, 2, 52, 42);
        g.globalAlpha = 1;
        g.fillStyle = 'rgba(255,255,255,0.55)';
        g.fillRect(-26, 2, 52, 9);
        g.strokeStyle = 'rgba(80,60,45,0.22)'; g.lineWidth = 3;
        g.strokeRect(-26, 2, 52, 42);
      } else {
        // 三角の はた
        g.beginPath();
        g.moveTo(-26, 2); g.lineTo(26, 2); g.lineTo(0, 54); g.closePath();
        g.fillStyle = cols[i % cols.length];
        g.globalAlpha = 0.92; g.fill(); g.globalAlpha = 1;
        g.strokeStyle = 'rgba(80,60,45,0.22)'; g.lineWidth = 3; g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.5)';
        g.beginPath();
        g.moveTo(-20, 6); g.lineTo(-6, 6); g.lineTo(-13, 20); g.closePath(); g.fill();
      }
      g.restore();
    }
    g.restore();
  }

  // メニューのカードは たての まん中あたりだけ 見えるので、中身を 上に よせる
  function drawThumb(g) {
    const s = 552 / W;
    g.save();
    g.scale(s, s);
    g.translate(0, -150);
    g.fillStyle = '#ffe1b8'; g.fillRect(0, -220, W, 240);
    drawBg(g, 0, 0);
    const demo = [
      { kind: 'rabbit', hat: 'red', item: 'banana', smile: true, ph: 0 },
      { kind: 'cat', hat: 'none', item: 'balloon', smile: true, ph: 1 },
      { kind: 'bear', hat: 'blue', item: 'none', smile: false, ph: 2 },
      { kind: 'pig', hat: 'yellow', item: 'flag', smile: true, ph: 3 },
    ];
    demo.forEach(function (a, i) {
      g.save();
      g.translate(260 + i * 470, 830);
      g.scale(1.45, 1.45);
      drawAnimal(g, 0, 0, a, 0.4);
      g.restore();
    });
    g.restore();
  }

  /* ---------- あそびかたの アイコン ---------- */
  const SVG_WATCH = '<svg viewBox="0 0 64 64"><ellipse cx="32" cy="32" rx="28" ry="17" fill="#fff" stroke="#4a3a2a" stroke-width="4"/>' +
    '<circle cx="32" cy="32" r="10" fill="#3f8ae0" stroke="#4a3a2a" stroke-width="3"/></svg>';
  const SVG_COUNT = '<svg viewBox="0 0 64 64"><rect x="8" y="10" width="48" height="44" rx="8" fill="#fff" stroke="#4a3a2a" stroke-width="4"/>' +
    '<text x="32" y="44" font-size="30" text-anchor="middle" fill="#e07b2a" font-family="sans-serif" font-weight="bold">7</text></svg>';
  const SVG_TEAM = '<svg viewBox="0 0 64 64"><circle cx="16" cy="24" r="11" fill="#f6a15c" stroke="#4a3a2a" stroke-width="3"/>' +
    '<circle cx="32" cy="20" r="11" fill="#f7f3ea" stroke="#4a3a2a" stroke-width="3"/>' +
    '<circle cx="48" cy="24" r="11" fill="#8fd47a" stroke="#4a3a2a" stroke-width="3"/>' +
    '<path d="M6 54 q26 -12 52 0" stroke="#4a3a2a" stroke-width="4" fill="none" stroke-linecap="round"/></svg>';
  const SVG_LIFE = '<svg viewBox="0 0 64 64"><path d="M32 54 C8 38 8 18 20 14 C27 11 32 18 32 18 C32 18 37 11 44 14 C56 18 56 38 32 54z" fill="#ff7fa8" stroke="#4a3a2a" stroke-width="4"/></svg>';

  /* =========================================================
     ゲーム登録
     ========================================================= */
  A.register({
    id: 'parade',
    order: 6,
    title: 'なんびきパレード',
    shortTitle: 'パレード',
    catch: 'みんなで 見て 数えよう！ 1〜3人で きょうりょく',
    tags: ['1〜3人', 'マウス', 'きょうりょく'],
    isNew: true,
    modesCompact: true,
    theme: { main: '#e07b2a', dark: '#b85c12', light: '#fff0dc' },
    bgm: 'parade',
    howto: [
      { icon: SVG_WATCH, html: 'どうぶつの パレードを <b>よく 見る</b>' },
      { icon: SVG_COUNT, html: 'お題の どうぶつが <b>なんびき いたか</b> 数字で こたえる' },
      { icon: SVG_TEAM, html: '3人なら <b>ひだり・まんなか・みぎ</b> で 分たんすると かぞえやすい' },
      { icon: SVG_LIFE, html: 'まちがえると ハートが へる。<b>ぜんぶ こたえたら クリア！</b>' },
    ],
    modes: [
      {
        id: 'p1', label: '1人で', sub: 'ひとりでも 遊べる', recommend: true,
        children: LEVEL_IDS.map(function (k, i) {
          return { id: 'p1-' + k, label: LEVELS[k].label, sub: qCountOf(k, 1) + 'もん', desc: levelDesc(k, 1), recommend: i === 0 };
        }),
      },
      {
        id: 'p2', label: '2人で', sub: 'ふたりで 分たん',
        children: LEVEL_IDS.map(function (k, i) {
          return { id: 'p2-' + k, label: LEVELS[k].label, sub: qCountOf(k, 2) + 'もん', desc: levelDesc(k, 2), recommend: i === 0 };
        }),
      },
      {
        id: 'p3', label: '3人で', sub: 'さんにんで 分たん',
        children: LEVEL_IDS.map(function (k, i) {
          return { id: 'p3-' + k, label: LEVELS[k].label, sub: qCountOf(k, 3) + 'もん', desc: levelDesc(k, 3), recommend: i === 0 };
        }),
      },
    ],
    rank: {
      boards: [
        { id: 'parade.easy', label: 'やさしい クリア', short: 'やさしい', kind: 'clear' },
        { id: 'parade.normal', label: 'ふつう クリア', short: 'ふつう', kind: 'clear' },
        { id: 'parade.hard', label: 'むずかしい クリア', short: 'むずかしい', kind: 'clear' },
        { id: 'parade.chaos', label: 'げきむず クリア', short: 'げきむず', kind: 'clear' },
      ],
      boardOf: function (opts) {
        const m = (opts && opts.mode) || '';
        const k = m.split('-')[1];
        return LEVELS[k] ? 'parade.' + k : null;
      },
    },
    bestHtml: function (store) {
      const parts = LEVEL_IDS.map(function (k) {
        const v = Number(store.get('parade.best.' + k, 0)) || 0;
        return LEVELS[k].label + ' <b>' + (v > 0 ? v + 'もん' : '−') + '</b>';
      });
      return 'せいかい きろく：' + parts.join('　／　');
    },
    drawThumb: drawThumb,
    create: createGame,
  });

  function levelDesc(k, n) {
    const L = LEVELS[k], P = playerOf(k, n);
    const total = Math.round(L.total * P.total);
    const names = { easy: 'しゅるいを 数えるだけ', normal: 'ぼうしの色・もちものも 出る', hard: '2列で ながれる。しゅるいだけの お題は 出ない', chaos: 'とても 多くて はやい。2つの じょうけんが よく 出る' };
    return names[k] + '（およそ ' + total + 'ひき・' + qCountOf(k, n) + 'もん）';
  }

  /* =========================================================
     本体
     ========================================================= */
  function createGame(api) {
    const seedQ = api.params.get('seed');
    const rnd = api.rng((seedQ !== null && seedQ !== '' && isFinite(Number(seedQ))) ? (Number(seedQ) >>> 0) : ((Math.random() * 1e9) >>> 0));

    let L = LEVELS.easy, P = PLAYERS[1];
    let mode = 'demo';       // demo | count | show | parade | answer | judge | review | end
    let T = 0, stateT = 0, scroll = 0;
    let qIndex = 0, correct = 0, lives = LIFE_MAX;
    let qTotal = PLAYERS[1].q;   // この回の 出題数（人数 ＋ 難易度の おまけ）
    let crowd = [];          // いまの お題の どうぶつたち
    let question = null;     // { text, answer, type, crit }
    let input = '';
    let lastOk = false, lastAns = 0;
    let finished = false, hold = false;
    let shake = 0;
    const stats = { questions: [], totalAnimals: 0 };

    /* ---------- こたえあわせ（ならべて 数えなおす）の じょうたい ---------- */
    let revHit = [];         // お題に 合う子の 位置（crowd の index）
    let revShown = 0;        // いま 何ひきめまで 番号を 付けたか
    let revStep = 0.34;      // 1ぴき 付けるのに かかる 時間
    let revDone = false;     // ぜんぶ 出しおわったか
    let revT = 0;            // 出しおわってからの 時間
    let revGrid = null;      // ならべ方（行・列・大きさ）
    let revSeq = 0;          // 何もんめの こたえあわせか（ため込んだ 絵の 作りなおし用）

    // R6b：どうぶつが 1.25倍に なったので、2列の あいだを 広げた
    //   （おくの列の からだが、前の列の ぼうしで かくれないように）
    const ROAD_Y = [872, 646];   // 1列目・2列目（おくが 上）

    function bestKey() { return 'parade.best.' + L.id; }

    /* ---------- パレードを つくる ---------- */
    function makeCrowd() {
      const pool = KIND_IDS.slice();
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      const use = pool.slice(0, L.kinds);
      const total = Math.max(4, Math.round(L.total * P.total));
      const lanes = L.lanes;
      const list = [];
      const perLane = Math.ceil(total / lanes);
      for (let i = 0; i < total; i++) {
        const lane = i % lanes;
        const idx = Math.floor(i / lanes);
        // ばらつき：大きくした どうぶつが 重ならないよう 0.45 → 0.22 に おさえた
        const jitter = (rnd() - 0.5) * L.gap * 0.22;
        list.push({
          kind: use[Math.floor(rnd() * use.length)],
          hat: rnd() < L.hatP ? HAT_IDS[Math.floor(rnd() * HAT_IDS.length)] : 'none',
          item: rnd() < L.itemP ? ITEM_IDS[Math.floor(rnd() * ITEM_IDS.length)] : 'none',
          smile: rnd() < 0.55,
          lane: lane,
          x: W + 180 + idx * L.gap + jitter + lane * L.gap * 0.5,
          ph: rnd() * 6.28,
        });
      }
      stats.totalAnimals += total;
      return { list: list, use: use, perLane: perLane };
    }

    /* ---------- お題を つくる ---------- */
    function makeQuestion(c) {
      const types = L.qt.slice();
      // こたえが 0 に ならないものを さがす（やさしいは とくに）
      for (let tryN = 0; tryN < 30; tryN++) {
        const ty = types[Math.floor(rnd() * types.length)];
        let text = '', crit = {};
        if (ty === 1) {
          const k = c.use[Math.floor(rnd() * c.use.length)];
          text = KINDS[k].name + 'は なんびき？';
          crit = { kind: k };
        } else if (ty === 2) {
          const h = HAT_IDS[Math.floor(rnd() * HAT_IDS.length)];
          text = HATS[h].name + ' ぼうしの子は なんびき？';
          crit = { hat: h };
        } else if (ty === 3) {
          const it = ITEM_IDS[Math.floor(rnd() * ITEM_IDS.length)];
          text = ITEMS[it].name + 'を もっていた子は なんびき？';
          crit = { item: it };
        } else if (ty === 4) {
          const k = c.use[Math.floor(rnd() * c.use.length)];
          const h = HAT_IDS[Math.floor(rnd() * HAT_IDS.length)];
          text = HATS[h].name + ' ぼうしの ' + KINDS[k].name + 'は なんびき？';
          crit = { kind: k, hat: h };
        } else {
          const k = c.use[Math.floor(rnd() * c.use.length)];
          text = 'わらっている ' + KINDS[k].name + 'は なんびき？';
          crit = { kind: k, smile: true };
        }
        // 数えるのは matches() だけ（こたえあわせの しるしと 同じ ものさし）
        const n = countMatches(c.list, crit);
        const minN = (L.id === 'easy' || L.id === 'normal') ? 1 : 0;
        if (n >= minN) return { text: text, answer: n, type: ty, crit: crit };
      }
      // どうしても 見つからないときは しゅるいで 出す
      const k = c.use[0];
      const crit = { kind: k };
      return { text: KINDS[k].name + 'は なんびき？', answer: countMatches(c.list, crit), type: 1, crit: crit };
    }

    function nextQuestion() {
      const c = makeCrowd();
      crowd = c.list;
      question = makeQuestion(c);
      input = '';
      mode = 'show';
      stateT = 0;
    }

    function reset(opts) {
      const m = (opts && opts.mode) || 'p1-easy';
      const pn = Number(m.charAt(1)) || 1;
      const lk = m.split('-')[1];
      L = LEVELS[lk] || LEVELS.easy;
      P = playerOf(L.id, pn);          // 1人のときの 割引は 難易度ごと（SOLO）
      qTotal = qCountOf(L.id, P.n);
      qIndex = 0; correct = 0; lives = LIFE_MAX;
      crowd = []; question = null; input = '';
      finished = false; shake = 0;
      stats.questions = []; stats.totalAnimals = 0;
      revHit = []; revShown = 0; revDone = false; revT = 0; revGrid = null; revSeq++;
    }


    /* ---------- こたえあわせ ---------- */
    function submit() {
      if (mode !== 'answer' || input === '') return;
      const v = parseInt(input, 10);
      if (!isFinite(v)) return;
      lastAns = v;
      lastOk = (v === question.answer);
      stats.questions.push({ q: question.text, answer: question.answer, given: v, ok: lastOk, type: question.type });
      // ○✕ は judge の 画面と こたえあわせで 出すので、ふきだしは 出さない
      if (lastOk) {
        correct++;
        api.sfx('coin');
      } else {
        lives--;
        shake = 0.3;
        api.sfx('bad');
      }
      prepReview();
      mode = 'judge';
      stateT = 0;
    }

    /* ---------- こたえあわせの したく ----------
       その回に 出た どうぶつ（crowd）の うち、お題に 合う子を 見つけておく。
       判定は matches() だけ。答えの 数（question.answer）と ずれない。 */
    function prepReview() {
      revHit = [];
      for (let i = 0; i < crowd.length; i++) if (matches(crowd[i], question.crit)) revHit.push(i);
      revGrid = layoutReview(crowd.length);
      revShown = 0;
      revDone = false;
      revT = 0;
      revSeq++;
      // 番号を 1つ 付ける ペース（多いときは はやく。ぜんぶで 2.6秒くらい）
      revStep = revHit.length > 0 ? Math.max(0.13, Math.min(0.4, 2.6 / revHit.length)) : 0;
    }

    function afterJudge() {
      qIndex++;
      if (lives <= 0) { end(false); return; }
      if (qIndex >= qTotal) { end(true); return; }
      nextQuestion();
    }

    function end(cleared) {
      if (finished) return;
      finished = true;
      mode = 'end';
      stateT = 0;
      const prev = Number(api.store.get(bestKey(), 0)) || 0;
      if (correct > prev) api.store.set(bestKey(), correct);
      api.sfx(cleared ? 'win' : 'finish');
      const sub = 'せいかい <b>' + correct + '</b> / ' + qTotal +
        '　のこり ハート <b>' + Math.max(0, lives) + '</b>' +
        '　<b>' + P.label + '・' + L.label + '</b>';
      api.finish({
        score: cleared ? 1 : 0,     // クリア者リスト
        ribbon: cleared ? 'クリア！！' : 'ざんねん…',
        headline: cleared ? (P.label + '・' + L.label + ' クリア！') : ('せいかい ' + correct + 'もん'),
        big: correct + ' / ' + qTotal,
        sub: sub,
        delay: 1200,
      });
    }

    /* =========================================================
       update
       ========================================================= */
    function update(dt) {
      if (hold) return;
      T += dt;
      if (shake > 0) shake = Math.max(0, shake - dt);

      if (mode === 'demo') { demo(dt); return; }
      if (mode === 'count') {
        stateT += dt;
        const was = Math.ceil(3 - (stateT - dt));
        const now = Math.ceil(3 - stateT);
        if (now !== was && now >= 0) api.sfx(now === 0 ? 'go' : 'count');
        if (stateT >= 3) nextQuestion();
        return;
      }
      if (mode === 'show') {
        stateT += dt;
        if (stateT >= SHOW_Q) { mode = 'parade'; stateT = 0; }
        return;
      }
      if (mode === 'parade') {
        stateT += dt;
        const v = L.v * P.v;
        scroll += v * dt;
        let anyLeft = false;
        for (let i = 0; i < crowd.length; i++) {
          crowd[i].x -= v * dt;
          if (crowd[i].x > -200) anyLeft = true;
        }
        if (!anyLeft) { mode = 'answer'; stateT = 0; }
        return;
      }
      if (mode === 'answer') { stateT += dt; return; }
      if (mode === 'judge') {
        // ○✕ を すぐ 見せて、そのあと こたえあわせ（ならべて 数えなおす）へ
        stateT += dt;
        if (stateT >= JUDGE_T) { mode = 'review'; stateT = 0; }
        return;
      }
      if (mode === 'review') {
        stateT += dt;
        if (!revDone) {
          const el = stateT - REV_IN;      // ならべ終わってからの 時間
          let want = 0;
          if (el >= 0 && revStep > 0) want = Math.min(revHit.length, Math.floor(el / revStep) + 1);
          while (revShown < want) { revShown++; api.sfx('pop'); }
          if (el >= 0 && revShown >= revHit.length) {
            revDone = true; revT = 0;
            api.sfx(revHit.length > 0 ? 'sparkle' : 'tick');
          }
        } else {
          revT += dt;
          if (revT >= REV_HOLD) afterJudge();
        }
        return;
      }
      if (mode === 'end') { stateT += dt; scroll += 120 * dt; return; }
    }

    let demoT = 0;
    function demo(dt) {
      scroll += 240 * dt;
      demoT -= dt;
      if (demoT <= 0) {
        crowd.push({
          kind: KIND_IDS[Math.floor(rnd() * KIND_IDS.length)],
          hat: rnd() < 0.6 ? HAT_IDS[Math.floor(rnd() * HAT_IDS.length)] : 'none',
          item: rnd() < 0.5 ? ITEM_IDS[Math.floor(rnd() * ITEM_IDS.length)] : 'none',
          smile: rnd() < 0.6, lane: 0, x: W + 160, ph: rnd() * 6.28,
        });
        demoT = 0.62;
      }
      for (let i = crowd.length - 1; i >= 0; i--) {
        crowd[i].x -= 240 * dt;
        if (crowd[i].x < -220) crowd.splice(i, 1);
      }
    }

    /* =========================================================
       draw
       ========================================================= */
    function draw(g) {
      g.save();
      if (shake > 0) {
        const s = shake * 14;
        g.translate((rnd() - 0.5) * s, (rnd() - 0.5) * s);
      }
      // こたえあわせの あいだは お祭りの 背景を 描かない（重いし、どうぶつを 見せたいので）
      if (mode === 'review') drawRevBg(g);
      else drawBg(g, T, scroll);

      // どうぶつ（おくの列から 先に 描く）
      // こたえる・こたえあわせの あいだは パレードは 出さない（画面を すっきり させる）
      if (mode !== 'answer' && mode !== 'judge' && mode !== 'review') {
        const sorted = crowd.slice().sort(function (a, b) { return b.lane - a.lane; });
        sorted.forEach(function (a) {
          if (a.x < -280 || a.x > W + 300) return;
          const y = ROAD_Y[a.lane] || ROAD_Y[0];
          const sc = (a.lane === 1 ? 0.84 : 1) * ANIM_SCALE;
          g.save();
          g.translate(a.x, y);
          g.scale(sc, sc);
          drawAnimal(g, 0, 0, a, T);
          g.restore();
        });
      }

      // R6b：3人／2人モードの タテの 分たん線と「ひだり・みぎ」の 字は 消した。
      //   作者の指摘「分たんは 自分たちで やるから いらない。矢印が 見づらくなる」

      g.restore();

      if (mode === 'demo') return;
      if (mode === 'review') drawReview(g);
      drawHud(g);
      if (mode === 'count') drawCount(g);
      if (mode === 'show') drawQuestionBig(g);
      if (mode === 'parade') drawQuestionSmall(g);
      if (mode === 'answer' || mode === 'judge') drawPad(g);
    }

    /* =========================================================
       こたえあわせ：その回の どうぶつを ぜんぶ ならべ直して、
       お題に 合う子に 1・2・3… と 番号を 付けていく。合わない子は 薄く する。
       （作者の指摘「答え数字だけじゃちょっとあれ」への 直し）
       ※ 合うかどうかは matches() ＝ 答えを 数えたのと 同じ 関数しか つかわない
       ========================================================= */
    const REV_BOX = { x: 56, y: 366, w: W - 112, h: 634 };

    // 行の数を 1〜5 で ためして、いちばん 大きく 描ける ならべ方を えらぶ
    function layoutReview(n) {
      if (n <= 0) return { cols: 1, rows: 1, s: 1, cw: REV_BOX.w, ch: REV_BOX.h };
      let best = null;
      for (let rows = 1; rows <= 5; rows++) {
        const cols = Math.ceil(n / rows);
        const cw = REV_BOX.w / cols, ch = REV_BOX.h / rows;
        const s = Math.min(cw / ABOX.w, ch / ABOX.h);
        if (!best || s > best.s) best = { cols: cols, rows: rows, s: s, cw: cw, ch: ch };
      }
      best.s = Math.min(best.s, 1.15);   // 少ないときに 大きすぎないように
      return best;
    }

    // i ばんめの どうぶつを 置く 場所（ます の 中心）
    function revCell(G, i, n) {
      const r = Math.floor(i / G.cols), c = i % G.cols;
      const inRow = Math.min(G.cols, n - r * G.cols);      // この行に いる 数
      const rowW = inRow * G.cw;
      return {
        x: REV_BOX.x + (REV_BOX.w - rowW) / 2 + (c + 0.5) * G.cw,
        y: REV_BOX.y + (r + 0.5) * G.ch,
      };
    }

    /* ---- こたえあわせの 背景（かるい もの）---- */
    function drawRevBg(g) {
      g.fillStyle = cached(g, 'rev:bg', function (gg) {
        const gr = gg.createLinearGradient(0, 0, 0, H);
        gr.addColorStop(0, '#fff7ea');
        gr.addColorStop(0.55, '#fff2dd');
        gr.addColorStop(1, '#ffe8c8');
        return gr;
      });
      g.fillRect(0, 0, W, H);
    }

    /* ---- お題に 合わない子は 1もんに 1回だけ 描いて ため込む ----
       毎フレーム 43ひき 描くと 重い（自動テストで 23fps だった）ので、
       「合わない子（薄い子）」は 絵にして 貼るだけに する。
       お題に 合う子だけは 毎フレーム 描く（番号を 付けながら 動かすため）。 */
    let revCache = null;   // { c: canvas, ps: 画面倍率, seq: なんもんめ }

    function buildRevCache(ps) {
      const n = crowd.length;
      const G = revGrid || (revGrid = layoutReview(n));
      const cw = Math.max(1, Math.round(REV_BOX.w * ps));
      const ch = Math.max(1, Math.round(REV_BOX.h * ps));
      const c = (revCache && revCache.c) || document.createElement('canvas');
      if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
      const cg = c.getContext('2d');
      cg.setTransform(1, 0, 0, 1, 0, 0);
      cg.clearRect(0, 0, cw, ch);
      // 画面と 同じ 座標で 描けるように ずらす
      cg.setTransform(ps, 0, 0, ps, -REV_BOX.x * ps, -REV_BOX.y * ps);
      cg.globalAlpha = 0.22;
      for (let i = 0; i < n; i++) {
        const a = crowd[i];
        if (matches(a, question.crit)) continue;    // 合う子は あとで 生で 描く
        const p = revCell(G, i, n);
        cg.save();
        cg.translate(p.x, p.y);
        cg.scale(G.s, G.s);
        drawAnimal(cg, -ABOX.cx, -ABOX.cy, a, 0);  // 止めて ならべる
        cg.restore();
      }
      revCache = { c: c, ps: ps, seq: revSeq };
    }

    function drawReview(g) {
      const n = crowd.length;
      const G = revGrid || (revGrid = layoutReview(n));
      const found = revHit.length;

      /* ---- お題（絵つき）＝「なにを 数えたのか」---- */
      const cell = 112;
      g.save();
      g.font = A.font(44);
      let tw = g.measureText(question ? question.text : '').width;
      g.restore();
      if (tw > 1040) tw = 1040;
      const pw = Math.min(W - 120, cell + 22 + tw + 130);
      g.save();
      A.roundRect(g, W / 2 - pw / 2, 126, pw, 150, 34);
      g.fillStyle = '#fff'; g.fill();
      g.strokeStyle = '#e07b2a'; g.lineWidth = 8; g.stroke();
      g.restore();
      A.roundRect(g, W / 2 - 152, 108, 304, 54, 20);
      g.fillStyle = '#ffeccf'; g.fill();
      g.strokeStyle = '#f0b26a'; g.lineWidth = 5; g.stroke();
      A.text(g, 'こたえあわせ', W / 2, 135, { size: 32, color: '#b85c12' });
      drawQuestionRow(g, question, W / 2, 212, cell, 44, pw - cell - 134, 'review');

      /* ---- ○✕ と じぶんの こたえ ---- */
      const vcol = lastOk ? '#2f9e44' : '#e8264a';
      const vtxt = lastOk
        ? '○ せいかい！　きみの こたえ ' + lastAns + 'ひき'
        : '✕ ざんねん　きみの こたえ ' + lastAns + 'ひき';
      A.text(g, vtxt, W / 2, 318, { size: 42, color: vcol, stroke: '#fff', strokeWidth: 11 });

      /* ---- ぜんぶ ならべる ----
         合わない子（薄い子）は ため込んだ 絵を 貼るだけ。
         合う子は 生で 描いて、番号を 付けていく。 */
      let ps = 1;
      try { const m = g.getTransform(); if (m && m.a) ps = Math.abs(m.a); } catch (e) { ps = 1; }
      if (!revCache || revCache.seq !== revSeq || Math.abs(revCache.ps - ps) > 0.01) buildRevCache(ps);
      g.drawImage(revCache.c, REV_BOX.x, REV_BOX.y, REV_BOX.w, REV_BOX.h);

      for (let k = 0; k < revHit.length; k++) {
        const i = revHit[k];
        const a = crowd[i];
        const nth = k + 1;
        const on = nth <= revShown;
        const p = revCell(G, i, n);
        // 番号が ついた しゅんかんだけ ぽんと はねる
        const age = stateT - REV_IN - (nth - 1) * revStep;
        const jump = (on && nth === revShown && age >= 0 && age < 0.3) ? (1 - age / 0.3) : 0;
        const s = G.s * (1 + jump * 0.18);

        // 番号が ついた子の 下に しるしの 台
        if (on) {
          g.save();
          A.roundRect(g, p.x - G.cw * 0.44, p.y - G.ch * 0.45, G.cw * 0.88, G.ch * 0.9, 20);
          g.fillStyle = 'rgba(255,236,207,.96)'; g.fill();
          g.strokeStyle = '#e07b2a'; g.lineWidth = 5;
          g.setLineDash([13, 10]); g.stroke(); g.setLineDash([]);
          g.restore();
        }

        g.save();
        if (!on) g.globalAlpha = 0.22;             // まだ 番号が 来ていない子も 薄く
        g.translate(p.x, p.y);
        g.scale(s, s);
        drawAnimal(g, -ABOX.cx, -ABOX.cy, a, on ? T * 0.18 : 0);   // 番号が ついたら ゆっくり うごく
        g.restore();

        // 番号の まる（画面の 大きさで 描くので 小さく ならない）
        if (on) {
          const br = Math.max(17, Math.min(30, G.ch * 0.2));
          const bx = p.x - G.cw * 0.33, by = p.y - G.ch * 0.33;
          g.save();
          g.beginPath(); g.arc(bx, by, br * (1 + jump * 0.3), 0, TAU);
          g.fillStyle = '#e8364a'; g.fill();
          g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke();
          g.restore();
          A.text(g, String(nth), bx, by + 1, { size: br * 1.3, color: '#fff' });
        }
      }

      /* ---- 下の おび：かぞえた 数と「おすと つぎへ」---- */
      g.save();
      A.roundRect(g, W / 2 - 620, 1008, 1240, 62, 24);
      g.fillStyle = 'rgba(255,255,255,.95)'; g.fill();
      g.strokeStyle = '#e07b2a'; g.lineWidth = 6; g.stroke();
      g.restore();
      if (revDone) {
        // 「ぜんぶで ○ひき」（数字だけ 大きく）
        const numTxt = String(found);
        g.save(); g.font = A.font(62); const nw = g.measureText(numTxt).width; g.restore();
        const totalW = 196 + nw + 90;
        const lx = W / 2 - 150 - totalW / 2;
        A.text(g, 'ぜんぶで', lx, 1039, { size: 38, color: '#8a7a62', align: 'left' });
        A.text(g, numTxt, lx + 196 + nw / 2, 1038, { size: 62, color: '#b85c12' });
        A.text(g, 'ひき', lx + 196 + nw + 14, 1042, { size: 38, color: '#8a7a62', align: 'left' });
        if (found === 0) A.text(g, '（いなかったね）', lx + 196 + nw + 100, 1042, { size: 26, color: '#a99a82', align: 'left' });
      } else {
        A.text(g, 'かぞえているよ…　' + revShown + 'ひき', W / 2 - 150, 1039, { size: 40, color: '#8a7a62' });
      }
      A.text(g, 'おすと つぎへ', W / 2 + 480, 1041, { size: 28, color: '#a99a82' });
    }

    // キーか クリックで こたえあわせを 先へ（1回目＝ぜんぶ 出す／2回目＝つぎの もんだい）
    function reviewSkip() {
      if (mode !== 'review') return false;
      if (!revDone) {
        revShown = revHit.length;
        revDone = true; revT = 0;
        if (stateT < REV_IN) stateT = REV_IN;
        api.sfx('sparkle');
        return true;
      }
      api.sfx('select');
      afterJudge();
      return true;
    }

    function drawHud(g) {
      // もんだい数
      g.save();
      A.roundRect(g, 30, 20, 300, 96, 20);
      g.fillStyle = 'rgba(255,255,255,.93)'; g.fill();
      g.strokeStyle = '#e07b2a'; g.lineWidth = 6; g.stroke();
      g.restore();
      A.text(g, 'もんだい', 54, 46, { size: 24, color: '#8a7a62', align: 'left' });
      A.text(g, Math.min(qIndex + 1, qTotal) + ' / ' + qTotal, 54, 86, { size: 44, color: '#3a2a1c', align: 'left' });

      // ハート（右上には 音・ぜんがめんの ボタンが あるので そこまで 寄せない）
      const HX = 1250;
      g.save();
      A.roundRect(g, HX, 20, 300, 96, 20);
      g.fillStyle = 'rgba(255,255,255,.93)'; g.fill();
      g.strokeStyle = '#e07b2a'; g.lineWidth = 6; g.stroke();
      g.restore();
      for (let i = 0; i < LIFE_MAX; i++) {
        drawHeart(g, HX + 40 + i * 86, 68, i < lives);
      }

      // 人数・難易度
      A.text(g, P.label + '　' + L.label, 800, 56, { size: 36, color: '#b85c12', stroke: '#fff', strokeWidth: 8 });
    }

    function drawHeart(g, x, y, on) {
      g.save();
      g.translate(x, y);
      g.scale(1.1, 1.1);
      g.beginPath();
      g.moveTo(0, 20);
      g.bezierCurveTo(-26, 2, -22, -16, -10, -18);
      g.bezierCurveTo(-4, -19, 0, -12, 0, -12);
      g.bezierCurveTo(0, -12, 4, -19, 10, -18);
      g.bezierCurveTo(22, -16, 26, 2, 0, 20);
      g.closePath();
      g.fillStyle = on ? '#ff7fa8' : '#e2ddd4';
      g.fill();
      g.strokeStyle = on ? '#d8537e' : '#c5bfb4'; g.lineWidth = 4; g.stroke();
      g.restore();
    }

    // パレードが 始まる前の お題（絵＋文字）
    function drawQuestionBig(g) {
      const k = Math.min(1, stateT * 3);
      g.save();
      g.fillStyle = 'rgba(30,16,0,.20)'; g.fillRect(0, 0, W, H);
      g.translate(W / 2, H / 2 - 40);
      g.scale(0.9 + k * 0.1, 0.9 + k * 0.1);
      A.roundRect(g, -820, -186, 1640, 372, 44);
      g.fillStyle = '#fff'; g.fill();
      g.strokeStyle = '#e07b2a'; g.lineWidth = 10; g.stroke();
      // 「おだい」の ふだ
      A.roundRect(g, -112, -170, 224, 62, 22);
      g.fillStyle = '#ffeccf'; g.fill();
      g.strokeStyle = '#f0b26a'; g.lineWidth = 5; g.stroke();
      A.text(g, 'おだい', 0, -138, { size: 38, color: '#b85c12' });
      drawQuestionRow(g, question, 0, 32, 216, 72, 1310, 'big');
      g.restore();
      A.text(g, 'この絵の 子を 数えてね！', W / 2, H / 2 + 216, { size: 46, color: '#fff', stroke: '#b85c12', strokeWidth: 12 });
    }

    // パレード中、上に ずっと 出ている お題（絵＋文字）
    function drawQuestionSmall(g) {
      const cell = 132;
      g.save();
      g.font = A.font(46);
      let tw = g.measureText(question ? question.text : '').width;
      g.restore();
      if (tw > 1280) tw = 1280;
      const barW = Math.min(W - 60, cell + 19 + tw + 108);
      g.save();
      A.roundRect(g, W / 2 - barW / 2, 112, barW, 152, 34);
      g.fillStyle = 'rgba(255,255,255,.95)'; g.fill();
      g.strokeStyle = '#e07b2a'; g.lineWidth = 7; g.stroke();
      g.restore();
      drawQuestionRow(g, question, W / 2, 188, cell, 46, barW - cell - 110, 'small');
    }

    /* ---------- 数字の ボタン ---------- */
    // 0〜9／けす／こたえる を 6列×2段
    const PAD = [];
    (function () {
      const labels = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'けす', 'こたえる'];
      const bw = 190, bh = 120, gap = 18;
      const cols = 6;
      const totalW = cols * bw + (cols - 1) * gap;
      const x0 = (W - totalW) / 2, y0 = 680;
      labels.forEach(function (t, i) {
        const c = i % cols, r = Math.floor(i / cols);
        PAD.push({ t: t, x: x0 + c * (bw + gap), y: y0 + r * (bh + gap), w: bw, h: bh });
      });
    })();

    function drawPad(g) {
      // うすい幕
      g.fillStyle = 'rgba(255,248,235,.86)';
      g.fillRect(0, 560, W, H - 560);

      // お題（絵つき）… 何を 数えたのか 答えるときに 見える
      const cell = 168;
      g.save();
      g.font = A.font(50);
      let tw = g.measureText(question ? question.text : '').width;
      g.restore();
      if (tw > 1240) tw = 1240;
      const pw = Math.min(W - 80, cell + 24 + tw + 112);
      g.save();
      A.roundRect(g, W / 2 - pw / 2, 136, pw, 204, 38);
      g.fillStyle = 'rgba(255,255,255,.96)'; g.fill();
      g.strokeStyle = '#e07b2a'; g.lineWidth = 8; g.stroke();
      g.restore();
      A.roundRect(g, W / 2 - 104, 120, 208, 54, 20);
      g.fillStyle = '#ffeccf'; g.fill();
      g.strokeStyle = '#f0b26a'; g.lineWidth = 5; g.stroke();
      A.text(g, 'おだい', W / 2, 147, { size: 32, color: '#b85c12' });
      drawQuestionRow(g, question, W / 2, 246, cell, 50, pw - cell - 116, 'pad');

      // こたえの らん
      g.save();
      A.roundRect(g, W / 2 - 300, 390, 600, 134, 28);
      g.fillStyle = '#fff'; g.fill();
      g.strokeStyle = '#e07b2a'; g.lineWidth = 8; g.stroke();
      g.restore();
      const shown = input === '' ? '？' : input;
      A.text(g, shown, W / 2 - 40, 457, { size: 78, color: input === '' ? '#c5bfb4' : '#3a2a1c' });
      A.text(g, 'ひき', W / 2 + 112, 468, { size: 44, color: '#8a7a62' });

      if (mode === 'judge') {
        // 数だけでは 分からないので、答えは このあとの こたえあわせ（ならべ直し）で 見せる
        const col = lastOk ? '#2f9e44' : '#e8264a';
        A.text(g, lastOk ? '○ せいかい！' : '✕ ざんねん…',
          W / 2, 596, { size: 64, color: col, stroke: '#fff', strokeWidth: 14 });
        A.text(g, 'どの子だったか 見てみよう', W / 2, 672, { size: 34, color: '#8a7a62' });
        return;
      }

      PAD.forEach(function (b) {
        const wide = b.t === 'こたえる';
        const ok = wide ? input !== '' : true;
        g.save();
        A.roundRect(g, b.x, b.y, b.w, b.h, 22);
        g.fillStyle = wide ? (ok ? '#f2a33c' : '#e4ded4') : (b.t === 'けす' ? '#ffe6e6' : '#ffffff');
        g.fill();
        g.strokeStyle = wide ? (ok ? '#b85c12' : '#c5bfb4') : '#e07b2a';
        g.lineWidth = 6; g.stroke();
        g.restore();
        A.text(g, b.t, b.x + b.w / 2, b.y + b.h / 2, {
          size: b.t.length > 1 ? 40 : 60,
          color: wide ? (ok ? '#fff' : '#a9a296') : '#3a2a1c',
        });
      });
    }

    function drawCount(g) {
      const left = Math.ceil(3 - stateT);
      const txt = left <= 0 ? 'いくよ！' : String(left);
      g.save();
      g.fillStyle = 'rgba(30,16,0,.24)'; g.fillRect(0, 0, W, H);
      A.text(g, txt, W / 2, H / 2 - 40, { size: left <= 0 ? 140 : 200, color: '#fff', stroke: '#e07b2a', strokeWidth: 20 });
      g.restore();
      A.text(g, P.label + 'モード　' + L.label, W / 2, H / 2 + 140, { size: 52, color: '#b85c12', stroke: '#fff', strokeWidth: 12 });
    }

    /* ---------- 入力 ---------- */
    function hitPad(x, y) {
      for (let i = 0; i < PAD.length; i++) {
        const b = PAD[i];
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
      }
      return null;
    }
    function pushDigit(d) {
      if (mode !== 'answer') return;
      if (input.length >= 2) return;
      if (input === '' && d === '0') { input = '0'; api.sfx('select'); return; }
      input += d;
      api.sfx('select');
    }
    function backspace() {
      if (mode !== 'answer') return;
      input = input.slice(0, -1);
      api.sfx('back');
    }

    /* =========================================================
       エンジンとの やりとり
       ========================================================= */
    const inst = {
      start: function (opts) {
        reset(opts);
        mode = 'count';
        stateT = 0;
        api.setCursor('pointer');
      },
      update: update,
      draw: draw,
      onPointerDown: function (x, y) {
        if (mode === 'review') { reviewSkip(); return; }
        if (mode !== 'answer') return;
        const b = hitPad(x, y);
        if (!b) return;
        if (b.t === 'けす') backspace();
        else if (b.t === 'こたえる') submit();
        else pushDigit(b.t);
      },
      onKeyDown: function (code) {
        if (mode === 'review') { reviewSkip(); return; }
        if (mode !== 'answer') return;
        if (code.indexOf('Digit') === 0) pushDigit(code.slice(5));
        else if (code.indexOf('Numpad') === 0 && code.length === 7) pushDigit(code.slice(6));
        else if (code === 'Backspace') backspace();
        else if (code === 'Enter' || code === 'NumpadEnter') submit();
      },
      debug: {
        get mode() { return mode; },
        get question() { return question ? { text: question.text, answer: question.answer, type: question.type, crit: question.crit } : null; },
        // テスト用：出た どうぶつを そのまま 返す（答えを 外から 数え直せるように）
        get crowdData() { return crowd.map(function (a) { return { kind: a.kind, hat: a.hat, item: a.item, smile: a.smile }; }); },
        get crowd() { return crowd.length; },
        // テスト用：どうぶつの 位置と 大きさ（重なっていないかを 外から 計れるように）
        get crowdPos() { return crowd.map(function (a) { return { x: Math.round(a.x), lane: a.lane, kind: a.kind, hat: a.hat }; }); },
        get anim() {
          return {
            scale: ANIM_SCALE, box: ABOX, roadY: ROAD_Y.slice(),
            laneScale: [ANIM_SCALE, 0.84 * ANIM_SCALE],
            gap: L.gap, lanes: L.lanes,
          };
        },
        get state() { return { qIndex: qIndex, correct: correct, lives: lives, input: input, total: qTotal }; },
        get level() { return { level: L.id, players: P.n, total: Math.round(L.total * P.total), v: Math.round(L.v * P.v), lanes: L.lanes, gap: L.gap, qt: L.qt.slice(), kinds: L.kinds }; },
        get stats() { return JSON.parse(JSON.stringify(stats)); },
        // テスト用：こたえあわせで しるしを 付けた子（答えと 一致しているかを 外から 確かめる）
        get review() {
          if (mode !== 'judge' && mode !== 'review') return null;
          return {
            mode: mode,
            marked: revHit.length,            // しるしを 付けた 数
            shown: revShown,                  // いま 番号が ついている 数
            done: revDone,
            answer: question ? question.answer : null,
            crit: question ? question.crit : null,
            total: crowd.length,
            hits: revHit.slice(),
            hitData: revHit.map(function (i) {
              const a = crowd[i];
              return { kind: a.kind, hat: a.hat, item: a.item, smile: a.smile };
            }),
            grid: revGrid ? { cols: revGrid.cols, rows: revGrid.rows, s: Math.round(revGrid.s * 1000) / 1000 } : null,
          };
        },
        // テスト用：こたえあわせを 飛ばして つぎへ
        skipReview: function () {
          if (mode !== 'review') return mode;
          revShown = revHit.length; revDone = true; revT = 0;
          afterJudge();
          return 'ok';
        },
        setHold: function (v) { hold = !!v; },
        // テスト用：お題の 絵（crit の 絵）を どこに 描いたか
        get art() { return JSON.parse(JSON.stringify(ART_LOG)); },
        clearArt: function () { ART_LOG.big = null; ART_LOG.small = null; ART_LOG.pad = null; ART_LOG.review = null; },
        // テスト用：いまの お題に こたえる（right=true なら 正解を入れる）
        answerNow: function (right) {
          if (mode === 'parade') { crowd.forEach(function (a) { a.x = -300; }); return 'skip'; }
          if (mode !== 'answer') return mode;
          input = String(right ? question.answer : (question.answer + 1));
          submit();
          return 'ok';
        },
        skipParade: function () { crowd.forEach(function (a) { a.x = -300; }); },
        // 実際に出た どうぶつから 数え直して お題の答えが 合っているか 確かめる
        verify: function () {
          if (!question) return null;
          return { answer: question.answer, crowd: crowd.length };
        },
        pad: function () { return PAD.map(function (b) { return { t: b.t, x: b.x + b.w / 2, y: b.y + b.h / 2 }; }); },
      },
    };
    return inst;
  }
})();
