/* =========================================================
   おやつをパクッ！（snack） — 見極め
   - くまさんの「すきな たべもの」だけを スペースキーで 食べる
   - スペースキーを おしている あいだ ずっと 口が あく（はなすと しまる）。
     タイミング勝負では なく「すき／きらいの 見きわめ」の ゲーム。
     クールダウンは 無い。あけっぱなしに すると きらいなものまで 食べて −150点。
   - 「きらいな たべもの」は 口を とじて 見送る
   - すき／きらいの 組み合わせは 毎回かわる
   - 難易度 4つ。げきむずだけ しかけ（速さの変化・雲・鳥）が入る
   - ランキングは 難易度ごとの「パーフェクト」クリア者リスト
   操作：スペースキー（マウスの左クリックでも 同じことができる）
   ========================================================= */
(function () {
  'use strict';
  const A = window.Arcade;
  const W = A.W, H = A.H;

  /* ---------- 画面の配置 ---------- */
  // くまは (BEAR_X, BEAR_Y) に 描く。口の絵は そこから (96, 34) の ところ。
  // 食べ物の 高さと 口の 高さを ぴったり そろえる。
  const BEAR_X = 300, BEAR_Y = 614;
  const MOUTH_X = BEAR_X + 96;   // = 396
  const MOUTH_HALF = 86;         // 口のあたり判定の 半分の幅
  const ITEM_Y = BEAR_Y + 34;    // = 648
  // 食べ物の 大きさ（遠くからでも 見えるように／顔が かわいく 見えるように 大きめ）
  // となりあう 2つが いちばん 重なりやすい 組み合わせ（さかなの しっぽ＋ブロッコリー）で
  // s=1 あたり よこ 117.6px。ベルトの上の 間かくは いちばん せまい hard で 283px
  // （gap×0.88 の ばらつきと、しかけの 減速 vMul=0.76 が かさなったとき）。
  // 283 ÷ 117.6 ＝ 2.40 が 重ならない 上限。よれ(±0.04rad)の ぶんを 見て 2.0 に する。
  const FOOD_S = 2.0;
  const BELT_TOP = 716;          // ベルトの上面
  const BELT_H = 74;
  const SPAWN_X = 2010;          // 出てくる位置
  const MISS_X = MOUTH_X - 58;   // ここを 通りすぎたら 見のがし

  // 口は「おしているあいだ ずっと あく」。急に 0↔1 すると カクつくので なめらかに 補間する。
  const OPEN_TAU = 0.08;      // 口の あけしめに かかる 時間（秒）
  const OPEN_MIN = 0.06;      // ちょこんと おしただけでも これだけは あいている（秒）
  const COUNT_TIME = 3;       // はじまる前の カウントダウン

  /* ---------- 点数 ---------- */
  const PT_EAT = 100;         // すきなものを 食べた
  const PT_COMBO = 10;        // れんぞく成功の おまけ（1回ごと）
  const COMBO_CAP = 10;       // おまけの 上限（10れんぞくぶんまで）
  const PT_BAD = -150;        // きらいなものを 食べた
  const PT_MISS = -80;        // すきなものを 見のがした

  /* ---------- たべもの ---------- */
  // col＝主な色、name＝ひらがな・カタカナの 名前
  const FOODS = {
    apple:   { name: 'りんご',      col: '#e8364a' },
    banana:  { name: 'バナナ',      col: '#f7c92e' },
    berry:   { name: 'いちご',      col: '#ef3b5b' },
    orange:  { name: 'みかん',      col: '#ff9326' },
    grape:   { name: 'ぶどう',      col: '#8b4fc4' },
    carrot:  { name: 'にんじん',    col: '#f4812c' },
    pepper:  { name: 'ピーマン',    col: '#44ab3f' },
    fish:    { name: 'さかな',      col: '#45a8e0' },
    cake:    { name: 'ケーキ',      col: '#f78bb0' },
    rice:    { name: 'おにぎり',    col: '#f4f1e6' },
    cookie:  { name: 'クッキー',    col: '#d2954e' },
    brocco:  { name: 'ブロッコリー', col: '#3f9a52' },
  };
  const FOOD_IDS = Object.keys(FOODS);

  /* ---------- 難易度 ---------- */
  // like/hate＝すき・きらいの しゅるい数、v＝ながれる速さ(px/秒)、gap＝出る間かく(秒)
  // pLike＝出てくるもののうち すきなものの わりあい
  const LEVELS = {
    easy:  { id: 'easy',  label: 'やさしい',   like: 2, hate: 1, v: 300, gap: 1.16, time: 30, pLike: 0.70, gim: 0 },
    normal:{ id: 'normal',label: 'ふつう',     like: 3, hate: 2, v: 400, gap: 0.96, time: 35, pLike: 0.62, gim: 0 },
    hard:  { id: 'hard',  label: 'むずかしい', like: 4, hate: 3, v: 520, gap: 0.80, time: 40, pLike: 0.56, gim: 1 },
    chaos: { id: 'chaos', label: 'げきむず',   like: 4, hate: 4, v: 640, gap: 0.66, time: 45, pLike: 0.52, gim: 2 },
  };
  const LEVEL_IDS = ['easy', 'normal', 'hard', 'chaos'];
  function levelOf(id) { return LEVELS[id] || LEVELS.easy; }

  const OL = '#5b3a22';       // 線の色（既存ゲームと そろえる）
  const TAU = Math.PI * 2;
  const EYE = '#2b1a14';                        // 目（真っ黒は つかわない）
  const CHEEK = 'rgba(255,110,150,0.48)';       // ほっぺ

  /* ---------- 絵をかく ための 小さな どうぐ ---------- */
  function ell(g, x, y, rx, ry, rot) { g.beginPath(); g.ellipse(x, y, rx, ry, rot || 0, 0, TAU); }

  function lin(g, x0, y0, x1, y1, stops) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    for (let i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
    return gr;
  }
  function rad(g, x0, y0, r0, x1, y1, r1, stops) {
    const gr = g.createRadialGradient(x0, y0, r0, x1, y1, r1);
    for (let i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
    return gr;
  }
  // ツヤ（白い楕円。かたむけるのが コツ）
  function gloss(g, x, y, rx, ry, rot, a) {
    g.fillStyle = 'rgba(255,255,255,' + (a === undefined ? 0.55 : a) + ')';
    ell(g, x, y, rx, ry, rot); g.fill();
  }
  // 地面に おとす 影
  function shadow(g, y, rx, ry) {
    g.fillStyle = 'rgba(0,0,0,0.13)';
    ell(g, 3, y, rx, ry); g.fill();
  }
  // 葉っぱ
  function leaf(g, x, y, rx, ry, rot) {
    g.save();
    g.translate(x, y); g.rotate(rot || 0);
    g.beginPath();
    g.moveTo(-rx, 0);
    g.quadraticCurveTo(0, -ry * 1.6, rx, 0);
    g.quadraticCurveTo(0, ry * 1.6, -rx, 0);
    g.closePath();
    g.fillStyle = lin(g, -rx, -ry, rx, ry, [[0, '#a6e488'], [0.5, '#5fbf4c'], [1, '#2f8c3a']]);
    g.fill();
    g.lineWidth = 4; g.strokeStyle = OL; g.lineJoin = 'round'; g.stroke();
    g.strokeStyle = 'rgba(32,104,44,0.55)'; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(-rx * 0.72, 0); g.lineTo(rx * 0.72, 0); g.stroke();
    g.restore();
  }
  // くき
  function stem(g, x0, y0, x1, y1, w) {
    g.strokeStyle = '#7a5226'; g.lineWidth = w || 7; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2 - 3, (y0 + y1) / 2, x1, y1); g.stroke();
    g.strokeStyle = 'rgba(255,230,190,0.45)'; g.lineWidth = (w || 7) * 0.32;
    g.beginPath(); g.moveTo(x0 - 1, y0); g.quadraticCurveTo((x0 + x1) / 2 - 4, (y0 + y1) / 2, x1 - 1, y1); g.stroke();
  }
  // きらめき（4本star）
  function sparkle(g, x, y, r) {
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath();
    g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r * 0.42, y);
    g.quadraticCurveTo(x, y, x, y + r); g.quadraticCurveTo(x, y, x - r * 0.42, y);
    g.quadraticCurveTo(x, y, x, y - r);
    g.closePath(); g.fill();
  }

  /* ---------- たべものの 顔 ----------
     12種 すべてに おなじ つくりの 顔を つける。
     すき／きらいで 表情を 変えては いけない（すきは 画面うえの HUD で しめす仕様。
     顔で 答えが バレると ゲームに ならない）。 */
  function face(g, cx, cy, sc) {
    const k = sc === undefined ? 1 : sc;
    const ex = 12.5 * k;
    g.save();
    // ほっぺ
    g.fillStyle = CHEEK;
    ell(g, cx - ex - 8.6 * k, cy + 7.4 * k, 6.8 * k, 4.6 * k, -0.18); g.fill();
    ell(g, cx + ex + 8.6 * k, cy + 7.4 * k, 6.8 * k, 4.6 * k, 0.18); g.fill();
    // 目（黒丸ひとつでは なく、ハイライトを 2点 入れる）
    for (let s = -1; s <= 1; s += 2) {
      const x = cx + s * ex;
      g.fillStyle = EYE; ell(g, x, cy, 5.0 * k, 6.4 * k); g.fill();
      g.fillStyle = '#fff'; ell(g, x - 1.7 * k, cy - 2.4 * k, 2.0 * k, 2.3 * k); g.fill();
      g.beginPath(); g.arc(x + 1.9 * k, cy + 2.8 * k, 1.05 * k, 0, TAU); g.fill();
    }
    // にっこり口
    g.strokeStyle = EYE; g.lineWidth = Math.max(2, 2.8 * k); g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx - 5.4 * k, cy + 8.6 * k);
    g.quadraticCurveTo(cx, cy + 14.8 * k, cx + 5.4 * k, cy + 8.6 * k);
    g.stroke();
    g.restore();
  }

  /* =========================================================
     たべものの絵（すべてコードで描く。外の画像は つかわない）
     x,y＝中心、s＝大きさ（1 で およそ直径 96px）
     どれも 太い輪郭／グラデーション／ツヤ／ほっぺ／目のハイライト2点／影／小ディテール。
     光は ぜんぶ 左うえから。
     ========================================================= */
  function drawFood(g, kind, x, y, s, t) {
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = OL;
    g.lineWidth = 5;
    const wob = Math.sin((t || 0) * 3 + x * 0.01) * 0.04;
    g.rotate(wob);
    switch (kind) {
      /* ---------- りんご：上に 浅いくぼみ（ハート型のシルエット）・軸・葉・強いツヤ ---------- */
      case 'apple': {
        shadow(g, 50, 34, 8);
        g.beginPath();
        g.moveTo(0, -24);                                   // 中央の くぼみ
        g.bezierCurveTo(-13, -43, -42, -42, -45, -12);      // 左の 肩
        g.bezierCurveTo(-48, 20, -27, 47, 0, 47);           // 左下
        g.bezierCurveTo(27, 47, 48, 20, 45, -12);           // 右下
        g.bezierCurveTo(42, -42, 13, -43, 0, -24);          // 右の 肩
        g.closePath();
        g.fillStyle = rad(g, -18, -14, 4, 2, 8, 62, [
          [0, '#ff8d93'], [0.34, '#ef4356'], [0.76, '#d41e38'], [1, '#9e0f26'],
        ]);
        g.fill(); g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
        stem(g, 1, -26, 7, -52, 8);
        leaf(g, 24, -47, 17, 7, -0.42);
        gloss(g, -21, -6, 9.5, 17, -0.32, 0.5);
        gloss(g, -12, 20, 5, 8, -0.3, 0.26);
        sparkle(g, 22, 10, 9);
        face(g, 2, 10, 1);
        break;
      }
      /* ---------- バナナ：房ではなく 1本。太い三日月・両はしの 茶色・稜線2本 ---------- */
      case 'banana': {
        shadow(g, 52, 36, 8);
        // 房では なく 1本。太い三日月。
        g.beginPath();
        g.moveTo(-44, -14);                                 // 左の 先端
        g.bezierCurveTo(-53, 22, -28, 50, 0, 49);           // 外がわ（下）左
        g.bezierCurveTo(28, 48, 50, 20, 45, -17);           // 外がわ（下）右 → 右の先端
        g.bezierCurveTo(40, -6, 36, 16, 11, 20);            // 内がわ（上）右
        g.bezierCurveTo(-15, 24, -31, 6, -33, -12);         // 内がわ（上）左
        g.bezierCurveTo(-35, -21, -42, -21, -44, -14);      // 先端で とじる
        g.closePath();
        g.fillStyle = lin(g, -32, -18, 22, 48, [
          [0, '#fffbd8'], [0.24, '#ffe978'], [0.58, '#fbcf2a'], [1, '#dda40f'],
        ]);
        g.fill(); g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
        // 皮の 稜線（たてに 2本）
        g.strokeStyle = 'rgba(199,141,12,0.5)'; g.lineWidth = 4;
        g.beginPath();
        g.moveTo(-34, -6); g.bezierCurveTo(-40, 22, -22, 40, 0, 39);
        g.bezierCurveTo(23, 38, 40, 16, 37, -10); g.stroke();
        g.beginPath();
        g.moveTo(-28, -9); g.bezierCurveTo(-33, 16, -19, 31, 0, 30);
        g.bezierCurveTo(20, 29, 32, 12, 30, -12); g.stroke();
        // 根元（左）の 茶色いところ
        g.strokeStyle = '#7a5a1a'; g.lineWidth = 12; g.lineCap = 'round';
        g.beginPath(); g.moveTo(-41, -17); g.lineTo(-46, -31); g.stroke();
        g.lineWidth = 4; g.strokeStyle = OL;
        g.beginPath(); g.moveTo(-41, -17); g.lineTo(-46, -31); g.stroke();
        // 先っぽ（右）の 茶色いところ（左の 根元と おなじくらいの 小ささに する）
        g.fillStyle = '#6b4a14'; ell(g, 43, -16, 5, 4, -0.5); g.fill();
        g.lineWidth = 3.5; g.strokeStyle = OL; g.stroke();
        // 皮の ツヤ
        gloss(g, -21, 20, 13, 4.5, 0.62, 0.6);
        gloss(g, 27, 10, 9, 4, -0.75, 0.4);
        sparkle(g, 36, 28, 8);
        face(g, 0, 30, 0.84);
        break;
      }
      /* ---------- いちご ---------- */
      case 'berry': {
        shadow(g, 50, 30, 8);
        g.beginPath();
        g.moveTo(0, 49);
        g.bezierCurveTo(-30, 35, -46, 11, -44, -10);
        g.bezierCurveTo(-42, -31, -19, -35, 0, -24);
        g.bezierCurveTo(19, -35, 42, -31, 44, -10);
        g.bezierCurveTo(46, 11, 30, 35, 0, 49);
        g.closePath();
        g.fillStyle = rad(g, -17, -10, 4, 0, 6, 58, [
          [0, '#ff8c9c'], [0.32, '#f5485f'], [0.74, '#da2047'], [1, '#9e0e33'],
        ]);
        g.fill(); g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
        // つぶつぶ（顔の ところは あける）
        g.fillStyle = '#ffe9a0';
        [[-33, -4, -0.5], [-27, 16, -0.3], [-13, 33, -0.1], [11, 33, 0.1], [26, 16, 0.3],
          [33, -4, 0.5], [-24, -20, -0.7], [24, -20, 0.7]].forEach(function (p) {
          g.save(); g.translate(p[0], p[1]); g.rotate(p[2]);
          ell(g, 0, 0, 3.2, 5); g.fill();
          g.restore();
        });
        // へた（5まいの 葉）
        [[-30, -24, -1.05], [-15, -33, -0.5], [0, -36, 0], [15, -33, 0.5], [30, -24, 1.05]].forEach(function (p) {
          leaf(g, p[0], p[1], 13, 5.5, p[2]);
        });
        stem(g, 0, -34, 3, -52, 7);
        gloss(g, -20, -2, 8, 14, -0.35, 0.5);
        sparkle(g, 24, 6, 8);
        face(g, 0, 6, 1);
        break;
      }
      /* ---------- みかん ---------- */
      case 'orange': {
        shadow(g, 48, 32, 8);
        ell(g, 0, 6, 43, 39);
        g.fillStyle = rad(g, -17, -11, 5, 0, 6, 56, [
          [0, '#ffd08a'], [0.3, '#ffa63c'], [0.72, '#f3801a'], [1, '#bd5306'],
        ]);
        g.fill(); g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
        // 皮の つぶつぶ（顔の ところは あける）
        g.fillStyle = 'rgba(176,78,6,0.3)';
        [[-30, -14], [-34, 6], [-28, 24], [-12, 34], [10, 34], [27, 24], [34, 6], [30, -14],
          [-20, -27], [20, -27]].forEach(function (p) {
          g.beginPath(); g.arc(p[0], p[1], 2.4, 0, TAU); g.fill();
        });
        // おしり（へこみ）
        g.fillStyle = 'rgba(150,62,4,0.35)'; ell(g, 0, -31, 9, 5); g.fill();
        g.strokeStyle = '#4e7a2a'; g.lineWidth = 7; g.lineCap = 'round';
        g.beginPath(); g.moveTo(0, -33); g.lineTo(1, -42); g.stroke();
        leaf(g, 22, -43, 17, 7, -0.4);
        gloss(g, -21, -13, 13, 7, -0.6, 0.55);
        sparkle(g, 23, 14, 8);
        face(g, 0, 8, 1);
        break;
      }
      /* ---------- ぶどう：つぶを かさねた ふさ。手前の 大きいつぶに 顔 ---------- */
      case 'grape': {
        shadow(g, 52, 30, 8);
        stem(g, 0, -30, 3, -52, 8);
        leaf(g, 23, -48, 17, 7, -0.42);
        function berryBall(bx, by, r) {
          ell(g, bx, by, r, r * 0.97);
          g.fillStyle = rad(g, bx - r * 0.38, by - r * 0.4, r * 0.1, bx, by, r * 1.35, [
            [0, '#c99bec'], [0.32, '#9a5fd0'], [0.74, '#7a3bb5'], [1, '#4d1f7d'],
          ]);
          g.fill(); g.lineWidth = 4.5; g.strokeStyle = OL; g.stroke();
          gloss(g, bx - r * 0.34, by - r * 0.38, r * 0.3, r * 0.17, -0.6, 0.6);
        }
        // おくの つぶ
        [[-26, -16, 16], [0, -26, 16], [26, -16, 16], [-29, 9, 16], [29, 9, 16],
          [-15, 34, 15], [15, 34, 15]].forEach(function (p) { berryBall(p[0], p[1], p[2]); });
        // 手前の 大きい つぶ
        berryBall(0, 8, 25);
        sparkle(g, 20, 28, 7);
        face(g, 0, 8, 0.92);
        break;
      }
      /* ---------- にんじん ---------- */
      case 'carrot': {
        shadow(g, 52, 26, 7);
        g.beginPath();
        g.moveTo(-23, -14);
        g.quadraticCurveTo(-26, -24, -15, -25);
        g.lineTo(15, -25);
        g.quadraticCurveTo(26, -24, 23, -14);
        g.bezierCurveTo(18, 12, 10, 34, 3, 50);
        g.quadraticCurveTo(0, 55, -3, 50);
        g.bezierCurveTo(-10, 34, -18, 12, -23, -14);
        g.closePath();
        g.fillStyle = lin(g, -22, -25, 20, 42, [
          [0, '#ffc182'], [0.28, '#fa943c'], [0.68, '#e86d16'], [1, '#aa4807'],
        ]);
        g.fill(); g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
        // 横の すじ
        g.strokeStyle = 'rgba(150,64,4,0.4)'; g.lineWidth = 3.6;
        [[-15, 22, 13], [-11, 32, 10], [-7, 42, 7]].forEach(function (p) {
          g.beginPath(); g.moveTo(p[0], p[1]); g.quadraticCurveTo(p[0] + p[2] / 2, p[1] - 4, p[0] + p[2], p[1]); g.stroke();
        });
        // 葉（にんじんの 肩から はえているように 下げて かさねる）
        [[-13, -0.72], [0, -0.06], [13, 0.62]].forEach(function (p) {
          g.save(); g.translate(p[0], -17); g.rotate(p[1]);
          g.beginPath();
          g.moveTo(0, 6);
          g.bezierCurveTo(-10, -4, -8, -20, 0, -30);
          g.bezierCurveTo(8, -20, 10, -4, 0, 6);
          g.closePath();
          g.fillStyle = lin(g, -8, -26, 8, 6, [[0, '#a6e488'], [0.5, '#4faf4c'], [1, '#27742f']]);
          g.fill(); g.lineWidth = 4; g.strokeStyle = OL; g.stroke();
          g.strokeStyle = 'rgba(28,96,40,0.5)'; g.lineWidth = 2.4;
          g.beginPath(); g.moveTo(0, 4); g.lineTo(0, -24); g.stroke();
          g.restore();
        });
        // 葉の つけね（みどりの えり）
        ell(g, 0, -21, 18, 8);
        g.fillStyle = lin(g, -18, -27, 18, -14, [[0, '#8fd36f'], [1, '#2f7a2c']]);
        g.fill(); g.lineWidth = 4.5; g.strokeStyle = OL; g.stroke();
        gloss(g, -11, -2, 5.5, 15, 0.1, 0.5);
        sparkle(g, 13, 8, 7);
        face(g, 0, -1, 0.78);
        break;
      }
      /* ---------- ピーマン ---------- */
      case 'pepper': {
        shadow(g, 50, 30, 8);
        g.beginPath();
        g.moveTo(-36, -8);
        g.bezierCurveTo(-43, 26, -24, 48, 0, 48);
        g.bezierCurveTo(24, 48, 43, 26, 36, -8);
        g.bezierCurveTo(28, -29, -28, -29, -36, -8);
        g.closePath();
        g.fillStyle = lin(g, -27, -27, 24, 44, [
          [0, '#b6ea90'], [0.26, '#6cc74e'], [0.66, '#3f9d38'], [1, '#1d6b26'],
        ]);
        g.fill(); g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
        // ふくらみの すじ
        g.strokeStyle = 'rgba(18,86,30,0.3)'; g.lineWidth = 4.5;
        g.beginPath(); g.moveTo(-19, -18); g.quadraticCurveTo(-26, 16, -16, 44); g.stroke();
        g.beginPath(); g.moveTo(19, -18); g.quadraticCurveTo(26, 16, 16, 44); g.stroke();
        // へたと くき
        g.beginPath();
        g.moveTo(-17, -22); g.quadraticCurveTo(-9, -31, 0, -28);
        g.quadraticCurveTo(9, -31, 17, -22);
        g.quadraticCurveTo(0, -16, -17, -22);
        g.closePath();
        g.fillStyle = lin(g, -17, -31, 17, -16, [[0, '#9ad96f'], [1, '#2f7a2c']]);
        g.fill(); g.lineWidth = 4; g.strokeStyle = OL; g.stroke();
        g.strokeStyle = '#2f7a2c'; g.lineWidth = 9; g.lineCap = 'round';
        g.beginPath(); g.moveTo(0, -24); g.lineTo(1, -46); g.stroke();
        g.strokeStyle = 'rgba(190,240,170,0.5)'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(-2, -26); g.lineTo(-1, -44); g.stroke();
        gloss(g, -21, 4, 7, 17, 0.16, 0.5);
        gloss(g, 18, 26, 6, 10, -0.4, 0.26);
        sparkle(g, 22, -2, 8);
        face(g, 0, 12, 1);
        break;
      }
      /* ---------- さかな ---------- */
      case 'fish': {
        shadow(g, 46, 34, 8);
        // ひれは からだより こい 一色よりの ぬり（うすいと ガラスみたいに 浮いて見える）
        const finFill = lin(g, -56, -34, 10, 36, [
          [0, '#5aa8d6'], [0.45, '#3685bb'], [1, '#15567f'],
        ]);
        const finRay = 'rgba(10,52,84,0.5)';
        // しっぽ（ぬりつぶした おうぎ形＋すじ）
        g.beginPath();
        g.moveTo(-14, 1);
        g.lineTo(-60, -34);
        g.quadraticCurveTo(-45, 1, -60, 36);
        g.closePath();
        g.fillStyle = finFill; g.fill();
        g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
        g.strokeStyle = finRay; g.lineWidth = 3.4;
        [[-55, -25], [-53, 1], [-55, 27]].forEach(function (p) {
          g.beginPath(); g.moveTo(-18, 1); g.lineTo(p[0], p[1]); g.stroke();
        });
        // せびれ（せなかの まんなかから 立ちあがる。顔の うえには のせない）
        g.beginPath();
        g.moveTo(-16, -22);
        g.quadraticCurveTo(-12, -54, 4, -56);
        g.quadraticCurveTo(10, -46, 18, -32);
        g.quadraticCurveTo(0, -28, -16, -22);
        g.closePath();
        g.fillStyle = finFill; g.fill();
        g.lineWidth = 4.5; g.strokeStyle = OL; g.stroke();
        g.strokeStyle = finRay; g.lineWidth = 3;
        [[-6, -26, -8, -48], [4, -29, 8, -45]].forEach(function (p) {
          g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[2], p[3]); g.stroke();
        });
        // はらびれ（おなかの したに 小さく）
        g.beginPath();
        g.moveTo(-12, 25);
        g.quadraticCurveTo(-10, 47, 8, 40);
        g.quadraticCurveTo(0, 33, -12, 25);
        g.closePath();
        g.fillStyle = finFill; g.fill();
        g.lineWidth = 4.5; g.strokeStyle = OL; g.stroke();
        g.strokeStyle = finRay; g.lineWidth = 3;
        g.beginPath(); g.moveTo(-8, 29); g.lineTo(-4, 41); g.stroke();
        // からだ（ひれより あとに かいて、ひれの つけねを かくす）
        g.beginPath();
        g.moveTo(-24, 1);
        g.bezierCurveTo(-20, -32, 16, -37, 40, -13);
        g.quadraticCurveTo(49, -4, 49, 1);
        g.quadraticCurveTo(49, 7, 40, 15);
        g.bezierCurveTo(16, 39, -20, 34, -24, 1);
        g.closePath();
        g.fillStyle = lin(g, -16, -32, 34, 30, [
          [0, '#c2eaff'], [0.24, '#79c6ee'], [0.62, '#3f9ed6'], [1, '#17628f'],
        ]);
        g.fill(); g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
        // えら
        g.strokeStyle = 'rgba(16,80,124,0.45)'; g.lineWidth = 4;
        g.beginPath(); g.moveTo(-10, -26); g.quadraticCurveTo(-20, 1, -10, 29); g.stroke();
        // うろこ
        g.strokeStyle = 'rgba(16,80,124,0.3)'; g.lineWidth = 3;
        [[-13, 14], [-13, -12], [-19, 1]].forEach(function (p) {
          g.beginPath(); g.arc(p[0], p[1], 8, -1.1, 1.1); g.stroke();
        });
        gloss(g, 6, -21, 13, 5, -0.3, 0.6);
        sparkle(g, 38, -12, 8);
        face(g, 17, 2, 0.92);
        break;
      }
      /* ---------- ケーキ（ショートケーキ） ---------- */
      case 'cake': {
        shadow(g, 48, 34, 8);
        // スポンジ
        g.beginPath();
        g.moveTo(-40, -2); g.lineTo(40, -2);
        g.lineTo(37, 36); g.quadraticCurveTo(0, 48, -37, 36);
        g.closePath();
        g.fillStyle = lin(g, -34, -2, 30, 44, [
          [0, '#fff0d2'], [0.3, '#ffd9a4'], [0.72, '#f2bb7c'], [1, '#c98a4c'],
        ]);
        g.fill(); g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
        // あいだの クリーム
        g.save();
        g.beginPath();
        g.moveTo(-40, -2); g.lineTo(40, -2); g.lineTo(37, 36);
        g.quadraticCurveTo(0, 48, -37, 36); g.closePath(); g.clip();
        g.beginPath();
        g.moveTo(-40, 24); g.quadraticCurveTo(0, 31, 40, 24);
        g.lineTo(40, 34); g.quadraticCurveTo(0, 41, -40, 34); g.closePath();
        g.fillStyle = lin(g, 0, 24, 0, 34, [[0, '#fffaf0'], [1, '#f2dfc2']]); g.fill();
        g.restore();
        // うえの クリーム
        g.beginPath();
        g.moveTo(-40, -2);
        g.bezierCurveTo(-44, -22, -24, -30, -11, -18);
        g.bezierCurveTo(-2, -34, 20, -33, 27, -16);
        g.bezierCurveTo(38, -22, 45, -10, 40, -2);
        g.closePath();
        g.fillStyle = lin(g, -32, -30, 30, -2, [
          [0, '#ffe3ee'], [0.3, '#ffb0cd'], [0.72, '#f2779f'], [1, '#d14f7c'],
        ]);
        g.fill(); g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
        // うえの いちご
        g.beginPath();
        g.moveTo(5, -21);
        g.bezierCurveTo(-12, -26, -16, -44, -2, -49);
        g.bezierCurveTo(12, -54, 21, -36, 5, -21);
        g.closePath();
        g.fillStyle = rad(g, -5, -43, 2, 2, -37, 23, [[0, '#ff8c9c'], [0.5, '#ec3550'], [1, '#aa1030']]);
        g.fill(); g.lineWidth = 4.5; g.strokeStyle = OL; g.stroke();
        leaf(g, 1, -50, 12, 5, -0.28);
        gloss(g, -3, -42, 4.4, 2.8, -0.5, 0.75);
        gloss(g, -26, -14, 8, 4, -0.4, 0.55);
        sparkle(g, 26, -28, 7);
        face(g, 0, 12, 0.95);
        break;
      }
      /* ---------- おにぎり ---------- */
      case 'rice': {
        shadow(g, 46, 34, 8);
        g.beginPath();
        g.moveTo(0, -43);
        g.quadraticCurveTo(11, -43, 17, -31);
        g.lineTo(39, 21);
        g.quadraticCurveTo(45, 37, 29, 39);
        g.lineTo(-29, 39);
        g.quadraticCurveTo(-45, 37, -39, 21);
        g.lineTo(-17, -31);
        g.quadraticCurveTo(-11, -43, 0, -43);
        g.closePath();
        g.fillStyle = rad(g, -14, -22, 4, 0, 2, 62, [
          [0, '#ffffff'], [0.4, '#f7f4e9'], [0.8, '#e6dfcb'], [1, '#c8bfa3'],
        ]);
        g.fill(); g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
        // お米の つぶ
        g.fillStyle = 'rgba(255,255,255,0.75)';
        [[-20, 4, -0.5], [20, 4, 0.5], [-10, -22, -0.2], [11, -20, 0.3], [-26, 22, -0.6], [26, 22, 0.6]].forEach(function (p) {
          g.save(); g.translate(p[0], p[1]); g.rotate(p[2]);
          ell(g, 0, 0, 5, 2.6); g.fill();
          g.restore();
        });
        // のり（下の 帯）
        g.save();
        g.beginPath();
        g.moveTo(0, -43);
        g.quadraticCurveTo(11, -43, 17, -31);
        g.lineTo(39, 21); g.quadraticCurveTo(45, 37, 29, 39);
        g.lineTo(-29, 39); g.quadraticCurveTo(-45, 37, -39, 21);
        g.lineTo(-17, -31); g.quadraticCurveTo(-11, -43, 0, -43);
        g.closePath(); g.clip();
        g.beginPath();
        g.moveTo(-21, 13); g.quadraticCurveTo(0, 17, 21, 13);
        g.lineTo(23, 44); g.lineTo(-23, 44); g.closePath();
        g.fillStyle = lin(g, -21, 13, 21, 44, [[0, '#4a535f'], [0.45, '#2d343d'], [1, '#161a20']]);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.14)';
        g.beginPath(); g.moveTo(-15, 16); g.quadraticCurveTo(-8, 18, -8, 44); g.lineTo(-15, 44); g.closePath(); g.fill();
        g.restore();
        g.lineWidth = 4.5; g.strokeStyle = OL;
        g.beginPath();
        g.moveTo(-21, 13); g.quadraticCurveTo(0, 17, 21, 13); g.lineTo(23, 42);
        g.stroke();
        g.beginPath(); g.moveTo(-21, 13); g.lineTo(-23, 42); g.stroke();
        // ごま
        g.fillStyle = '#4a4034';
        [[-28, -8, -0.4], [27, -10, 0.4]].forEach(function (p) {
          g.save(); g.translate(p[0], p[1]); g.rotate(p[2]);
          ell(g, 0, 0, 3.4, 2); g.fill();
          g.restore();
        });
        gloss(g, -17, -20, 11, 5, -0.62, 0.7);
        sparkle(g, 22, -16, 7);
        face(g, 0, -8, 0.95);
        break;
      }
      /* ---------- クッキー ---------- */
      case 'cookie': {
        shadow(g, 48, 32, 8);
        // ふちを すこし ぼこぼこに
        g.beginPath();
        for (let i = 0; i <= 44; i++) {
          const a = i / 44 * TAU;
          const r = 40 + Math.sin(a * 7) * 2.6 + Math.cos(a * 4) * 1.4;
          const px = Math.cos(a) * r, py = 4 + Math.sin(a) * r * 0.96;
          if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.closePath();
        g.fillStyle = rad(g, -16, -12, 5, 0, 4, 56, [
          [0, '#f7d7a4'], [0.34, '#dfa864'], [0.74, '#c4873f'], [1, '#90591f'],
        ]);
        g.fill(); g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
        // 生地の つぶ
        g.fillStyle = 'rgba(255,230,190,0.4)';
        [[-24, -16], [22, -18], [-28, 16], [26, 18], [0, 34]].forEach(function (p) {
          g.beginPath(); g.arc(p[0], p[1], 3.4, 0, TAU); g.fill();
        });
        // チョコチップ（目に 見えないよう 顔の ところは しっかり あける）
        [[-30, -6, 7], [29, -3, 7.5], [-18, 30, 6.5], [17, 29, 6], [0, -31, 6.5]].forEach(function (p) {
          ell(g, p[0], p[1], p[2], p[2] * 0.92, 0.2);
          g.fillStyle = rad(g, p[0] - p[2] * 0.3, p[1] - p[2] * 0.4, 1, p[0], p[1], p[2] * 1.3,
            [[0, '#8a5a30'], [0.5, '#5a3417'], [1, '#331c0a']]);
          g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(60,32,12,0.8)'; g.stroke();
          gloss(g, p[0] - p[2] * 0.3, p[1] - p[2] * 0.36, p[2] * 0.3, p[2] * 0.17, -0.6, 0.55);
        });
        gloss(g, -20, -16, 11, 5.5, -0.6, 0.4);
        sparkle(g, 24, -30, 7);
        face(g, 0, 5, 0.95);
        break;
      }
      /* ---------- ブロッコリー ---------- */
      default: {
        shadow(g, 50, 26, 7);
        // くき
        g.beginPath();
        g.moveTo(-15, 2); g.lineTo(15, 2);
        g.quadraticCurveTo(16, 30, 12, 48);
        g.quadraticCurveTo(0, 52, -12, 48);
        g.quadraticCurveTo(-16, 30, -15, 2);
        g.closePath();
        g.fillStyle = lin(g, -15, 2, 14, 48, [
          [0, '#eef7d2'], [0.35, '#d2e8a6'], [1, '#95bf6a'],
        ]);
        g.fill(); g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
        g.strokeStyle = 'rgba(100,140,70,0.5)'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(-4, 12); g.lineTo(-3, 42); g.stroke();
        g.beginPath(); g.moveTo(6, 14); g.lineTo(7, 40); g.stroke();
        // つぼみの かたまり（外がわ）
        [[-34, -2, 18], [34, -2, 18], [-24, -26, 18], [24, -26, 18], [0, -36, 19],
          [-12, -10, 17], [12, -10, 17]].forEach(function (p) {
          ell(g, p[0], p[1], p[2], p[2] * 0.95);
          g.fillStyle = rad(g, p[0] - p[2] * 0.35, p[1] - p[2] * 0.4, p[2] * 0.1, p[0], p[1], p[2] * 1.4,
            [[0, '#8ed172'], [0.4, '#4ca84f'], [1, '#1f6b2c']]);
          g.fill(); g.lineWidth = 4.5; g.strokeStyle = OL; g.stroke();
        });
        // まんなかの ドーム（ここに 顔。顔が 見えるよう 中を 明るく する）
        ell(g, 0, -12, 35, 27);
        g.fillStyle = rad(g, -8, -16, 4, 0, -10, 46, [
          [0, '#d7f0b4'], [0.3, '#a9df84'], [0.62, '#64b852'], [1, '#2f8537'],
        ]);
        g.fill(); g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
        // つぼみの つぶつぶ（顔の まわりだけ）
        g.fillStyle = 'rgba(48,120,56,0.3)';
        [[-26, -28], [-13, -34], [0, -36], [13, -34], [26, -28], [-31, -8], [31, -8]].forEach(function (p) {
          g.beginPath(); g.arc(p[0], p[1], 4.2, 0, TAU); g.fill();
        });
        gloss(g, -19, -26, 10, 5, -0.5, 0.5);
        sparkle(g, 27, -36, 7);
        face(g, 0, -11, 0.92);
        break;
      }
    }
    g.restore();
  }

  /* =========================================================
     くまさん
     open＝口のあき具合（0〜1）、mood: 'ok' | 'yum' | 'yuck'
     ========================================================= */
  /* くまさん
     ・飛び出した 口元（マズル）は つくらない。目・はな・口は まるい 顔に 直接 のせる。
     ・口は ずっと おなじ ところ（MX, MY）。あき具合で「形」が 変わる。
         とじている＝小さな ω ／ 半分＝まるい「の」の字 ／ 全開＝まんまるの「あーん」
       角は まるく、あくとき よこに すこし はずむ。歯は かかない。
     ・判定の 定数（MOUTH_X=396 / ITEM_Y=648 など）は 変えられないので、
       口を 動かすかわりに「あたまを 右に 寄せて」口が 顔の まんなかより すこし右、
       つまり 右を むいている 顔として しぜんな ところに くるように している。
       あたまだけ ベルトの ほうへ 寄るので「食べ物を 見ている」姿勢になる。 */
  /* あたまの 大きさ。口を 大きく あけられるように すこし 大きくした
     （136x118 → 150x126、中心も 12px 上へ）。
     ・下の ふち（HY+HRY＝114）は まえと おなじ。ベルトの「ここ！」の しるしを
       かくさない ために、ここだけは 動かさない。
     ・右の ふちが ひろがったぶん、全開の 口（よこ144）が 顔から はみ出さない。
     目・はな・ほっぺ・耳も、大きい口の ぶん 上へ ずらしてある。 */
  const HX = 44, HY = -12, HR = 150, HRY = 126;  // あたまの 中心と 大きさ
  const MX = 96, MY = 34;                        // 口（BEAR_X+96=MOUTH_X, BEAR_Y+34=ITEM_Y）
  const EL = [46, -70], ER = [122, -74];         // 目（右むき 3/4 なので 左右で すこし ちがう）

  // 口の ふち。うえのふちを dip だけ 下げると ω／の の字に 見える
  function mouthPath(g, cx, cy, hw, hh, dip) {
    g.beginPath();
    g.moveTo(cx - hw, cy);
    g.quadraticCurveTo(cx - hw * 0.72, cy - hh * 0.96 + dip, cx, cy - hh + dip);
    g.quadraticCurveTo(cx + hw * 0.72, cy - hh * 0.96 + dip, cx + hw, cy);
    g.quadraticCurveTo(cx + hw * 0.80, cy + hh * 0.96, cx, cy + hh);
    g.quadraticCurveTo(cx - hw * 0.80, cy + hh * 0.96, cx - hw, cy);
    g.closePath();
  }

  function drawBear(g, x, y, open, t, mood) {
    g.save();
    g.translate(x, y);
    // 足もとの 影（からだの ゆれでは 動かさない）
    g.fillStyle = 'rgba(0,0,0,0.13)';
    ell(g, -16, 240, 118, 24); g.fill();
    const bob = Math.sin(t * 2.2) * 5;
    g.translate(0, bob);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = OL;
    g.lineWidth = 7;

    // からだ
    ell(g, -26, 150, 104, 92);
    g.fillStyle = lin(g, -110, 70, 60, 240, [
      [0, '#dcae7f'], [0.34, '#b1764a'], [1, '#79492a'],
    ]);
    g.fill(); g.stroke();
    gloss(g, -80, 100, 26, 13, -0.62, 0.22);
    // おなか（明るい面）
    ell(g, -14, 170, 66, 62);
    g.fillStyle = rad(g, -36, 138, 4, -14, 170, 74, [
      [0, '#fdeed8'], [0.5, '#f1dabd'], [1, '#d8b188'],
    ]);
    g.fill();
    g.strokeStyle = 'rgba(132,88,52,0.3)'; g.lineWidth = 4; g.stroke();
    gloss(g, -46, 134, 22, 10, -0.6, 0.35);
    g.strokeStyle = OL; g.lineWidth = 7;
    // あたまが からだに おとす 影（厚みを 出す）
    g.save();
    ell(g, -26, 150, 102, 90); g.clip();
    g.fillStyle = 'rgba(92,56,30,0.17)';
    ell(g, HX - 14, HY + 104, HR * 0.78, 34); g.fill();
    g.restore();

    // まえ足（肉球つき）
    [[-104, 136, -0.3], [52, 166, 0.3]].forEach(function (p) {
      ell(g, p[0], p[1], 31, 25, p[2]);
      g.fillStyle = rad(g, p[0] - 13, p[1] - 11, 2, p[0], p[1], 40, [
        [0, '#e8bc8e'], [0.45, '#c08a58'], [1, '#89582f'],
      ]);
      g.fill(); g.lineWidth = 6; g.strokeStyle = OL; g.stroke();
      // 肉球
      g.fillStyle = 'rgba(255,152,174,0.78)';
      ell(g, p[0] + 1, p[1] + 6, 11, 8); g.fill();
      [[-10, -5], [0, -8], [10, -5]].forEach(function (q) {
        g.beginPath(); g.arc(p[0] + q[0], p[1] + q[1], 4.1, 0, TAU); g.fill();
      });
      gloss(g, p[0] - 13, p[1] - 11, 10, 5, -0.6, 0.4);
      g.lineWidth = 7; g.strokeStyle = OL;
    });

    // 耳（あたまが 大きくなった ぶん 上へ。出っぱる 量は まえと おなじ）
    [[-32, -115], [116, -120]].forEach(function (p) {
      g.beginPath(); g.arc(p[0], p[1], 42, 0, TAU);
      g.fillStyle = rad(g, p[0] - 16, p[1] - 18, 4, p[0], p[1], 48, [
        [0, '#e2b68a'], [0.45, '#b1764a'], [1, '#75452a'],
      ]);
      g.fill(); g.stroke();
      ell(g, p[0] + 2, p[1] + 2, 23, 21);
      g.fillStyle = rad(g, p[0] - 6, p[1] - 6, 2, p[0] + 2, p[1] + 2, 25, [
        [0, '#ffd9c4'], [0.55, '#f6b495'], [1, '#d98f6e'],
      ]);
      g.fill();
      g.lineWidth = 3.5; g.strokeStyle = 'rgba(140,86,56,0.45)'; g.stroke();
      gloss(g, p[0] - 14, p[1] - 16, 11, 6, -0.6, 0.45);
      g.lineWidth = 7; g.strokeStyle = OL;
    });

    // あたま（まるいまま。口元は 飛び出させない）
    ell(g, HX, HY, HR, HRY);
    g.fillStyle = rad(g, HX - 70, HY - 68, 10, HX, HY, HR * 1.32, [
      [0, '#f2d3ab'], [0.28, '#cd9668'], [0.7, '#b67f52'], [1, '#875530'],
    ]);
    g.fill(); g.stroke();
    // あたまの ツヤ（大きいのと 小さいの）
    gloss(g, -16, -78, 33, 15, -0.62, 0.34);
    gloss(g, 26, -108, 13, 5.5, -0.5, 0.26);
    // あたまの 毛束
    g.strokeStyle = OL; g.lineWidth = 6;
    g.beginPath();
    g.moveTo(20, -130); g.quadraticCurveTo(12, -150, -2, -154);
    g.moveTo(34, -134); g.quadraticCurveTo(36, -156, 28, -166);
    g.moveTo(48, -132); g.quadraticCurveTo(60, -150, 72, -152);
    g.stroke();

    // ほっぺ（口の よこ）
    // 全開の 口（よこ144・たて100）と かさならない ように、左は 口の 左はしより 外、
    // 右は 口の 上がわの ふちより 上に おく。
    g.fillStyle = 'rgba(255,110,150,0.48)';
    ell(g, -10, -6, 23, 15, -0.12); g.fill();
    ell(g, 174, -18, 16, 12, 0.12); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.32)';
    ell(g, -17, -12, 8, 4, -0.5); g.fill();
    ell(g, 170, -22, 5.6, 2.9, -0.5); g.fill();

    // 目（黒丸ひとつでは なく ハイライト2点）
    const blink = (Math.sin(t * 0.9) > 0.985);
    const shut = (mood === 'yum') || blink;
    const eyes = [[EL[0], EL[1], 10.5, 13.5], [ER[0], ER[1], 12, 15]];
    if (shut) {
      g.strokeStyle = EYE; g.lineWidth = 7;
      eyes.forEach(function (p) {
        g.beginPath();
        g.moveTo(p[0] - p[2] - 3, p[1] + 3);
        g.quadraticCurveTo(p[0], p[1] - (mood === 'yum' ? 16 : 10), p[0] + p[2] + 3, p[1] + 3);
        g.stroke();
      });
    } else {
      eyes.forEach(function (p) {
        g.fillStyle = EYE; ell(g, p[0], p[1], p[2], p[3]); g.fill();
        g.fillStyle = '#fff'; ell(g, p[0] - p[2] * 0.3, p[1] - p[3] * 0.38, p[2] * 0.4, p[3] * 0.36); g.fill();
        g.beginPath(); g.arc(p[0] + p[2] * 0.34, p[1] + p[3] * 0.38, p[2] * 0.2, 0, TAU); g.fill();
      });
    }
    // まゆ（ふだんは おだやか）
    if (mood === 'ok') {
      g.strokeStyle = 'rgba(122,78,44,0.55)'; g.lineWidth = 5;
      eyes.forEach(function (p) {
        g.beginPath();
        g.moveTo(p[0] - 13, p[1] - 22); g.quadraticCurveTo(p[0], p[1] - 29, p[0] + 13, p[1] - 22);
        g.stroke();
      });
    }

    // はな（目と 口の あいだ。顔に 直接）
    // 口を 大きく あけるので、はなも 上へ ずらして 場所を あける。
    ell(g, 90, -40, 17, 11.5, -0.06);
    g.fillStyle = rad(g, 84, -45, 2, 90, -40, 21, [[0, '#7a5546'], [0.5, '#3f2d1f'], [1, '#241812']]);
    g.fill();
    g.lineWidth = 3.5; g.strokeStyle = 'rgba(70,46,28,0.8)'; g.stroke();
    gloss(g, 84, -44, 6, 3.2, -0.3, 0.85);
    // はなから 口への すじ
    g.strokeStyle = 'rgba(122,78,44,0.45)'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(91, -29); g.lineTo(93, -22); g.stroke();
    g.lineWidth = 7; g.strokeStyle = OL;

    /* 口。ところは ずっと (MX, MY)。あき具合で 形が 変わる */
    const o = Math.max(0, Math.min(1, open));
    if (o > 0.03) {
      /* 全開で よこ 144 ／ たて 100（まえは 84x68）。
         あたり判定の はばは MOUTH_HALF×2 ＝ 172 なので、見た目を そこに 近づけ、
         「口に 入っているのに 食べない」ように 見えない ように した。
         判定より すこし 内がわ（144 < 172）に おさめて あるのは、
         はしギリギリで 食べられた ときに 口から はみ出して 見えない ため。 */
      // よこに すこし はずむ（半分あきの ときが いちばん ふくらむ）
      const hw = (24 + 48 * o) * (1 + 0.09 * Math.sin(o * Math.PI));
      const hh = 4 + 46 * o;
      const dip = Math.min(hh * 0.72, 18 * (1 - o));   // あくほど うえのふちが 平らに
      mouthPath(g, MX, MY, hw, hh, dip);
      g.fillStyle = rad(g, MX, MY - hh * 0.45, hh * 0.2, MX, MY, hw * 1.15, [
        [0, '#c2566b'], [0.42, '#9c3450'], [1, '#6b2036'],
      ]);
      g.fill(); g.lineWidth = 6; g.strokeStyle = OL; g.stroke();
      if (hh > 12) {
        g.save();
        mouthPath(g, MX, MY, hw - 3, hh - 3, dip); g.clip();
        // おくの やわらかい かげ
        g.fillStyle = 'rgba(96,26,48,0.42)';
        ell(g, MX + 6, MY - hh * 0.2, hw * 0.55, hh * 0.45); g.fill();
        // した（ぷっくり）
        ell(g, MX - 2, MY + hh * 0.5, hw * 0.52, hh * 0.44);
        g.fillStyle = rad(g, MX - 14, MY + hh * 0.3, 2, MX - 2, MY + hh * 0.5, hw * 0.6, [
          [0, '#ffc0d0'], [0.5, '#f58aa6'], [1, '#d2567a'],
        ]);
        g.fill();
        g.strokeStyle = 'rgba(176,66,100,0.45)'; g.lineWidth = 3;
        g.beginPath();
        g.moveTo(MX - 2, MY + hh * 0.28); g.lineTo(MX - 2, MY + hh * 0.72); g.stroke();
        // 舌の ツヤ 一点
        gloss(g, MX - 14, MY + hh * 0.38, hw * 0.15, hh * 0.1, -0.35, 0.6);
        g.restore();
      }
      g.lineWidth = 7; g.strokeStyle = OL;
    } else {
      // とじた口＝小さな ω。中心は あいた口と おなじ (MX, MY)
      // はば（±25）は あきはじめの 口（o→0 で ±24）と そろえて、
      // ω から まるい口へ つながる ときに ガタつかない ように する。
      g.beginPath();
      g.moveTo(MX - 25, MY - 5);
      g.quadraticCurveTo(MX - 12, MY + 11, MX, MY + 1);
      g.quadraticCurveTo(MX + 12, MY + 11, MX + 25, MY - 5);
      g.strokeStyle = '#6b4320'; g.lineWidth = 7; g.lineCap = 'round'; g.stroke();
      g.strokeStyle = OL; g.lineWidth = 7;
    }

    // きらいなものを 食べたときの 表情
    if (mood === 'yuck') {
      g.strokeStyle = '#2f6fd0'; g.lineWidth = 6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(30, -100); g.lineTo(60, -88); g.stroke();
      g.beginPath(); g.moveTo(136, -102); g.lineTo(108, -90); g.stroke();
      // あせ
      g.fillStyle = 'rgba(90,170,235,0.85)';
      g.beginPath();
      g.moveTo(-101, -88); g.quadraticCurveTo(-109, -72, -99, -68);
      g.quadraticCurveTo(-89, -72, -101, -88); g.closePath(); g.fill();
    }
    if (mood === 'yum') {
      // きらきら
      for (let i = 0; i < 3; i++) {
        const a = t * 4 + i * TAU / 3;
        sparkle(g, 218 + Math.cos(a) * 26, -90 + Math.sin(a) * 30, 12 + Math.sin(a) * 3);
      }
    }
    g.restore();
  }

  /* ---------- ベルトコンベア ---------- */
  function drawBelt(g, scroll) {
    g.save();
    // 台
    g.fillStyle = '#9aa6b2';
    A.roundRect(g, MOUTH_X - 40, BELT_TOP, W - (MOUTH_X - 40) + 60, BELT_H, 16);
    g.fill();
    g.strokeStyle = OL; g.lineWidth = 6; g.stroke();
    // 走っている しま
    g.save();
    g.beginPath();
    A.roundRect(g, MOUTH_X - 40, BELT_TOP, W - (MOUTH_X - 40) + 60, BELT_H, 16);
    g.clip();
    g.fillStyle = 'rgba(255,255,255,.22)';
    const step = 88;
    const off = -(scroll % step);
    for (let x = MOUTH_X - 40 + off; x < W + 80; x += step) {
      g.beginPath();
      g.moveTo(x, BELT_TOP); g.lineTo(x + 30, BELT_TOP);
      g.lineTo(x + 30 - 22, BELT_TOP + BELT_H); g.lineTo(x - 22, BELT_TOP + BELT_H);
      g.closePath(); g.fill();
    }
    g.restore();
    // ローラー
    g.fillStyle = '#7d8995';
    for (let x = MOUTH_X + 20; x < W; x += 150) {
      g.beginPath(); g.arc(x, BELT_TOP + BELT_H + 22, 20, 0, 7); g.fill();
      g.strokeStyle = OL; g.lineWidth = 5; g.stroke();
      g.save(); g.translate(x, BELT_TOP + BELT_H + 22); g.rotate(-scroll / 20);
      g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(-13, 0); g.lineTo(13, 0); g.stroke();
      g.restore();
    }
    g.restore();
  }

  /* ---------- 背景 ---------- */
  function drawBg(g, t) {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#bfe9ff');
    sky.addColorStop(0.62, '#e7f7ff');
    sky.addColorStop(1, '#fdf3dd');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // おひさま
    g.save(); g.translate(1700, 150);
    g.fillStyle = '#ffd94a';
    for (let i = 0; i < 12; i++) {
      g.save(); g.rotate(i / 12 * Math.PI * 2 + t * 0.2);
      g.beginPath(); g.moveTo(0, -78); g.lineTo(9, -104); g.lineTo(-9, -104); g.closePath(); g.fill();
      g.restore();
    }
    g.beginPath(); g.arc(0, 0, 66, 0, 7); g.fill();
    g.strokeStyle = '#eab308'; g.lineWidth = 5; g.stroke();
    g.restore();
    // おか
    g.fillStyle = '#9fd96b';
    g.beginPath();
    g.moveTo(0, H);
    g.lineTo(0, 880);
    g.quadraticCurveTo(480, 806, 980, 872);
    g.quadraticCurveTo(1480, 934, W, 860);
    g.lineTo(W, H);
    g.closePath(); g.fill();
    g.fillStyle = '#86c955';
    g.beginPath();
    g.moveTo(0, H); g.lineTo(0, 960);
    g.quadraticCurveTo(600, 1000, 1200, 952);
    g.quadraticCurveTo(1600, 920, W, 968);
    g.lineTo(W, H); g.closePath(); g.fill();
  }

  /* ---------- メニューのサムネイル（552x300） ---------- */
  function drawThumb(g) {
    const s = 552 / W;
    g.save();
    g.scale(s, s);
    drawBg(g, 0.4);
    drawBelt(g, 40);
    drawBear(g, BEAR_X, BEAR_Y - 90, 0.85, 0.4, 'yum');
    drawFood(g, 'apple', 760, ITEM_Y - 90, FOOD_S, 0.2);
    drawFood(g, 'cake', 1200, ITEM_Y - 90, FOOD_S, 0.5);
    drawFood(g, 'pepper', 1640, ITEM_Y - 90, FOOD_S, 0.8);
    g.restore();
  }

  /* ---------- あそびかたの アイコン ---------- */
  const SVG_LIKE = '<svg viewBox="0 0 64 64"><circle cx="32" cy="34" r="22" fill="#e8364a" stroke="#5b3a22" stroke-width="4"/>' +
    '<path d="M32 12 l3 -8" stroke="#6b4320" stroke-width="5" stroke-linecap="round"/>' +
    '<path d="M44 56 l6 6 12 -14" stroke="#2f9e44" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const SVG_HATE = '<svg viewBox="0 0 64 64"><path d="M14 26 q-4 30 18 30 q22 0 18 -30 q-6 -12 -18 -12 q-12 0 -18 12z" fill="#44ab3f" stroke="#5b3a22" stroke-width="4"/>' +
    '<path d="M32 18 v-10" stroke="#2f7a2c" stroke-width="6" stroke-linecap="round"/>' +
    '<path d="M46 50 l14 14 M60 50 l-14 14" stroke="#e8264a" stroke-width="7" stroke-linecap="round"/></svg>';
  const SVG_PERFECT = '<svg viewBox="0 0 64 64"><path d="M32 6 l7 15 16 2 -12 11 3 16 -14 -8 -14 8 3 -16 -12 -11 16 -2z" fill="#ffd43b" stroke="#c79a0a" stroke-width="3"/></svg>';

  /* =========================================================
     ゲーム登録
     ========================================================= */
  A.register({
    id: 'snack',
    order: 4,
    title: 'おやつをパクッ！',
    shortTitle: 'おやつ',
    catch: 'くまさんの すきなものだけ たべさせよう！ スペースキーだけ',
    tags: ['1人', 'スペースキー', '30〜45びょう'],
    isNew: true,
    theme: { main: '#f2a33c', dark: '#cf7a12', light: '#fff2dd' },
    bgm: 'snack',
    howto: [
      { icon: '<span class="key wide">スペース</span>', html: '<b>おしっぱなしで 口が あく</b>。はなすと しまる（クリックでも OK）' },
      { icon: SVG_LIKE, html: '<b>すきな たべもの</b>が きたら おしっぱなしで パクッ！' },
      { icon: SVG_HATE, html: '<b>きらいな たべもの</b>の ときは 口を とじて 見おくる' },
      { icon: SVG_PERFECT, html: 'ぜんぶ せいかいで <b>パーフェクト</b>！ なまえを のこせるよ' },
    ],
    modes: [
      { id: 'easy', label: 'やさしい', sub: 'はじめて・ちいさい子', desc: 'すき2つ・きらい1つ。ゆっくり ながれるので あわてなくて だいじょうぶ', recommend: true },
      { id: 'normal', label: 'ふつう', sub: 'しょうがくせい〜', desc: 'すき3つ・きらい2つ。すこし はやくなる' },
      { id: 'hard', label: 'むずかしい', sub: 'おとな向け', desc: 'すき4つ・きらい3つ。はやい！ とちゅうで ベルトの速さも かわる' },
      { id: 'chaos', label: 'げきむず', sub: 'ゲーム好きの人へ', desc: 'きらいも4つ。雲でかくれる・鳥がさらう・速さが かわる。見ていれば 対応できる' },
    ],
    rank: {
      boards: [
        { id: 'snack.easy', label: 'やさしい パーフェクト', short: 'やさしい', kind: 'clear' },
        { id: 'snack.normal', label: 'ふつう パーフェクト', short: 'ふつう', kind: 'clear' },
        { id: 'snack.hard', label: 'むずかしい パーフェクト', short: 'むずかしい', kind: 'clear' },
        { id: 'snack.chaos', label: 'げきむず パーフェクト', short: 'げきむず', kind: 'clear' },
      ],
      boardOf: function (opts) {
        const id = opts && opts.mode;
        return LEVELS[id] ? 'snack.' + id : null;
      },
    },
    // 自己ベストは ゲーム側で持つ（ランキングは クリア者リストなので 点数を書きこまない）
    bestHtml: function (store) {
      const parts = LEVEL_IDS.map(function (k) {
        const v = Number(store.get('snack.best.' + k, 0)) || 0;
        return LEVELS[k].label + ' <b>' + (v > 0 ? v + 'てん' : '−') + '</b>';
      });
      return 'きろく：' + parts.join('　／　');
    },
    drawThumb: drawThumb,
    create: createGame,
  });

  /* =========================================================
     本体
     ========================================================= */
  function createGame(api) {
    const seedQ = api.params.get('seed');
    const rnd = api.rng((seedQ !== null && seedQ !== '' && isFinite(Number(seedQ))) ? (Number(seedQ) >>> 0) : ((Math.random() * 1e9) >>> 0));

    let L = LEVELS.easy;
    let mode = 'demo';          // demo | count | play | end
    let T = 0, cd = 0, playT = 0, endT = 0;
    let likes = [], hates = [];
    let items = [];
    let score = 0, combo = 0, maxCombo = 0;
    let eaten = 0, badEaten = 0, missed = 0, totalLikes = 0;
    // 口は「おしているあいだ ずっと あく」
    let holdKey = false;        // スペースキーを おしている
    let holdPtr = false;        // マウス／タップを おしている
    let openMinT = 0;           // ちょこんと おしただけでも これだけは あける
    let openAmt = 0;            // 絵の あき具合（0〜1。なめらかに 動かす）
    let demoOpen = false;       // 見本（メニューのうしろ）で 口を あけているか
    let demoT2 = 0;
    let moodT = 0, mood = 'ok';
    let pops = [];              // 「おいしい！」などの ふきだし
    let scroll = 0;
    let spawnT = 0;
    let finished = false;
    let hold = false;           // テスト用：update を止める
    let shake = 0;

    // しかけ（むずかしい以上）
    let vMul = 1, vTarget = 1, warnT = 0, warnMsg = '', gimT = 6;
    let clouds = [];
    let birds = [];

    const stats = { spawns: 0, press: 0, pressHit: 0, gims: { speed: 0, cloud: 0, bird: 0 } };

    function bestKey() { return 'snack.best.' + L.id; }

    /* ---------- すき・きらいを えらぶ ---------- */
    function pickMenu() {
      const pool = FOOD_IDS.slice();
      // シャッフル
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      likes = pool.slice(0, L.like);
      hates = pool.slice(L.like, L.like + L.hate);
    }

    function reset(levelId) {
      L = levelOf(levelId);
      pickMenu();
      items = []; pops = []; clouds = []; birds = [];
      score = 0; combo = 0; maxCombo = 0;
      eaten = 0; badEaten = 0; missed = 0; totalLikes = 0;
      // 「押しっぱなし」が のこらないように かならず はなした状態に もどす
      holdKey = false; holdPtr = false; openMinT = 0; openAmt = 0;
      demoOpen = false; demoT2 = 0;
      moodT = 0; mood = 'ok';
      playT = 0; endT = 0; scroll = 0; spawnT = 0.7;
      vMul = 1; vTarget = 1; warnT = 0; warnMsg = ''; gimT = 7;
      finished = false; shake = 0;
      stats.spawns = 0; stats.press = 0; stats.pressHit = 0;
      stats.gims = { speed: 0, cloud: 0, bird: 0 };
    }

    /* ---------- 食べ物を 出す ---------- */
    function spawn() {
      const like = rnd() < L.pLike;
      const from = like ? likes : hates;
      const kind = from[Math.floor(rnd() * from.length)];
      items.push({
        kind: kind, like: like, x: SPAWN_X, y: ITEM_Y,
        eaten: false, judged: false, hide: 0, t: rnd() * 6,
        pop: 0, gone: 0,
      });
      stats.spawns++;
      if (like) totalLikes++;
    }

    function addPop(x, y, txt, col) {
      pops.push({ x: x, y: y, txt: txt, col: col, t: 0 });
    }

    /* ---------- 口を あける／しめる ----------
       おしている あいだ ずっと あく。クールダウンは 無い。
       そのかわり、あけっぱなしに すると きらいなものまで 食べてしまう（−150点）。
       それが この ゲームの かけひきに なる。 */
    function mouthHeld() { return holdKey || holdPtr; }
    function mouthIsOpen() { return mouthHeld() || openMinT > 0; }

    function pressDown() {
      if (mode !== 'play' || finished) return;
      openMinT = OPEN_MIN;
      stats.press++;
      api.sfx('pop');
    }
    // 「押しっぱなし」を かならず はずす（一時停止・ウィンドウ非アクティブ・やりなおし）
    function releaseAll() { holdKey = false; holdPtr = false; openMinT = 0; }

    /* ---------- 判定 ---------- */
    function tryEat() {
      // 口のあたりに いるものを 1つだけ 食べる（手前のものから）
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.eaten || it.gone) continue;
        if (Math.abs(it.x - MOUTH_X) > MOUTH_HALF) continue;
        it.eaten = true; it.judged = true;
        stats.pressHit++;
        if (it.like) {
          combo++;
          if (combo > maxCombo) maxCombo = combo;
          const bonus = PT_COMBO * Math.min(combo - 1, COMBO_CAP);
          score += PT_EAT + bonus;
          eaten++;
          mood = 'yum'; moodT = 0.7;
          addPop(MOUTH_X + 40, ITEM_Y - 90, combo >= 3 ? ('おいしい！ ' + combo + 'れんぞく') : 'おいしい！', '#2f9e44');
          api.sfx('coin');
        } else {
          combo = 0;
          score = Math.max(0, score + PT_BAD);
          badEaten++;
          mood = 'yuck'; moodT = 0.9;
          shake = 0.35;
          addPop(MOUTH_X + 40, ITEM_Y - 90, 'うえっ…', '#e8264a');
          api.sfx('bad');
        }
        return;
      }
    }

    /* ---------- しかけ ---------- */
    function fireGimmick() {
      if (L.gim <= 0) return;
      const kinds = L.gim >= 2 ? ['speed', 'cloud', 'bird'] : ['speed'];
      const k = kinds[Math.floor(rnd() * kinds.length)];
      if (k === 'speed') {
        const up = rnd() < 0.62;
        vTarget = up ? 1.34 : 0.76;
        warnMsg = up ? 'はやく なるよ！' : 'ゆっくり なるよ！';
        warnT = 1.2;
        stats.gims.speed++;
      } else if (k === 'cloud') {
        clouds.push({ x: W + 320, y: ITEM_Y - 10, w: 420, t: 0 });
        warnMsg = 'くもが くるよ！'; warnT = 1.0;
        stats.gims.cloud++;
      } else {
        // 鳥：右のほうの 食べ物を 1つ 別のものに すりかえる
        let target = null;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (!it.eaten && !it.gone && it.x > 1250) { target = it; break; }
        }
        if (target) {
          birds.push({ x: target.x + 120, y: -140, t: 0, target: target, done: false });
          warnMsg = 'とりが くるよ！'; warnT = 1.0;
          stats.gims.bird++;
        }
      }
    }

    /* ---------- 終了 ---------- */
    function perfect() { return badEaten === 0 && missed === 0 && eaten > 0; }

    function end() {
      if (finished) return;
      finished = true;
      mode = 'end';
      endT = 0;
      // 時間ぎれのとき、まだ ベルトに のこっている すきなものは 数に入れない
      // （「たべた 18／21」のように 届かなかったぶんまで 数えないため）
      for (let i = 0; i < items.length; i++) {
        if (!items[i].judged && items[i].like) totalLikes--;
      }
      const pf = perfect();
      // 自己ベスト（ゲーム側で持つ）
      const prev = Number(api.store.get(bestKey(), 0)) || 0;
      if (score > prev) api.store.set(bestKey(), score);
      api.sfx(pf ? 'win' : 'finish');
      const sub = 'たべた <b>' + eaten + '</b>／' + totalLikes +
        '　まちがい <b>' + badEaten + '</b>　見のがし <b>' + missed + '</b>' +
        '　さいこうれんぞく <b>' + maxCombo + '</b>';
      api.finish({
        // クリア者リストなので「パーフェクトのときだけ 1」
        score: pf ? 1 : 0,
        ribbon: pf ? 'パーフェクト！！' : ribbonFor(score, badEaten, missed),
        headline: pf ? (L.label + ' パーフェクト！') : (L.label + ' おしまい'),
        big: score + 'てん',
        sub: sub,
        delay: 1100,
      });
    }

    function ribbonFor(s, bad, mis) {
      if (bad === 0 && mis <= 1) return 'おしい！ あと すこし！';
      if (s >= 1200) return 'たくさん たべたね！';
      if (s >= 600) return 'いいね！ そのちょうし！';
      if (s > 0) return 'よく がんばったね！';
      return 'もういちど ちょうせん！';
    }

    /* =========================================================
       update
       ========================================================= */
    function update(dt) {
      if (hold) return;
      T += dt;
      if (moodT > 0) { moodT -= dt; if (moodT <= 0) mood = 'ok'; }
      if (shake > 0) shake = Math.max(0, shake - dt);

      // ふきだし
      for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].t += dt;
        if (pops[i].t > 1.1) pops.splice(i, 1);
      }

      if (mode === 'demo') {
        // 説明画面のうしろで ゆっくり ながす
        scroll += 180 * dt;
        demoFlow(dt);
        return;
      }
      if (mode === 'count') {
        cd += dt;
        const was = Math.ceil(COUNT_TIME - (cd - dt));
        const now = Math.ceil(COUNT_TIME - cd);
        if (now !== was && now >= 0) api.sfx(now === 0 ? 'go' : 'count');
        if (cd >= COUNT_TIME) {
          mode = 'play'; playT = 0;
          // カウントダウンの あいだから おしっぱなしの ときも ちゃんと 数える
          if (mouthHeld()) { openMinT = OPEN_MIN; stats.press++; api.sfx('pop'); }
        }
        return;
      }
      if (mode === 'end') { endT += dt; scroll += 120 * dt; return; }

      /* ---- play ---- */
      playT += dt;
      if (playT >= L.time) { end(); return; }

      // 口（おしている あいだ ずっと あいている）
      if (openMinT > 0) openMinT = Math.max(0, openMinT - dt);
      const wantOpen = mouthIsOpen();
      openAmt += ((wantOpen ? 1 : 0) - openAmt) * Math.min(1, dt / OPEN_TAU);
      if (wantOpen) tryEat();

      // 速さ（なめらかに 変える）
      vMul += (vTarget - vMul) * Math.min(1, dt * 2.2);
      if (warnT > 0) warnT = Math.max(0, warnT - dt);

      const v = L.v * vMul;
      scroll += v * dt;

      // しかけ
      if (L.gim > 0) {
        gimT -= dt;
        if (gimT <= 0) { fireGimmick(); gimT = 6.5 + rnd() * 3.5; }
      }

      // 雲
      for (let i = clouds.length - 1; i >= 0; i--) {
        const c = clouds[i];
        c.t += dt;
        c.x -= v * 1.12 * dt;
        if (c.x < -520) clouds.splice(i, 1);
      }
      // 鳥
      for (let i = birds.length - 1; i >= 0; i--) {
        const b = birds[i];
        b.t += dt;
        const tgt = b.target;
        if (!b.done && tgt && !tgt.eaten && !tgt.gone) {
          b.x += (tgt.x - b.x) * Math.min(1, dt * 3.4);
          b.y += ((ITEM_Y - 70) - b.y) * Math.min(1, dt * 3.0);
          if (b.t > 0.9 && Math.abs(b.x - tgt.x) < 60) {
            // すりかえ（見えるように ふきだしを出す）
            const flip = rnd() < 0.5;
            const from = flip ? likes : hates;
            tgt.kind = from[Math.floor(rnd() * from.length)];
            if (tgt.like !== flip) {
              // すきの数が ずれないように 数え直す
              if (tgt.like) totalLikes--; else totalLikes++;
              tgt.like = flip;
            }
            tgt.pop = 0.4;
            addPop(tgt.x, ITEM_Y - 110, 'すりかえ！', '#c79a0a');
            api.sfx('wall');
            b.done = true;
          }
        } else {
          b.x -= v * 0.6 * dt;
          b.y -= 240 * dt;
        }
        if (b.y < -260 || b.x < -260 || b.t > 7) birds.splice(i, 1);
      }

      // 出す
      spawnT -= dt;
      if (spawnT <= 0) {
        // 口まで とどかないものは 出さない（時間ぎれで「見のがし」に なってしまうため）
        const travel = (SPAWN_X - MISS_X) / Math.max(60, L.v * Math.min(vMul, vTarget));
        if (L.time - playT > travel + 0.15) spawn();
        // 間かくは 少しだけ ばらす（ただし つめすぎない）
        spawnT = L.gap * (0.88 + rnd() * 0.26);
      }

      // 食べ物を うごかす
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        it.t += dt;
        if (it.pop > 0) it.pop = Math.max(0, it.pop - dt);
        if (it.eaten) {
          it.gone += dt;
          if (it.gone > 0.3) items.splice(i, 1);
          continue;
        }
        it.x -= v * dt;
        // 雲に かくれているか
        let hid = 0;
        for (let c = 0; c < clouds.length; c++) {
          const cl = clouds[c];
          if (Math.abs(it.x - cl.x) < cl.w * 0.5) hid = 1;
        }
        it.hide += (hid - it.hide) * Math.min(1, dt * 7);
        // 見のがし
        if (!it.judged && it.x < MISS_X) {
          it.judged = true;
          if (it.like) {
            missed++;
            combo = 0;
            score = Math.max(0, score + PT_MISS);
            addPop(MISS_X - 10, ITEM_Y - 90, 'あーあ…', '#e07b2a');
            api.sfx('bonk');
          }
        }
        if (it.x < -140) items.splice(i, 1);
      }
    }

    // 説明画面のうしろで ながれる デモ
    let demoT = 0;
    function demoFlow(dt) {
      demoT -= dt;
      if (demoT <= 0) {
        const k = FOOD_IDS[Math.floor(rnd() * FOOD_IDS.length)];
        items.push({ kind: k, like: true, x: SPAWN_X, y: ITEM_Y, eaten: false, judged: true, hide: 0, t: rnd() * 6, pop: 0, gone: 0 });
        demoT = 1.1;
      }
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        it.t += dt;
        it.x -= 300 * dt;
        if (it.x < -140) items.splice(i, 1);
      }
      // デモ（メニューの見本）では かってに 開け閉めする
      demoT2 -= dt;
      if (demoT2 <= 0) { demoOpen = !demoOpen; demoT2 = demoOpen ? 0.5 : 1.2; }
      openAmt += ((demoOpen ? 1 : 0) - openAmt) * Math.min(1, dt / OPEN_TAU);
    }

    /* =========================================================
       draw
       ========================================================= */
    /* ---------- テスト用：絵を 目で たしかめる ための 表示 ----------
       1=たべもの12種ならべ／2=口の位置あわせ／3=口のあき具合と3つの表情 */
    let sheet = 0;
    function drawSheet(g) {
      if (sheet === 2) {
        drawBg(g, 0.4); drawBelt(g, 40);
        drawBear(g, BEAR_X, BEAR_Y, 1, 0, 'ok');
        // たしかめ用に 口の まえに かさねて みせる
        g.save(); g.globalAlpha = 0.75;
        drawFood(g, 'banana', MOUTH_X, ITEM_Y, FOOD_S, 0);
        g.restore();
        g.save();
        g.strokeStyle = '#e8264a'; g.lineWidth = 5; g.setLineDash([16, 12]);
        [MOUTH_X - MOUTH_HALF, MOUTH_X + MOUTH_HALF].forEach(function (lx) {
          g.beginPath(); g.moveTo(lx, 400); g.lineTo(lx, BELT_TOP + 90); g.stroke();
        });
        g.setLineDash([]);
        g.strokeStyle = '#1f7ae0'; g.lineWidth = 6;
        g.beginPath(); g.moveTo(MOUTH_X, 380); g.lineTo(MOUTH_X, BELT_TOP + 110); g.stroke();
        g.beginPath(); g.moveTo(MOUTH_X - 200, ITEM_Y); g.lineTo(MOUTH_X + 260, ITEM_Y); g.stroke();
        g.restore();
        A.text(g, 'あお＝MOUTH_X と ITEM_Y　／　赤＝あたり判定の はば', W / 2, 180,
          { size: 42, color: '#2b1a14', stroke: '#fff', strokeWidth: 10 });
        return;
      }
      const bgr = g.createLinearGradient(0, 0, 0, H);
      bgr.addColorStop(0, '#fff8ea'); bgr.addColorStop(1, '#ffe7c4');
      g.fillStyle = bgr; g.fillRect(0, 0, W, H);
      if (sheet === 1) {
        FOOD_IDS.forEach(function (k, i) {
          const cx = 240 + (i % 4) * 480, cy = 175 + Math.floor(i / 4) * 335;
          drawFood(g, k, cx, cy, 2.1, 0);
          A.text(g, FOODS[k].name, cx, cy + 148, { size: 46, color: '#5b3a22' });
        });
        return;
      }
      // 3＝口の あきぐあい（両目が ずっと 見えているか たしかめる）
      // 4＝3つの 表情
      const row = sheet === 3
        ? [[0, 'ok'], [0.45, 'ok'], [1, 'ok']]
        : [[0, 'ok'], [1, 'yum'], [1, 'yuck']];
      row.forEach(function (p, i) {
        const cx = 330 + i * 630;
        g.save();
        g.translate(cx, 520);
        drawBear(g, 0, 0, p[0], 0.4, p[1]);
        g.restore();
        A.text(g, 'あき ' + p[0] + ' / ' + p[1], cx, 900, { size: 44, color: '#5b3a22' });
      });
    }

    function draw(g) {
      if (sheet) { drawSheet(g); return; }
      g.save();
      if (shake > 0) {
        const s = shake * 16;
        g.translate((rnd() - 0.5) * s, (rnd() - 0.5) * s);
      }
      drawBg(g, T);
      drawBelt(g, scroll);
      // ねらう場所の 目印は ここ（食べ物と くまさんの うしろ）
      if (mode === 'play') drawAimMark(g);

      // くまさん（食べ物より さきに かく）
      drawBear(g, BEAR_X, BEAR_Y, Math.max(0, Math.min(1, openAmt)), T, mood);

      /* 食べ物は くまさんの まえに かく。
         こうしないと、あたり判定の ゾーン（MOUTH_X±MOUTH_HALF ＝ 310〜482）が
         まるごと あたまの うしろに なってしまい、
         「口に 入る ところ」と「パクッと 食べた ところ」が 画面から 消えてしまう。
         まえに かけば、あいた口に かさなって 吸いこまれるように 見える。
         ただし 口を 通りすぎた ものは、そのまま だと くまさんの 顔の上を
         すべって いってしまうので、すっと 消えるように する。 */
      items.forEach(function (it) {
        const sc = it.eaten ? Math.max(0, 1 - it.gone / 0.3) : (1 + it.pop * 0.5);
        if (sc <= 0) return;
        const a = it.eaten ? 1 : Math.max(0, Math.min(1, (it.x - (MISS_X - 130)) / 130));
        if (a <= 0) return;
        g.save();
        g.globalAlpha = a;
        drawFood(g, it.kind, it.x, ITEM_Y + (it.eaten ? -it.gone * 90 : 0), sc * FOOD_S, it.t);
        g.restore();
      });

      // 雲（食べ物の うえ）
      clouds.forEach(function (c) { drawCloud(g, c.x, c.y, c.w); });
      // 鳥
      birds.forEach(function (b) { drawBird(g, b.x, b.y, b.t); });

      // ふきだし
      pops.forEach(function (p) {
        const a = p.t < 0.8 ? 1 : (1.1 - p.t) / 0.3;
        g.save();
        g.globalAlpha = Math.max(0, Math.min(1, a));
        A.text(g, p.txt, p.x, p.y - p.t * 60, { size: 46, color: p.col, stroke: '#fff', strokeWidth: 10 });
        g.restore();
      });

      g.restore();

      if (mode !== 'demo') drawHud(g);
      if (mode === 'count') drawCount(g);
    }

    /* 雲。食べ物を かくす しかけ なので、食べ物の たてはば ぜんぶを おおうこと。
       FOOD_S=2.0 では 食べ物は ITEM_Y から 下へ 110px（にんじんが いちばん 長い）。
       たてを 96 の ままに すると 下が はみ出して、色で 中身が バレてしまう。 */
    function drawCloud(g, x, y, w) {
      g.save();
      g.globalAlpha = 0.93;
      g.fillStyle = '#ffffff';
      g.strokeStyle = '#cfdce6'; g.lineWidth = 5; g.lineJoin = 'round';
      g.beginPath();
      g.ellipse(x, y, w * 0.5, 124, 0, 0, 7);
      g.fill(); g.stroke();
      g.beginPath(); g.ellipse(x - w * 0.22, y - 66, 94, 64, 0, 0, 7); g.fill();
      g.beginPath(); g.ellipse(x + w * 0.2, y - 74, 104, 70, 0, 0, 7); g.fill();
      g.restore();
    }

    function drawBird(g, x, y, t) {
      g.save();
      g.translate(x, y);
      g.lineJoin = 'round';
      g.strokeStyle = OL; g.lineWidth = 5;
      const fl = Math.sin(t * 16) * 0.5;
      // はね
      g.fillStyle = '#7f8fd6';
      g.save(); g.rotate(-0.5 + fl);
      g.beginPath(); g.ellipse(-16, -14, 44, 18, 0, 0, 7); g.fill(); g.stroke();
      g.restore();
      // からだ
      g.beginPath(); g.ellipse(0, 0, 36, 26, 0, 0, 7);
      g.fillStyle = '#9aa8e8'; g.fill(); g.stroke();
      // あたま
      g.beginPath(); g.arc(28, -12, 19, 0, 7); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(44, -12); g.lineTo(62, -6); g.lineTo(44, -2); g.closePath();
      g.fillStyle = '#f7a93b'; g.fill(); g.stroke();
      g.beginPath(); g.arc(32, -16, 4.5, 0, 7); g.fillStyle = '#2a2a2a'; g.fill();
      g.restore();
    }

    /* ---------- 画面うえの 表示 ---------- */
    function panel(g, x, y, w, h, fill, line) {
      g.save();
      A.roundRect(g, x, y, w, h, 22);
      g.fillStyle = fill; g.fill();
      g.strokeStyle = line; g.lineWidth = 6; g.stroke();
      g.restore();
    }

    function drawHud(g) {
      // とくてん
      panel(g, 28, 24, 320, 112, 'rgba(255,255,255,.93)', '#f2a33c');
      A.text(g, 'とくてん', 54, 52, { size: 26, color: '#8a7a62', align: 'left' });
      A.text(g, String(score), 332, 96, { size: 56, color: '#3a2a1c', align: 'right' });

      // のこり時間（右上は 音・ぜんがめんの ボタンが あるので 左の 下に おく）
      const left = Math.max(0, Math.ceil(L.time - playT));
      const warn = left <= 5 && mode === 'play';
      panel(g, 28, 148, 320, 104, 'rgba(255,255,255,.93)', warn ? '#e8264a' : '#f2a33c');
      A.text(g, 'のこり', 54, 174, { size: 26, color: '#8a7a62', align: 'left' });
      A.text(g, left + 'びょう', 332, 216, { size: 44, color: warn ? '#e8264a' : '#3a2a1c', align: 'right' });

      // すき／きらい
      drawMenuPanel(g, 392, 24, likes, true);
      drawMenuPanel(g, 392 + menuW(likes) + 26, 24, hates, false);

      // コンボ
      if (combo >= 3 && mode === 'play') {
        A.text(g, combo + ' れんぞく！', 190, 300, { size: 40, color: '#e07b2a', stroke: '#fff', strokeWidth: 9 });
      }
      // ※ ねらう場所の 目印は くまさんより うしろに かく（draw の中）。
      //    ここで かくと あけた口の 中を 白い線が よこぎって きたなく 見える。
      // しかけの よこく
      if (warnT > 0 && warnMsg) {
        const a = Math.min(1, warnT * 2.2);
        g.save(); g.globalAlpha = a;
        A.text(g, warnMsg, W / 2, 232, { size: 54, color: '#d0408f', stroke: '#fff', strokeWidth: 12 });
        g.restore();
      }
    }

    /* 口の あたり（ねらう場所）の 目印。
       くまさんの 顔を よこぎらない ように、あごより 下（ベルトの ところ）に おく。
       くまさんより まえに かかないこと（あけた口の 中を 線が とおって きたなく 見える）。 */
    function drawAimMark(g) {
      g.save();
      g.globalAlpha = 0.5 + 0.25 * Math.sin(T * 4);
      g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.lineCap = 'butt';
      g.setLineDash([14, 12]);
      g.beginPath();
      g.moveTo(MOUTH_X, BELT_TOP + 20); g.lineTo(MOUTH_X, BELT_TOP + BELT_H - 6);
      g.stroke();
      g.setLineDash([]);
      // ここ！の しるし（上むきの 小さな 三角）
      g.beginPath();
      g.moveTo(MOUTH_X, BELT_TOP + 4);
      g.lineTo(MOUTH_X + 14, BELT_TOP + 24);
      g.lineTo(MOUTH_X - 14, BELT_TOP + 24);
      g.closePath();
      g.fillStyle = '#ffffff'; g.fill();
      g.restore();
    }

    function menuW(list) { return 150 + list.length * 92; }

    function drawMenuPanel(g, x, y, list, isLike) {
      const w = menuW(list), h = 112;
      panel(g, x, y, w, h, isLike ? 'rgba(227,250,224,.95)' : 'rgba(255,230,230,.95)', isLike ? '#2f9e44' : '#e8264a');
      A.text(g, isLike ? 'すき' : 'きらい', x + 22, y + h / 2, {
        size: 36, color: isLike ? '#2f9e44' : '#e8264a', align: 'left',
      });
      list.forEach(function (k, i) {
        const cx = x + 150 + i * 92 + 34;
        drawFood(g, k, cx, y + h / 2, 0.62, 0);
      });
      if (!isLike) {
        // きらいには ✕ を そえる
        g.save();
        g.strokeStyle = 'rgba(232,38,74,.85)'; g.lineWidth = 7; g.lineCap = 'round';
        list.forEach(function (k, i) {
          const cx = x + 150 + i * 92 + 34;
          g.beginPath(); g.moveTo(cx - 26, y + h / 2 - 26); g.lineTo(cx + 26, y + h / 2 + 26);
          g.moveTo(cx + 26, y + h / 2 - 26); g.lineTo(cx - 26, y + h / 2 + 26);
          g.stroke();
        });
        g.restore();
      }
    }

    function drawCount(g) {
      const left = Math.ceil(COUNT_TIME - cd);
      const txt = left <= 0 ? 'スタート！' : String(left);
      const k = 1 - ((COUNT_TIME - cd) % 1);
      g.save();
      g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, 0, W, H);
      g.translate(W / 2, H / 2 - 40);
      g.scale(1 + k * 0.25, 1 + k * 0.25);
      A.text(g, txt, 0, 0, { size: left <= 0 ? 150 : 210, color: '#fff', stroke: '#f2a33c', strokeWidth: 20 });
      g.restore();
      A.text(g, 'すき：' + likes.map(function (k2) { return FOODS[k2].name; }).join('・'),
        W / 2, H / 2 + 150, { size: 50, color: '#2f9e44', stroke: '#fff', strokeWidth: 12 });
      A.text(g, 'きらい：' + hates.map(function (k2) { return FOODS[k2].name; }).join('・'),
        W / 2, H / 2 + 220, { size: 50, color: '#e8264a', stroke: '#fff', strokeWidth: 12 });
    }

    /* =========================================================
       エンジンとの やりとり
       ========================================================= */
    const inst = {
      start: function (opts) {
        reset((opts && opts.mode) || 'easy');
        // reset() でも もどしているが、はじまりでは かならず はなした状態に する
        releaseAll();
        mode = 'count';
        cd = 0;
        api.setCursor('pointer');
      },
      update: update,
      draw: draw,
      onKeyDown: function (code) {
        if (code !== 'Space') return;
        if (!mouthHeld()) pressDown();   // キーと マウスの 同時おしで 二重に 数えない
        holdKey = true;
      },
      onKeyUp: function (code) {
        if (code === 'Space') holdKey = false;
      },
      onPointerDown: function () { if (!mouthHeld()) pressDown(); holdPtr = true; },
      onPointerUp: function () { holdPtr = false; },
      // 一時停止・ウィンドウ非アクティブ。engine は 止まっている間 onKeyUp を くれないので
      // ここで かならず はなした状態に もどす（わすれると 口が あきっぱなしに なる）
      onPause: function () { releaseAll(); },
      debug: {
        // テスト用
        get mode() { return mode; },
        get score() { return score; },
        get likes() { return likes.slice(); },
        get hates() { return hates.slice(); },
        get items() {
          return items.map(function (it) { return { kind: it.kind, like: it.like, x: Math.round(it.x), eaten: it.eaten, judged: it.judged }; });
        },
        get counts() { return { eaten: eaten, bad: badEaten, missed: missed, totalLikes: totalLikes, maxCombo: maxCombo }; },
        get perfect() { return perfect(); },
        get stats() { return JSON.parse(JSON.stringify(stats)); },
        get level() { return { id: L.id, v: L.v, gap: L.gap, time: L.time, like: L.like, hate: L.hate }; },
        // 食べ物の 大きさ（重なりを たしかめる テスト用）
        get foodS() { return FOOD_S; },
        get vMul() { return +vMul.toFixed(3); },
        // 口のじょうたい（テスト用）
        get mouth() {
          return { held: mouthHeld(), open: mouthIsOpen(), amt: +openAmt.toFixed(3) };
        },
        // 押しはじめ／はなす（キーボードと おなじ道すじを とおる）
        down: function () { if (!mouthHeld()) pressDown(); holdKey = true; },
        up: function () { holdKey = false; },
        // 1回 ちょこんと おす（押して すぐ はなす）
        press: function () { if (!mouthHeld()) pressDown(); },
        setHold: function (v) { hold = !!v; },
        // 絵を 撮って 目で 見るための 表示（テスト用）
        setSheet: function (v) { sheet = v | 0; },
        setPlayT: function (v) { playT = v; },
        beginPlay: function () { mode = 'play'; cd = COUNT_TIME; },
        // そのまま 終わらせる
        endNow: function () { end(); },
        levels: function () { return LEVEL_IDS.map(function (k) { return LEVELS[k]; }); },
      },
    };
    return inst;
  }
})();
