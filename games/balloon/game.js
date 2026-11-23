/* =========================================================
   ふわふわ！風船バレー（balloon） — 1対1の たいせん
   - 左右に うごいて ジャンプ。ふれると 風船を はね返す
   - 風船を 自分のコートに 落としたら 相手に 1点。5点先取
   - ノーマル／スペシャル（風船の しゅるい＋ギミックが かわる）
   - CPU：やさしい／ふつう／プロ
   操作：1P＝A / D うごく、W ジャンプ　2P＝← / → うごく、↑ ジャンプ
   ========================================================= */
(function () {
  'use strict';
  const A = window.Arcade;
  const W = A.W, H = A.H;
  const TAU = Math.PI * 2;

  /* ---------- コート ---------- */
  const GROUND = 942;        // 地面の高さ（ここに ついたら 失点）
  const CEIL = 108;          // 天じょう
  const WALL_L = 64, WALL_R = W - 64;
  const NET_X = W / 2, NET_HW = 16, NET_TOP = 596;

  /* ---------- プレイヤー ---------- */
  const PR = 88;             // はんけい（遠くからでも 見えるように 大きめ）
  const RUN = 760;           // 横の速さ(px/秒)
  const ACC = 5200;          // うごきだし・止まりの きびきび
  const JUMP_V = -1110;      // ジャンプの はつ速度
  const PGRAV = 2700;

  /* ---------- 風船 ---------- */
  // ふわっと 落ちるが、落ちるのが おそすぎると 1点に 30秒 かかるので すこし 重くした
  const BGRAV = 520;
  const BFALL_MAX = 640;
  const BDRAG = 0.10;        // 横の 空気ていこう
  const HIT_SPEED = 790;     // はね返る 速さ
  const HIT_COOL = 0.17;     // 同じ人が 続けて当てないための まち時間
  const MIN_UP = 0.30;       // かならず 上むきに とばす（0.30＝だいたい17度より上）
  const VX_MAX = 780;
  const OVER_PUSH = 170;     // 当てると すこし 相手がわへ おし出される（行ったり来たり 防止）
  /* ---------- しぼみ（ラリーが 長びかない ための しかけ） ----------
     R6で 作りなおした。前は 20秒から ゆるやかに 重くなるだけで、
     上手な人どうしだと 45秒の 強制終了まで 行くことが 9/20回 あった（実測）。

     しらべて わかったこと：プロCPUの 走る速さ（760×1.10＝836px/秒）は
     風船の よこの 上限 VX_MAX（780px/秒）より 速い。つまり 上手な人は
     理屈のうえでは どこへ 返されても 追いつける。重さを いくら 上げても
     「追いつけない」には ならず、ネットぎわの 低い ピンポンに なるだけだった。

     そこで、しぼみを ほんとうの ルールに した：
       14秒 … しぼみはじめ（重く・小さく・ふらふら。1段階目の 表示）
       20秒 … のこり 10びょうの カウントダウン（2段階目。数字で 秒を 出す）
       30秒 … 空気が なくなって 風船が われる。そのとき 風船が ある がわの 失点
     これで「もうすぐ われる」が うそに ならず、ラリーは かならず 30秒で 決まる。

     ※ さいしょは 20秒で われる ように したが、作者が 実機で 見て
     「20秒は みじかい。30秒で、のこり10秒で われる みたいに して ほしい。
     　勝手に われて 点を 取られるのは 不憫だから、ルールとして 説明して ほしい」
     との こと。そこで 30秒に のばし、のこり10秒は 秒数を 数字で 出す ように した。
     しぼみの「効きかた」は 時間を のばしただけで、われる しゅんかんの
     重さ・小ささ・ふらつきは 前と 同じ ところまで 行く（SHRINK_* は いじっていない）。

     しぼみきった 風船は 立ったままでは ネットを こえない（計算で たしかめた）。
     さいごは ジャンプして 相手がわへ 送らないと 自分の 失点に なる＝ちゃんと むずかしい。
     45秒の RALLY_MAX は 最後の 安全そうち として のこしてある。 */
  const RALLY_SHRINK = 14;   // ここから しぼみはじめる（1段階目）
  const RALLY_WARN = 10;     // のこり これだけに なったら 秒数の カウントダウンを 出す
  const RALLY_BURST = 30;    // 空気が なくなって われる
  const RALLY_HARD = RALLY_BURST - RALLY_WARN;  // ここから 2段階目（＝のこり10びょう）
  const RALLY_MAX = 45;      // 最後の 安全そうち（ふつうは 30秒で われるので ここまで 来ない）
  const SHRINK_ADD = 2.2;    // 重さの ばい率は 1 → 1+これ まで ふえる
  const SHRINK_HIT = 0.20;   // しぼむと はね返りも よわくなる（ジャンプしないと ネットを こえにくい）
  const SHRINK_SIZE = 0.30;  // しぼむと 当たり判定も 小さくなる（絵と そろえる＝あてにくい）
  const SHRINK_WOBBLE = 560; // しぼむと まっすぐ とばない（空気が ぬけて ふらふら する）
  // 当てた「ところ」で とぶ向きが きまる。はしで 当てるほど よこへ、まん中ほど まっすぐ上へ。
  // 0 だと ぜんぶ 真上に とんで つまらないので、はっきり 差が 出る 大きさにする。
  const AIM_SIDE = 0.86;

  const WIN_SCORE = 5;
  const MATCH_TIME = 240;    // 4分で 時間ぎれ（ふつうは 5点先取で 先に終わる）
  const SERVE_WAIT = 1.15;   // サーブ前の ひと呼吸
  const SERVE_WAIT_GIM = 2.5;// ギミックの よこくを 見せる ぶん 長く まつ
  const COUNT_TIME = 3;
  // スペシャルを えらんだときだけ、カウントダウンの 前に 6しゅるいを 見せる画面を 出す。
  // ほうっておいても すすむが、なにか おせば すぐ すすむ。
  const GUIDE_TIME = 7.0;
  const GUIDE_SKIP_AFTER = 0.45;  // 画面が 出た ちょくごの 入力は 読まない（えらんだ ときの 1回を ひろわない）

  const OL = '#4a3a2a';
  const INK = '#2b1a14';

  /* =========================================================
     風船の しゅるい
     g＝重さの ばい率、hit＝はね返りの ばい率、r＝大きさ
     rx/ry＝絵の かたち（たて長・よこ長）、hint＝何が ちがうかの ひとこと
     ========================================================= */
  const BALLOONS = {
    normal: {
      id: 'normal', name: 'ふつう', call: 'ふつうの 風船！', hint: 'ふつうに おちる',
      col: '#ff7fa8', col2: '#e2517f', deep: '#b33160',
      r: 56, g: 1.00, hit: 1.00, w: 30, rx: 0.95, ry: 0.95,
    },
    big: {
      id: 'big', name: 'おおきい', call: 'おおきい 風船！', hint: 'おおきい。うちやすい',
      col: '#7ec8f0', col2: '#3f94c8', deep: '#1f6a97',
      r: 86, g: 0.86, hit: 0.94, w: 18, rx: 0.98, ry: 0.93,
    },
    small: {
      id: 'small', name: 'ちいさい', call: 'ちいさい 風船！', hint: 'ちいさい。あてにくい',
      col: '#ffd43b', col2: '#d9a400', deep: '#a37a00',
      r: 38, g: 1.12, hit: 1.10, w: 16, rx: 0.88, ry: 1.00,
    },
    bouncy: {
      id: 'bouncy', name: 'はずむ', call: 'はずむ 風船！', hint: 'かべや ゆかで はねる',
      col: '#8adf78', col2: '#45a93a', deep: '#2b7a24',
      r: 58, g: 1.05, hit: 1.02, w: 16, rx: 0.96, ry: 0.93,
    },
    floaty: {
      id: 'floaty', name: 'ふわふわ', call: 'ふわふわの 風船！', hint: 'ゆっくり おちる',
      col: '#d2bcf7', col2: '#9168d4', deep: '#6b40a6',
      r: 68, g: 0.58, hit: 0.90, w: 14, rx: 0.94, ry: 0.96,
    },
    bomb: {
      id: 'bomb', name: 'ばくはつ', call: 'ばくはつの 風船！', hint: 'ひが きえると ドンと おちる',
      col: '#ff9a5c', col2: '#d8622a', deep: '#a04318',
      r: 54, g: 1.00, hit: 1.04, w: 12, rx: 0.95, ry: 0.95,
    },
  };
  const BALLOON_IDS = Object.keys(BALLOONS);
  const BOMB_FUSE = 4.2;     // ばくはつ風船が 急に落ちはじめるまで
  const BOMB_GRAV = 3.1;     // 落ちはじめたら この ばい率

  /* =========================================================
     ギミック（スペシャルだけ。やさしいには 出さない）
     かならず サーブ前に よこくを 出す（小さい子も あそぶので 突然は なし）
     ========================================================= */
  const GIM = {
    wind: { id: 'wind', name: 'かぜ', hint: 'よこに ながされる。とちゅうで 向きが かわる', col: '#2a93bd', dur: 9.0 },
    bump: { id: 'bump', name: 'バンパー', hint: 'まるいのに あたると はねる', col: '#c2569f', dur: 10.0 },
    tall: { id: 'tall', name: 'たかいネット', hint: 'ネットが たかくなる', col: '#c79a0a', dur: 9.0 },
    heavy: { id: 'heavy', name: 'おもり', hint: '風船が おもくなって はやく おちる', col: '#7a5bd0', dur: 8.0 },
    lift: { id: 'lift', name: 'ふきあげ', hint: '下のほうで フワッと もちあがる', col: '#2fa36b', dur: 8.0 },
  };
  const GIM_IDS = ['wind', 'bump', 'tall', 'heavy', 'lift'];
  const GIM_CHANCE = 0.55;   // サーブごとに この かくりつで 出る（1点目は 出さない）
  const WIND_ACC = 360;      // かぜの つよさ(px/秒^2)。VX_MAX は こえない
  const WIND_WARN = 1.5;     // かぜの 向きが かわる 「まえ」に かならず これだけ よこくを 出す
  const HEAVY_MUL = 1.75;    // 「おもり」の あいだの 重さの ばい率
  const LIFT_ACC = 980;      // 「ふきあげ」の つよさ。落ちる のを ゆるめるだけ（上には おし上げない）
  const LIFT_Y = 620;        // これより 下に きたときだけ はたらく
  const NET_RISE = 132;      // ネットが たかくなる ぶん
  const BUMPS = [
    { x: NET_X - 404, y: 486, r: 58 },
    { x: NET_X + 404, y: 486, r: 58 },
  ];

  /* ---------- CPU の つよさ ---------- */
  // speed＝動く速さ、react＝考え直す間かく(秒)、err＝ねらいの ずれ(px)、
  // jump＝ジャンプする気やすさ、aim＝すみを ねらう強さ、read＝落ちどころの 読みの正しさ
  const CPU = {
    1: { name: 'やさしい', speed: 0.58, react: 0.40, err: 180, jump: 0.35, aim: 0.20, read: 0.56 },
    2: { name: 'ふつう',   speed: 0.76, react: 0.26, err: 110, jump: 0.62, aim: 0.60, read: 0.80 },
    3: { name: 'プロ',     speed: 1.10, react: 0.06, err: 20,  jump: 0.95, aim: 1.00, read: 1.00 },
  };

  /* =========================================================
     絵の どうぐ（すべてコードで描く）
     ========================================================= */
  function ell(g, x, y, rx, ry, rot) { g.beginPath(); g.ellipse(x, y, rx, ry, rot || 0, 0, TAU); }
  function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, TAU); }
  function starPath(g, x, y, r1, r2, n, rot) {
    g.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = (rot || 0) + i * Math.PI / n, rr = (i % 2) ? r2 : r1;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
  }
  function star4(g, x, y, r) { starPath(g, x, y, r, r * 0.3, 4, -Math.PI / 2); }
  function arrow(g, x, y, ax, ay, wid) {
    // (x,y) から (ax,ay) へ むかう ふとい矢印
    const a = Math.atan2(ay - y, ax - x), L = Math.hypot(ax - x, ay - y);
    g.save(); g.translate(x, y); g.rotate(a);
    g.lineWidth = wid; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(0, 0); g.lineTo(L - wid, 0); g.stroke();
    g.beginPath();
    g.moveTo(L, 0); g.lineTo(L - wid * 1.7, -wid * 1.15); g.lineTo(L - wid * 1.7, wid * 1.15);
    g.closePath(); g.fill();
    g.restore();
  }

  /* ---------- 背景（うごかない ぶんは 1まいの 絵に して おく） ---------- */
  function drawCloud(g, x, y, s) {
    g.save(); g.translate(x, y); g.scale(s, s);
    const puff = [[-98, 10, 54, 32], [-36, -18, 72, 46], [40, 2, 58, 36], [98, 18, 40, 26]];
    g.fillStyle = 'rgba(255,255,255,0.80)';
    g.beginPath();
    puff.forEach(function (p) { g.moveTo(p[0] + p[2], p[1]); g.ellipse(p[0], p[1], p[2], p[3], 0, 0, TAU); });
    g.fill();
    g.fillStyle = 'rgba(186,206,222,0.40)';   // 下の かげ
    ell(g, -16, 30, 110, 15); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.92)';   // 上の ツヤ
    ell(g, -48, -34, 38, 12, -0.22); g.fill();
    g.restore();
  }

  function drawTree(g, x, baseY, s) {
    g.save(); g.translate(x, baseY); g.scale(s, s);
    g.lineJoin = 'round';
    // みき
    const tg = g.createLinearGradient(-14, 0, 14, 0);
    tg.addColorStop(0, '#b79472'); tg.addColorStop(0.5, '#9c7652'); tg.addColorStop(1, '#7d5a3c');
    g.fillStyle = tg;
    g.beginPath();
    g.moveTo(-13, 0); g.quadraticCurveTo(-8, -46, -10, -86);
    g.lineTo(10, -86); g.quadraticCurveTo(8, -46, 13, 0);
    g.closePath(); g.fill();
    g.lineWidth = 4; g.strokeStyle = 'rgba(92,66,44,0.55)'; g.stroke();
    // は（3つの かたまり。彩度は おさえる）
    const blobs = [[-34, -104, 44], [30, -112, 40], [-2, -142, 50]];
    blobs.forEach(function (b, i) {
      const lg = g.createRadialGradient(b[0] - b[2] * 0.4, b[1] - b[2] * 0.45, b[2] * 0.15, b[0], b[1], b[2] * 1.15);
      lg.addColorStop(0, '#cfe3b4'); lg.addColorStop(0.5, '#a8cb8a'); lg.addColorStop(1, '#7fab66');
      g.fillStyle = lg;
      circ(g, b[0], b[1], b[2]); g.fill();
      g.lineWidth = 4.5; g.strokeStyle = 'rgba(86,112,66,0.55)'; g.stroke();
      if (i === 2) { g.fillStyle = 'rgba(255,255,255,0.35)'; ell(g, b[0] - 18, b[1] - 24, 16, 8, -0.6); g.fill(); }
    });
    g.restore();
  }

  // 小さな どうぶつの あたま（がめんの 下から のぞく おきゃくさん）
  function drawFanHead(g, x, y, r, c1, c2, ear, cheer) {
    g.save(); g.translate(x, y - cheer * 10);
    g.lineJoin = 'round';
    g.fillStyle = c1;
    if (ear === 0) { circ(g, -r * 0.7, -r * 0.66, r * 0.33); g.fill(); circ(g, r * 0.7, -r * 0.66, r * 0.33); g.fill(); }
    else if (ear === 1) {
      g.beginPath();
      g.moveTo(-r * 0.92, -r * 0.26); g.lineTo(-r * 0.68, -r * 1.22); g.lineTo(-r * 0.16, -r * 0.82);
      g.moveTo(r * 0.92, -r * 0.26); g.lineTo(r * 0.68, -r * 1.22); g.lineTo(r * 0.16, -r * 0.82);
      g.fill();
    } else {
      ell(g, -r * 0.36, -r * 1.12, r * 0.19, r * 0.48, -0.16); g.fill();
      ell(g, r * 0.36, -r * 1.12, r * 0.19, r * 0.48, 0.16); g.fill();
    }
    const hg = g.createRadialGradient(-r * 0.4, -r * 0.45, r * 0.1, 0, 0, r * 1.2);
    hg.addColorStop(0, '#ffffff'); hg.addColorStop(0.4, c1); hg.addColorStop(1, c2);
    g.fillStyle = hg; circ(g, 0, 0, r); g.fill();
    g.lineWidth = 4; g.strokeStyle = 'rgba(96,74,56,0.5)'; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.6)'; ell(g, -r * 0.36, -r * 0.44, r * 0.26, r * 0.13, -0.6); g.fill();
    g.fillStyle = 'rgba(240,120,150,0.4)';
    ell(g, -r * 0.52, r * 0.2, r * 0.17, r * 0.1); g.fill();
    ell(g, r * 0.52, r * 0.2, r * 0.17, r * 0.1); g.fill();
    g.fillStyle = INK;
    if (cheer > 0.5) {
      g.strokeStyle = INK; g.lineWidth = r * 0.1;
      g.beginPath(); g.arc(-r * 0.33, 0, r * 0.16, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      g.beginPath(); g.arc(r * 0.33, 0, r * 0.16, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    } else {
      ell(g, -r * 0.33, -r * 0.02, r * 0.1, r * 0.13); g.fill();
      ell(g, r * 0.33, -r * 0.02, r * 0.1, r * 0.13); g.fill();
      g.fillStyle = '#fff';
      circ(g, -r * 0.37, -r * 0.08, r * 0.04); g.fill();
      circ(g, r * 0.29, -r * 0.08, r * 0.04); g.fill();
    }
    g.restore();
  }

  function drawCourtStatic(g) {
    const r = A.rng(20261115);
    g.lineJoin = 'round'; g.lineCap = 'round';

    /* ---- 空（彩度を おとす。風船が いちばん 目立つように） ---- */
    const sky = g.createLinearGradient(0, 0, 0, GROUND);
    sky.addColorStop(0, '#b9d6e6');
    sky.addColorStop(0.42, '#d7e7ee');
    sky.addColorStop(0.78, '#e9f0e8');
    sky.addColorStop(1, '#eef0df');
    g.fillStyle = sky; g.fillRect(0, 0, W, GROUND);
    // おひさまの ひかり（左上から。ゲーム内の 光源は 全部 左上）
    let rg = g.createRadialGradient(290, 30, 20, 290, 30, 620);
    rg.addColorStop(0, 'rgba(255,250,226,0.60)');
    rg.addColorStop(1, 'rgba(255,250,226,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 940, 680);

    /* ---- 雲 ---- */
    [[250, 160, 1.3], [660, 92, 0.86], [1150, 182, 1.05], [1575, 112, 1.2], [1830, 250, 0.72], [950, 262, 0.6]]
      .forEach(function (c) { drawCloud(g, c[0], c[1], c[2]); });

    /* ---- とおくの 丘（2まい。うすく） ---- */
    function hill(y0, amp, col) {
      g.fillStyle = col;
      g.beginPath(); g.moveTo(-60, GROUND);
      for (let x = -60; x <= W + 60; x += 36) {
        g.lineTo(x, y0 - Math.sin(x * 0.0021) * amp - Math.sin(x * 0.00072 + 1.4) * amp * 0.7);
      }
      g.lineTo(W + 60, GROUND); g.closePath(); g.fill();
    }
    hill(GROUND - 196, 46, '#c3d2bd');
    hill(GROUND - 132, 32, '#aec49f');

    /* ---- 木（コートの うしろ。彩度は おさえめ） ---- */
    for (let i = 0; i < 9; i++) {
      drawTree(g, 100 + i * 218 + (r() - 0.5) * 50, GROUND - 92 + (r() - 0.5) * 16, 0.82 + r() * 0.3);
    }

    /* ---- かざりの 三角はた（コートの いちばん うしろ、木の ねもとに 低く） ----
       ※ 空には 置かない。風船が 見えにくく なるのを さける */
    const FL = ['#e9b2c0', '#e7cc99', '#a9c8db', '#b5cfa6', '#cbbbe0'];
    const flagY = GROUND - 120;
    g.strokeStyle = 'rgba(120,100,80,0.3)'; g.lineWidth = 3.5;
    g.beginPath();
    for (let x = WALL_L; x <= WALL_R; x += 10) {
      g.lineTo(x, flagY + Math.sin((x - WALL_L) / (WALL_R - WALL_L) * Math.PI * 7) * 9);
    }
    g.stroke();
    for (let i = 0; i < 24; i++) {
      const x = WALL_L + 40 + i * 74;
      const y = flagY + Math.sin((x - WALL_L) / (WALL_R - WALL_L) * Math.PI * 7) * 9;
      g.beginPath(); g.moveTo(x - 15, y); g.lineTo(x + 15, y); g.lineTo(x, y + 32); g.closePath();
      g.fillStyle = FL[i % FL.length]; g.fill();
      g.lineWidth = 3; g.strokeStyle = 'rgba(120,100,80,0.3)'; g.stroke();
    }

    /* ---- 地面（すなのコート） ---- */
    const gr = g.createLinearGradient(0, GROUND, 0, H);
    gr.addColorStop(0, '#efdcae');
    gr.addColorStop(0.45, '#e3c88e');
    gr.addColorStop(1, '#cfae6d');
    g.fillStyle = gr; g.fillRect(0, GROUND, W, H - GROUND);
    // 地面の きわの かげ
    const sg = g.createLinearGradient(0, GROUND, 0, GROUND + 34);
    sg.addColorStop(0, 'rgba(120,92,48,0.35)'); sg.addColorStop(1, 'rgba(120,92,48,0)');
    g.fillStyle = sg; g.fillRect(0, GROUND, W, 34);
    g.strokeStyle = '#b08f4c'; g.lineWidth = 7;
    g.beginPath(); g.moveTo(0, GROUND); g.lineTo(W, GROUND); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, GROUND + 5); g.lineTo(W, GROUND + 5); g.stroke();
    // すなの つぶ
    g.fillStyle = 'rgba(150,118,62,0.20)';
    g.beginPath();
    for (let i = 0; i < 300; i++) {
      const x = r() * W, y = GROUND + 10 + r() * (H - GROUND - 10), rr = 1.6 + r() * 2.6;
      g.moveTo(x + rr, y); g.arc(x, y, rr, 0, TAU);
    }
    g.fill();

    /* ---- 横のかべ（すりガラス） ---- */
    [[0, WALL_L], [WALL_R, W - WALL_R]].forEach(function (p) {
      const wg = g.createLinearGradient(p[0], 0, p[0] + p[1], 0);
      wg.addColorStop(0, 'rgba(255,255,255,0.52)');
      wg.addColorStop(0.6, 'rgba(226,240,248,0.34)');
      wg.addColorStop(1, 'rgba(255,255,255,0.5)');
      g.fillStyle = wg; g.fillRect(p[0], CEIL, p[1], GROUND - CEIL);
      // ななめの ツヤ
      g.save();
      g.beginPath(); g.rect(p[0], CEIL, p[1], GROUND - CEIL); g.clip();
      g.fillStyle = 'rgba(255,255,255,0.4)';
      for (let k = 0; k < 7; k++) {
        const y = CEIL + k * 130;
        g.beginPath();
        g.moveTo(p[0] - 20, y + 90); g.lineTo(p[0] + p[1] + 20, y - 40);
        g.lineTo(p[0] + p[1] + 20, y - 16); g.lineTo(p[0] - 20, y + 114); g.closePath(); g.fill();
      }
      g.restore();
    });
    g.strokeStyle = 'rgba(108,150,180,0.55)'; g.lineWidth = 6;
    g.beginPath();
    g.moveTo(WALL_L, CEIL); g.lineTo(WALL_L, GROUND);
    g.moveTo(WALL_R, CEIL); g.lineTo(WALL_R, GROUND);
    g.stroke();
    // 天じょうの おび
    const cg2 = g.createLinearGradient(0, CEIL - 22, 0, CEIL + 10);
    cg2.addColorStop(0, '#f6efe0'); cg2.addColorStop(1, '#ddd0b8');
    g.fillStyle = cg2; g.fillRect(0, CEIL - 22, W, 26);
    g.strokeStyle = 'rgba(108,150,180,0.5)'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, CEIL); g.lineTo(W, CEIL); g.stroke();
    g.setLineDash([22, 16]);
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, CEIL - 10); g.lineTo(W, CEIL - 10); g.stroke();
    g.setLineDash([]);

    /* ---- おきゃくさん（がめんの 下から のぞく。じゃまに ならない ばしょ） ---- */
    const FC = [['#ffdca0', '#eeb96a'], ['#cfeab4', '#98cf80'], ['#ffcada', '#f09cb6'],
    ['#c3ddf2', '#8db8dd'], ['#ded0f2', '#b49ddf'], ['#ffd8b8', '#f0ad80']];
    g.save();
    g.globalAlpha = 0.9;
    for (let i = 0; i < 21; i++) {
      const x = 44 + i * 92 + (r() - 0.5) * 18;
      const c = FC[Math.floor(r() * FC.length)];
      drawFanHead(g, x, H + 2 + (r() - 0.5) * 8, 32 + r() * 7, c[0], c[1], Math.floor(r() * 3), r() < 0.45 ? 1 : 0);
    }
    g.restore();
    // 木の てすり（おきゃくさんの 前）
    const rl = g.createLinearGradient(0, H - 24, 0, H);
    rl.addColorStop(0, '#d8b183'); rl.addColorStop(1, '#ad8255');
    g.fillStyle = rl; g.fillRect(0, H - 24, W, 24);
    g.strokeStyle = 'rgba(120,88,54,0.6)'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, H - 24); g.lineTo(W, H - 24); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, H - 21, W, 5);
  }

  const courtCaches = {};
  function drawCourt(g) {
    let s = 1;
    try { const m = g.getTransform(); s = Math.hypot(m.a, m.b); } catch (e) { s = 1; }
    s = Math.max(0.5, Math.min(2, Math.round(s * 4) / 4));
    const key = String(s);
    if (!courtCaches[key]) {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(W * s)); c.height = Math.max(1, Math.round(H * s));
      const cg = c.getContext('2d');
      cg.setTransform(s, 0, 0, s, 0, 0);
      drawCourtStatic(cg);
      courtCaches[key] = c;
    }
    g.drawImage(courtCaches[key], 0, 0, W, H);
  }

  /* ---------- ネット（たかさが かわるので 毎回 描く） ---------- */
  function drawNet(g, topY, t) {
    const x0 = NET_X - NET_HW, x1 = NET_X + NET_HW;
    g.save();
    g.lineJoin = 'round'; g.lineCap = 'round';
    // 地面の かげ
    g.fillStyle = 'rgba(0,0,0,0.16)';
    ell(g, NET_X, GROUND + 9, 56, 15); g.fill();
    // どだい（すなぶくろ）
    const base = g.createLinearGradient(0, GROUND - 46, 0, GROUND + 4);
    base.addColorStop(0, '#d7c096'); base.addColorStop(1, '#a98a5c');
    A.roundRect(g, NET_X - 44, GROUND - 46, 88, 50, 16);
    g.fillStyle = base; g.fill();
    g.lineWidth = 6; g.strokeStyle = OL; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.4)'; ell(g, NET_X - 18, GROUND - 34, 16, 7, -0.3); g.fill();

    /* ---- あみの パネル ---- */
    A.roundRect(g, x0, topY, NET_HW * 2, GROUND - topY - 24, 6);
    g.fillStyle = 'rgba(248,252,255,0.42)'; g.fill();
    g.save();
    A.roundRect(g, x0, topY, NET_HW * 2, GROUND - topY - 24, 6);
    g.clip();
    // よこ糸・たて糸（四角い あみ目）
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 4;
    g.beginPath();
    for (let y = topY + 8; y < GROUND; y += 16) { g.moveTo(x0 - 2, y); g.lineTo(x1 + 2, y); }
    for (let x = x0 + 5; x < x1; x += 11) { g.moveTo(x, topY - 2); g.lineTo(x, GROUND); }
    g.stroke();
    g.strokeStyle = 'rgba(96,120,140,0.5)'; g.lineWidth = 1.6;
    g.beginPath();
    for (let y = topY + 8; y < GROUND; y += 16) { g.moveTo(x0 - 2, y + 2); g.lineTo(x1 + 2, y + 2); }
    g.stroke();
    g.restore();
    // あみの わく（左右の ふとい ロープ）
    g.lineWidth = 6; g.strokeStyle = OL;
    g.beginPath();
    g.moveTo(x0, topY); g.lineTo(x0, GROUND - 24);
    g.moveTo(x1, topY); g.lineTo(x1, GROUND - 24);
    g.stroke();

    /* ---- てっぺんの 白い テープ ---- */
    A.roundRect(g, NET_X - 30, topY - 20, 60, 30, 13);
    const tg = g.createLinearGradient(0, topY - 20, 0, topY + 10);
    tg.addColorStop(0, '#ffffff'); tg.addColorStop(0.55, '#f2f6fa'); tg.addColorStop(1, '#ccd7e0');
    g.fillStyle = tg; g.fill();
    g.lineWidth = 6; g.strokeStyle = OL; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.95)'; ell(g, NET_X - 11, topY - 11, 11, 4.5, -0.3); g.fill();
    // テープの ぬいめ
    g.strokeStyle = 'rgba(120,140,160,0.6)'; g.lineWidth = 2.5;
    g.setLineDash([4, 5]);
    g.beginPath(); g.moveTo(NET_X - 22, topY - 2); g.lineTo(NET_X + 22, topY - 2); g.stroke();
    g.setLineDash([]);

    /* ---- てっぺんの はた（かぜで ゆれる） ---- */
    const fw = Math.sin(t * 3.2) * 0.2;
    g.save(); g.translate(NET_X, topY - 22); g.rotate(fw * 0.35);
    g.strokeStyle = OL; g.lineWidth = 6;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -52); g.stroke();
    g.beginPath();
    g.moveTo(0, -52); g.quadraticCurveTo(26, -45 + fw * 9, 42, -35);
    g.quadraticCurveTo(24, -28 + fw * 7, 0, -26); g.closePath();
    const flg = g.createLinearGradient(0, -52, 42, -26);
    flg.addColorStop(0, '#ffc2d4'); flg.addColorStop(1, '#f07ba3');
    g.fillStyle = flg; g.fill();
    g.lineWidth = 5; g.stroke();
    circ(g, 0, -56, 6); g.fillStyle = '#ffd94d'; g.fill(); g.lineWidth = 4; g.stroke();
    g.restore();
    g.restore();
  }

  /* =========================================================
     キャラクター（ねこ・うさぎ）
     mood: 'idle' | 'run' | 'air' | 'hit' | 'happy' | 'sad'
     ========================================================= */
  function drawChar(g, x, y, kind, face, t, squash, mood) {
    const cat = kind === 'cat';
    const R = 74;                       // 絵の中の はんけい（PR に 合わせて 拡大する）
    mood = mood || 'idle';
    const dir = face || 1;
    const run = mood === 'run', air = mood === 'air', hit = mood === 'hit';
    const joy = mood === 'happy', sad = mood === 'sad';
    const blink = !sad && !joy && !hit && Math.sin(t * 1.7 + (cat ? 0 : 2.1)) > 0.972;

    const body1 = cat ? '#ffd9ae' : '#ffffff';
    const body2 = cat ? '#f6a460' : '#f1ece0';
    const body3 = cat ? '#dd7e34' : '#cdc3ae';
    const belly = cat ? '#ffeedb' : '#ffffff';
    const earIn = '#f6b2c6';

    g.save();
    g.translate(x, y);
    const sq = 1 + (squash || 0);
    g.scale(1 / sq, sq);
    g.scale(PR / R, PR / R);
    const bob = joy ? -Math.abs(Math.sin(t * 9)) * 10 : Math.sin(t * 2.6) * 2;
    g.translate(0, bob);
    const lean = run ? dir * 0.11 : (hit ? -dir * 0.09 : (sad ? -dir * 0.05 : Math.sin(t * 1.3) * 0.015));
    g.rotate(lean);
    g.lineJoin = 'round'; g.lineCap = 'round';

    /* ---- しっぽ（からだの うしろ） ---- */
    if (cat) {
      const sw = Math.sin(t * (run ? 11 : 3.4)) * (run ? 0.42 : 0.2);
      g.save(); g.translate(-dir * R * 0.76, R * 0.4);
      g.strokeStyle = OL; g.lineWidth = 17; g.lineCap = 'round';
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(-dir * 42, 10 + sw * 20, -dir * 54, -32 + sw * 26);
      g.stroke();
      g.strokeStyle = body2; g.lineWidth = 11; g.stroke();
      g.strokeStyle = body1; g.lineWidth = 11;
      g.beginPath();
      g.moveTo(-dir * 46, -16 + sw * 22); g.quadraticCurveTo(-dir * 53, -24 + sw * 24, -dir * 54, -32 + sw * 26);
      g.stroke();
      g.restore();
    } else {
      g.save(); g.translate(-dir * R * 0.78, R * 0.46);
      const pg = g.createRadialGradient(-6, -8, 3, 0, 0, 26);
      pg.addColorStop(0, '#ffffff'); pg.addColorStop(1, '#e2dbcb');
      circ(g, 0, 0, 24); g.fillStyle = pg; g.fill();
      g.lineWidth = 6; g.strokeStyle = OL; g.stroke();
      g.restore();
    }

    /* ---- 耳 ---- */
    g.lineWidth = 7; g.strokeStyle = OL;
    if (cat) {
      [[-40, -54, -1], [40, -54, 1]].forEach(function (p) {
        const tip = air ? -14 : (hit ? -6 : 0);
        g.beginPath();
        g.moveTo(p[0] - 26, p[1] + 16);
        g.lineTo(p[0] + p[2] * 14, p[1] - 44 + tip);
        g.lineTo(p[0] + 26, p[1] + 16);
        g.closePath();
        const eg = g.createLinearGradient(p[0] - 20, p[1] - 40, p[0] + 20, p[1] + 16);
        eg.addColorStop(0, body1); eg.addColorStop(1, body3);
        g.fillStyle = eg; g.fill(); g.stroke();
        g.beginPath();
        g.moveTo(p[0] - 12, p[1] + 10); g.lineTo(p[0] + p[2] * 7, p[1] - 22 + tip); g.lineTo(p[0] + 12, p[1] + 10);
        g.closePath();
        g.fillStyle = earIn; g.fill();
      });
    } else {
      [[-30, -0.26], [30, 0.26]].forEach(function (p) {
        g.save();
        g.translate(p[0], -56);
        g.rotate(p[1] + (air ? -p[1] * 0.7 : 0) + Math.sin(t * 2.2 + p[0]) * 0.05);
        ell(g, 0, -48, 21, 56);
        const eg = g.createLinearGradient(-18, -96, 18, 0);
        eg.addColorStop(0, body1); eg.addColorStop(1, body3);
        g.fillStyle = eg; g.fill(); g.lineWidth = 7; g.stroke();
        ell(g, 0, -46, 10, 40); g.fillStyle = earIn; g.fill();
        g.fillStyle = 'rgba(255,255,255,0.55)'; ell(g, -8, -74, 5, 16, 0.1); g.fill();
        g.restore();
      });
    }

    /* ---- うしろの うで（ばんざい／ジャンプ） ---- */
    function paw(px, py, rot, behind) {
      g.save(); g.translate(px, py); g.rotate(rot);
      ell(g, 0, 0, 23, 18);
      const hg = g.createRadialGradient(-8, -8, 3, 0, 0, 24);
      hg.addColorStop(0, body1); hg.addColorStop(1, body3);
      g.fillStyle = hg; g.fill();
      g.lineWidth = 6.5; g.strokeStyle = OL; g.stroke();
      if (!behind) {
        g.fillStyle = 'rgba(246,178,198,0.75)';
        ell(g, 2, 3, 9, 6); g.fill();
      }
      g.restore();
    }
    if (air || joy) { paw(-62, -34, -0.9, true); paw(62, -34, 0.9, true); }

    /* ---- からだ ---- */
    circ(g, 0, 0, R);
    const bg = g.createRadialGradient(-R * 0.36, -R * 0.42, R * 0.12, 0, 0, R * 1.16);
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(0.22, body1);
    bg.addColorStop(0.62, body2);
    bg.addColorStop(1, body3);
    g.fillStyle = bg; g.fill();
    g.lineWidth = 7; g.strokeStyle = OL; g.stroke();

    /* ---- おなか ---- */
    ell(g, dir * 3, 24, 42, 36);
    const yg = g.createLinearGradient(0, -12, 0, 60);
    yg.addColorStop(0, '#ffffff'); yg.addColorStop(1, belly);
    g.fillStyle = yg; g.fill();
    g.lineWidth = 3.5; g.strokeStyle = 'rgba(74,58,42,0.22)'; g.stroke();
    // もようの 毛束（ねこ）
    if (cat) {
      g.strokeStyle = 'rgba(221,126,52,0.75)'; g.lineWidth = 5;
      g.beginPath();
      g.moveTo(-54, -34); g.quadraticCurveTo(-40, -44, -24, -40);
      g.moveTo(-58, -16); g.quadraticCurveTo(-44, -26, -28, -22);
      g.stroke();
    }

    /* ---- ツヤ（ななめの 白い楕円） ---- */
    g.fillStyle = 'rgba(255,255,255,0.58)';
    ell(g, -R * 0.42, -R * 0.52, 23, 11, -0.72); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.45)';
    ell(g, -R * 0.2, -R * 0.66, 8, 5, -0.5); g.fill();

    /* ---- ほっぺ ---- */
    g.fillStyle = 'rgba(255,110,150,0.45)';
    ell(g, -46, 10, 17, 11); g.fill();
    ell(g, 46, 10, 17, 11); g.fill();

    /* ---- 目 ---- */
    const ex = 24, ey = -16, lx = dir * 5;
    g.strokeStyle = INK;
    if (sad) {
      g.lineWidth = 5.5;
      [-1, 1].forEach(function (sd) {
        g.beginPath();
        g.arc(sd * ex + lx, ey - 5, 11, Math.PI * 0.22, Math.PI * 0.78); g.stroke();
      });
    } else if (joy) {
      g.lineWidth = 6;
      [-1, 1].forEach(function (sd) {
        g.beginPath();
        g.arc(sd * ex + lx, ey + 5, 12, Math.PI * 1.12, Math.PI * 1.88); g.stroke();
      });
    } else if (blink) {
      g.lineWidth = 5.5;
      [-1, 1].forEach(function (sd) {
        g.beginPath();
        g.moveTo(sd * ex + lx - 11, ey); g.quadraticCurveTo(sd * ex + lx, ey + 8, sd * ex + lx + 11, ey); g.stroke();
      });
    } else {
      const wide = air || hit;
      [-1, 1].forEach(function (sd) {
        const px = sd * ex + lx;
        g.fillStyle = '#ffffff';
        ell(g, px, ey, wide ? 13 : 11.5, wide ? 16 : 14.5); g.fill();
        g.lineWidth = 2.5; g.strokeStyle = 'rgba(43,26,20,0.3)'; g.stroke();
        g.fillStyle = INK;
        ell(g, px + dir * 1.5, ey + (hit ? -1 : 1), wide ? 8 : 7.5, wide ? 11 : 10); g.fill();
        // ハイライト 2点（大きい光＋反対がわの 小さい光）
        g.fillStyle = '#ffffff';
        ell(g, px + dir * 1.5 - 3, ey - 4, 4.2, 4.8); g.fill();
        circ(g, px + dir * 1.5 + 3.4, ey + 5, 2.1); g.fill();
      });
      if (hit) {
        // きりっと した まゆ
        g.strokeStyle = INK; g.lineWidth = 5;
        g.beginPath();
        g.moveTo(-ex - 13, ey - 27); g.lineTo(-ex + 9, ey - 19);
        g.moveTo(ex + 13, ey - 27); g.lineTo(ex - 9, ey - 19);
        g.stroke();
      }
    }

    /* ---- はな・くち ---- */
    ell(g, lx, 6, 10, 7.5);
    const ng = g.createRadialGradient(lx - 3, 3, 1.5, lx, 6, 11);
    ng.addColorStop(0, '#ffb3cb'); ng.addColorStop(1, '#e5768f');
    g.fillStyle = ng; g.fill();
    g.lineWidth = 3; g.strokeStyle = '#c23e6a'; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.85)'; ell(g, lx - 3, 3, 3.4, 2, -0.3); g.fill();

    g.strokeStyle = '#8a5a3a'; g.lineWidth = 5;
    if (hit || air) {
      ell(g, lx, 26, 13, air ? 15 : 11);
      g.fillStyle = '#b8465c'; g.fill(); g.lineWidth = 4; g.strokeStyle = OL; g.stroke();
      g.fillStyle = '#ff9db0'; ell(g, lx, 31, 7, 4); g.fill();
    } else if (joy) {
      g.beginPath();
      g.moveTo(lx - 17, 17); g.quadraticCurveTo(lx, 44, lx + 17, 17); g.closePath();
      g.fillStyle = '#b8465c'; g.fill(); g.lineWidth = 4; g.strokeStyle = OL; g.stroke();
      g.fillStyle = '#ff9db0'; ell(g, lx, 30, 7, 4); g.fill();
    } else if (sad) {
      g.beginPath(); g.arc(lx, 32, 11, Math.PI * 1.18, Math.PI * 1.82); g.stroke();
    } else {
      g.beginPath();
      g.moveTo(lx - 14, 20); g.quadraticCurveTo(lx - 7, 29, lx, 20);
      g.quadraticCurveTo(lx + 7, 29, lx + 14, 20);
      g.stroke();
    }
    // ひげ（ねこ）
    if (cat) {
      g.strokeStyle = 'rgba(74,58,42,0.55)'; g.lineWidth = 3.5;
      g.beginPath();
      g.moveTo(lx - 16, 2); g.lineTo(lx - 50, -8);
      g.moveTo(lx - 16, 10); g.lineTo(lx - 50, 12);
      g.moveTo(lx + 16, 2); g.lineTo(lx + 50, -8);
      g.moveTo(lx + 16, 10); g.lineTo(lx + 50, 12);
      g.stroke();
    }

    /* ---- 前の うで・あし ---- */
    if (!air && !joy) {
      if (hit) { paw(-dir * 74, 6, -dir * 0.75); paw(dir * 74, 6, dir * 0.75); }
      else if (run) {
        const sw = Math.sin(t * 13);
        paw(-dir * 62, 26 + sw * 10, -dir * (0.3 + sw * 0.3));
        paw(dir * 62, 26 - sw * 10, dir * (0.3 - sw * 0.3));
      } else {
        paw(-66, 28, -0.42); paw(66, 28, 0.42);
      }
      // あし
      [-1, 1].forEach(function (sd) {
        const fx = sd * 30 + dir * 4, fy = R - 6 + (run ? Math.sin(t * 13 + sd) * 7 : 0);
        ell(g, fx, fy, 22, 14, sd * 0.1);
        const fg = g.createLinearGradient(fx, fy - 12, fx, fy + 12);
        fg.addColorStop(0, body1); fg.addColorStop(1, body3);
        g.fillStyle = fg; g.fill();
        g.lineWidth = 6; g.strokeStyle = OL; g.stroke();
        g.fillStyle = 'rgba(246,178,198,0.7)'; ell(g, fx, fy + 2, 9, 5); g.fill();
      });
    } else if (air) {
      // あしは たたむ
      [-1, 1].forEach(function (sd) { paw(sd * 34, R - 2, sd * 0.3, true); });
    }

    /* ---- 小さな かざり ---- */
    if (joy) {
      g.fillStyle = '#ffd94d';
      for (let i = 0; i < 3; i++) {
        const a = t * 2.4 + i * TAU / 3;
        const sr = 10 + Math.sin(t * 9 + i) * 3.5;
        star4(g, Math.cos(a) * 72, -96 + Math.sin(a) * 26, sr); g.fill();
        g.lineWidth = 3; g.strokeStyle = '#d68a00'; g.stroke();
      }
    } else if (sad) {
      const ty = -58 + ((t * 36) % 20);
      g.save(); g.translate(-dir * 48, ty);
      g.beginPath();
      g.moveTo(0, -10); g.bezierCurveTo(7, -2, 8, 8, 0, 8); g.bezierCurveTo(-8, 8, -7, -2, 0, -10);
      g.closePath();
      g.fillStyle = '#a9dcff'; g.fill();
      g.lineWidth = 3; g.strokeStyle = '#5aa6e6'; g.stroke();
      g.restore();
    } else if (run) {
      // 走っている けむり
      g.fillStyle = 'rgba(255,255,255,0.5)';
      for (let i = 0; i < 3; i++) {
        const k = ((t * 3 + i * 0.33) % 1);
        ell(g, -dir * (R * 0.9 + k * 46), R - 4 - k * 10, 14 * (1 - k) + 4, 8 * (1 - k) + 3); g.fill();
      }
    }
    g.restore();
  }

  /* =========================================================
     風船
     しゅるいごとに「かたち」と「もよう」を かえて、色だけに たよらない
     ========================================================= */
  function balloonPath(g, rx, ry) {
    g.beginPath();
    g.moveTo(0, -ry);
    g.bezierCurveTo(rx * 1.1, -ry, rx * 1.12, ry * 0.4, rx * 0.4, ry * 0.88);
    g.quadraticCurveTo(rx * 0.13, ry * 1.02, 0, ry * 1.06);
    g.quadraticCurveTo(-rx * 0.13, ry * 1.02, -rx * 0.4, ry * 0.88);
    g.bezierCurveTo(-rx * 1.12, ry * 0.4, -rx * 1.1, -ry, 0, -ry);
    g.closePath();
  }

  function drawFuseSpark(g, x, y, t) {
    const pulse = 1 + 0.18 * Math.sin(t * 26);
    g.save();
    g.translate(x, y);
    const rg = g.createRadialGradient(0, 0, 2, 0, 0, 30);
    rg.addColorStop(0, 'rgba(255,246,180,0.95)');
    rg.addColorStop(1, 'rgba(255,150,40,0)');
    g.fillStyle = rg; circ(g, 0, 0, 30); g.fill();
    g.rotate(t * 3.4);
    starPath(g, 0, 0, 19 * pulse, 7, 8, 0); g.fillStyle = '#ff8a1f'; g.fill();
    starPath(g, 0, 0, 11 * pulse, 4.5, 8, 0.22); g.fillStyle = '#fff27a'; g.fill();
    circ(g, 0, 0, 3.4); g.fillStyle = '#fff'; g.fill();
    g.restore();
  }

  // opt: { noString: true }（HUD の 小さい アイコンでは ひもを 出さない）
  //      { deflate: 0〜1 }（ラリーが 長びいて しぼんできた ぐあい。1＝もう すぐ われる）
  //      { compact: true }（HUD や しょうかい画面の アイコン。ひもを 出さず、導火線も みじかく する）
  function drawBalloon(g, x, y, type, t, pop, fuse, opt) {
    const b = BALLOONS[type] || BALLOONS.normal;
    const compact = !!(opt && opt.compact);
    const noStr = compact || !!(opt && opt.noString);
    const df = Math.max(0, Math.min(1, (opt && opt.deflate) || 0));
    g.save();
    g.translate(x, y);
    const s = 1 + (pop || 0) * 0.3;
    g.scale(s, 1 / s);
    // しぼむと よこに つぶれて たれてくる（絵でも「重くなった」と わかるように）
    if (df > 0) g.scale(1 - df * 0.10, 1 + df * 0.06);
    const swing = type === 'floaty' ? 0.14 : 0.09;
    // しぼむほど ゆらゆら と たよりなく なる
    g.rotate(Math.sin(t * (type === 'floaty' ? 1.6 : 2.4)) * swing +
      (df > 0 ? Math.sin(t * 7.5) * 0.09 * df : 0));
    g.lineJoin = 'round'; g.lineCap = 'round';
    const rx = b.r * b.rx, ry = b.r * b.ry;

    /* ---- うしろの かざり ---- */
    if (type === 'floaty') {
      // はね（うしろから のぞく）。本体より 大きく しない
      [-1, 1].forEach(function (sd) {
        g.save();
        g.translate(sd * rx * 0.68, -ry * 0.04);
        g.rotate(sd * (0.18 + Math.sin(t * 5.5) * 0.16));
        g.scale(1.12, 1.12);
        g.beginPath();
        g.moveTo(0, -8);
        g.bezierCurveTo(sd * 18, -22, sd * 44, -20, sd * 56, -4);
        // 羽根の ふちは ギザギザ（はねらしく）
        g.quadraticCurveTo(sd * 46, 4, sd * 42, 10);
        g.quadraticCurveTo(sd * 34, 2, sd * 30, 13);
        g.quadraticCurveTo(sd * 22, 6, sd * 17, 16);
        g.quadraticCurveTo(sd * 8, 8, 0, -8);
        g.closePath();
        const wg = g.createLinearGradient(0, -18, sd * 56, 12);
        wg.addColorStop(0, '#ffffff'); wg.addColorStop(1, '#e0d2f8');
        g.fillStyle = wg; g.fill();
        g.lineWidth = 5; g.strokeStyle = OL; g.stroke();
        g.lineWidth = 3; g.strokeStyle = 'rgba(122,88,190,0.45)';
        g.beginPath();
        g.moveTo(sd * 10, -8); g.quadraticCurveTo(sd * 30, -14, sd * 48, -4);
        g.stroke();
        g.restore();
      });
    }

    /* ---- 本体（ゴムの しつかん） ---- */
    balloonPath(g, rx, ry);
    const gr = g.createRadialGradient(-rx * 0.34, -ry * 0.4, rx * 0.08, 0, ry * 0.1, rx * 1.3);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.18, b.col);
    gr.addColorStop(0.68, b.col2);
    gr.addColorStop(1, b.deep);
    g.fillStyle = gr; g.fill();
    g.lineWidth = 6; g.strokeStyle = OL; g.stroke();

    // ゴムの ふちの こい かげ（内がわ）
    g.save();
    balloonPath(g, rx, ry); g.clip();
    const eg = g.createRadialGradient(-rx * 0.1, -ry * 0.12, rx * 0.66, 0, 0, rx * 1.1);
    eg.addColorStop(0, 'rgba(0,0,0,0)');
    eg.addColorStop(1, 'rgba(70,30,50,0.22)');
    g.fillStyle = eg; balloonPath(g, rx, ry); g.fill();
    // 地面からの 照りかえし（下の ふちが すこし 明るい）
    g.fillStyle = 'rgba(255,245,210,0.3)';
    ell(g, 0, ry * 0.72, rx * 0.5, ry * 0.12); g.fill();
    g.restore();

    /* ---- しゅるいの しるし（かたちと もようで わかる） ---- */
    g.lineWidth = 5;
    if (type === 'bouncy') {
      // ギザギザの おび
      g.strokeStyle = 'rgba(255,255,255,0.92)'; g.lineWidth = 7;
      g.beginPath();
      for (let i = 0; i <= 10; i++) {
        const xx = -rx * 0.72 + i * (rx * 1.44 / 10);
        const yy = (i % 2 ? -1 : 1) * ry * 0.2;
        if (i === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy);
      }
      g.stroke();
      g.strokeStyle = 'rgba(43,122,36,0.55)'; g.lineWidth = 3;
      g.stroke();
    } else if (type === 'floaty') {
      // ふわふわの しるし：白い くも＋キラキラ
      g.save();
      balloonPath(g, rx, ry); g.clip();
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.beginPath();
      [[-0.42, 0.06, 0.26], [-0.1, -0.16, 0.34], [0.26, 0.02, 0.28], [0.5, 0.12, 0.19]].forEach(function (p) {
        g.moveTo((p[0] + p[2]) * rx, p[1] * ry);
        g.ellipse(p[0] * rx, p[1] * ry, p[2] * rx, p[2] * rx * 0.76, 0, 0, TAU);
      });
      g.fill();
      g.fillStyle = 'rgba(122,88,190,0.22)';
      ell(g, 0, ry * 0.24, rx * 0.56, ry * 0.1); g.fill();
      g.restore();
      g.fillStyle = '#fff7c8';
      for (let i = 0; i < 4; i++) {
        const a = t * 1.6 + i * TAU / 4;
        const rr = 7 + Math.sin(t * 6 + i) * 2.6;
        star4(g, Math.cos(a) * rx * 1.08, Math.sin(a) * ry * 1.08, rr); g.fill();
        g.lineWidth = 2.5; g.strokeStyle = '#e4c23f'; g.stroke();
      }
    } else if (type === 'big') {
      // 大きな ★ ＋ そとむきの 矢印（おおきい＝ふくらんでいる）
      g.save();
      balloonPath(g, rx, ry); g.clip();
      g.fillStyle = 'rgba(255,255,255,0.92)';
      starPath(g, 0, -ry * 0.04, rx * 0.46, rx * 0.19, 5, -Math.PI / 2); g.fill();
      g.lineWidth = 4; g.strokeStyle = 'rgba(31,106,151,0.7)'; g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.fillStyle = 'rgba(255,255,255,0.8)';
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (d) {
        arrow(g, d[0] * rx * 0.46, d[1] * ry * 0.46, d[0] * rx * 0.76, d[1] * ry * 0.76, 5);
      });
      g.restore();
    } else if (type === 'small') {
      // ちいさな ★ ひとつ ＋ 内むきの 矢印
      g.save();
      balloonPath(g, rx, ry); g.clip();
      g.fillStyle = 'rgba(255,255,255,0.95)';
      starPath(g, 0, -ry * 0.02, rx * 0.4, rx * 0.17, 5, -Math.PI / 2); g.fill();
      g.lineWidth = 3.5; g.strokeStyle = 'rgba(163,122,0,0.75)'; g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.fillStyle = 'rgba(255,255,255,0.85)';
      [[-1, 0], [1, 0]].forEach(function (d) {
        arrow(g, d[0] * rx * 0.82, 0, d[0] * rx * 0.56, 0, 4);
      });
      g.restore();
    } else if (type === 'bomb') {
      // 導火線＋火花、しるしの ！、のこりゲージ
      const f = Math.max(0, Math.min(1, (fuse == null ? 1 : fuse)));
      // アイコンのときは 導火線を みじかく して、はこの 外に 出ないように する
      const fl = compact ? 22 : 50;
      g.strokeStyle = '#5a4030'; g.lineWidth = 8;
      g.beginPath(); g.moveTo(0, -ry); g.quadraticCurveTo(18 * (compact ? 0.5 : 1), -ry - fl * 0.56, 7, -ry - fl); g.stroke();
      g.strokeStyle = '#d0a36e'; g.lineWidth = 4; g.stroke();
      if (compact) {
        g.save(); g.translate(7, -ry - fl); g.scale(0.52, 0.52);
        drawFuseSpark(g, 0, 0, t); g.restore();
      } else {
        drawFuseSpark(g, 7, -ry - fl, t);
      }
      g.save();
      balloonPath(g, rx, ry); g.clip();
      // しましまの 注意おび
      g.fillStyle = 'rgba(43,26,20,0.82)';
      for (let i = -4; i <= 4; i++) {
        g.save();
        g.translate(i * rx * 0.3, ry * 0.42); g.rotate(-0.5);
        g.fillRect(-rx * 0.07, -ry * 0.3, rx * 0.14, ry * 0.6);
        g.restore();
      }
      // ！の 三角
      g.beginPath();
      g.moveTo(0, -ry * 0.56); g.lineTo(rx * 0.44, ry * 0.1); g.lineTo(-rx * 0.44, ry * 0.1); g.closePath();
      g.fillStyle = '#ffd23f'; g.fill();
      g.lineWidth = 5; g.strokeStyle = INK; g.stroke();
      A.roundRect(g, -rx * 0.06, -ry * 0.36, rx * 0.12, ry * 0.3, rx * 0.06);
      g.fillStyle = INK; g.fill();
      circ(g, 0, ry * 0.0, rx * 0.07); g.fill();
      g.restore();
      // のこりゲージ
      g.fillStyle = 'rgba(255,255,255,0.9)';
      A.roundRect(g, -rx * 0.6, ry * 0.62, rx * 1.2, 13, 6.5); g.fill();
      g.lineWidth = 3; g.strokeStyle = 'rgba(74,58,42,0.6)'; g.stroke();
      g.fillStyle = f > 0.35 ? '#ff9a5c' : '#e8264a';
      A.roundRect(g, -rx * 0.6 + 2, ry * 0.62 + 2, Math.max(0, (rx * 1.2 - 4) * f), 9, 4.5); g.fill();
    } else {
      // ふつう：水玉だけ（いちばん かざりが 少ない＝ふつう）
      g.save();
      balloonPath(g, rx, ry); g.clip();
      g.fillStyle = 'rgba(255,255,255,0.42)';
      [[-0.42, 0.3, 0.14], [0.36, 0.42, 0.11], [0.1, 0.64, 0.09], [-0.1, 0.12, 0.08]].forEach(function (d) {
        circ(g, d[0] * rx, d[1] * ry, d[2] * rx); g.fill();
      });
      g.restore();
    }

    /* ---- しぼんできた ようす（しわ＋色が くすむ） ----
       ラリーが 長びいたときだけ。だんだん こく なるので「あ、しぼんできた」と 目で わかる */
    if (df > 0.04) {
      g.save();
      balloonPath(g, rx, ry); g.clip();
      // 色が くすむ（灰色を うすく かける）
      g.fillStyle = 'rgba(118,108,118,' + (0.40 * df).toFixed(3) + ')';
      balloonPath(g, rx, ry); g.fill();
      // しわ（ななめの へこみ線）。しぼむほど ふえて こくなる
      const nw = 2 + Math.round(df * 3);
      g.lineCap = 'round';
      for (let i = 0; i < nw; i++) {
        const k = (i + 1) / (nw + 1);
        const yy = (-0.52 + k * 1.1) * ry;
        const bend = (i % 2 ? 1 : -1) * ry * 0.1;
        g.beginPath();
        g.moveTo(-rx * 0.86, yy);
        g.quadraticCurveTo(0, yy + bend, rx * 0.86, yy + ry * 0.04);
        g.strokeStyle = 'rgba(60,40,56,' + (0.34 * df).toFixed(3) + ')';
        g.lineWidth = 7 * df + 2;
        g.stroke();
        g.strokeStyle = 'rgba(255,255,255,' + (0.30 * df).toFixed(3) + ')';
        g.lineWidth = 3 * df + 1;
        g.beginPath();
        g.moveTo(-rx * 0.86, yy - 5);
        g.quadraticCurveTo(0, yy + bend - 5, rx * 0.86, yy + ry * 0.04 - 5);
        g.stroke();
      }
      g.restore();
      // 「もう すぐ われる」ころは ふちが チカチカ する
      if (df > 0.6) {
        const blink = (df - 0.6) / 0.4 * (0.45 + Math.abs(Math.sin(t * 11)) * 0.55);
        g.save();
        g.globalAlpha = Math.min(1, blink);
        balloonPath(g, rx, ry);
        g.lineWidth = 9; g.strokeStyle = '#e8264a'; g.stroke();
        g.restore();
      }
    }

    /* ---- むすびめ ---- */
    g.beginPath();
    g.moveTo(-10, ry * 1.0); g.lineTo(0, ry * 1.06 + 16); g.lineTo(10, ry * 1.0);
    g.closePath();
    g.fillStyle = b.deep; g.fill();
    g.lineWidth = 5; g.strokeStyle = OL; g.stroke();

    /* ---- ひも ---- */
    if (!noStr) {
      if (type === 'bouncy') {
        // バネ（はずむの しるし）
        g.strokeStyle = '#2b7a24'; g.lineWidth = 6;
        g.beginPath();
        for (let i = 0; i <= 24; i++) {
          const k = i / 24;
          g.lineTo(Math.sin(k * 7.6) * 15, ry * 1.06 + 16 + k * 42);
        }
        g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2.5; g.stroke();
      } else {
        g.strokeStyle = 'rgba(70,58,42,0.8)'; g.lineWidth = 3.5;
        g.beginPath();
        for (let i = 0; i <= 16; i++) {
          const k = i / 16;
          g.lineTo(Math.sin(k * 5 + t * 2.2) * 11 * k, ry * 1.06 + 16 + k * 46);
        }
        g.stroke();
      }
    }

    /* ---- ハイライト（光の はんしゃ） ---- */
    g.fillStyle = 'rgba(255,255,255,0.72)';
    ell(g, -rx * 0.36, -ry * 0.44, rx * 0.22, ry * 0.3, -0.52); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    ell(g, -rx * 0.15, -ry * 0.62, rx * 0.08, ry * 0.08, -0.4); g.fill();
    g.restore();
  }

  /* ---------- ギミックの 絵 ---------- */
  function drawBumper(g, bp, t, alpha, flash) {
    g.save();
    g.globalAlpha = alpha;
    g.translate(bp.x, bp.y);
    const pulse = 1 + (flash || 0) * 0.2 + Math.sin(t * 3) * 0.02;
    g.scale(pulse, pulse);
    g.lineJoin = 'round'; g.lineCap = 'round';
    // そとに とび出す「ボヨン」の しるし
    g.strokeStyle = '#8e2a6c'; g.lineWidth = 7;
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8 + t * 0.6;
      const r0 = bp.r * 1.04, r1 = bp.r * (1.2 + (flash || 0) * 0.3);
      g.beginPath();
      g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      g.stroke();
    }
    // そとの わ
    circ(g, 0, 0, bp.r);
    const bg = g.createRadialGradient(-bp.r * 0.36, -bp.r * 0.42, bp.r * 0.1, 0, 0, bp.r * 1.15);
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(0.26, '#ffb0e2');
    bg.addColorStop(0.7, '#e2459f');
    bg.addColorStop(1, '#a01a6c');
    g.fillStyle = bg; g.fill();
    g.lineWidth = 8; g.strokeStyle = OL; g.stroke();
    // 中の わ
    circ(g, 0, 0, bp.r * 0.6);
    const ig = g.createRadialGradient(-bp.r * 0.2, -bp.r * 0.24, bp.r * 0.06, 0, 0, bp.r * 0.68);
    ig.addColorStop(0, '#ffffff'); ig.addColorStop(1, '#ffe2f4');
    g.fillStyle = ig; g.fill();
    g.lineWidth = 6; g.strokeStyle = OL; g.stroke();
    // バネ（ぐるぐる）の しるし
    g.strokeStyle = '#d13a92'; g.lineWidth = 6;
    g.beginPath();
    for (let i = 0; i <= 34; i++) {
      const k = i / 34, a = k * TAU * 2.1, rr = bp.r * 0.08 + k * bp.r * 0.38;
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.stroke();
    // ツヤ
    g.fillStyle = 'rgba(255,255,255,0.75)';
    ell(g, -bp.r * 0.44, -bp.r * 0.5, bp.r * 0.28, bp.r * 0.13, -0.6); g.fill();
    // ひかる わ
    if (flash > 0) {
      g.globalAlpha = alpha * flash;
      circ(g, 0, 0, bp.r * (1 + (1 - flash) * 0.7));
      g.lineWidth = 9; g.strokeStyle = '#fff'; g.stroke();
    }
    g.restore();
  }

  // flip＝0〜1。「もうすぐ 向きが 逆に なる」よこくの つよさ。
  //        1 に 近いほど、ぎゃく向きの うすい矢印が はっきり 見える
  function drawWindArrows(g, dir, t, alpha, flip) {
    const fl = Math.max(0, Math.min(1, flip || 0));
    g.save();
    for (let i = 0; i < 6; i++) {
      const y = 190 + i * 112;
      const k = ((t * 0.55 + i * 0.17) % 1);
      const x = dir > 0 ? WALL_L + 40 + k * (WALL_R - WALL_L - 300) : WALL_R - 40 - k * (WALL_R - WALL_L - 300);
      // いまの 向き（よこく中は うすくなって いく）
      g.strokeStyle = 'rgba(42,147,189,0.75)';
      g.fillStyle = 'rgba(42,147,189,0.75)';
      g.globalAlpha = alpha * (0.35 + Math.sin(k * Math.PI) * 0.65) * (1 - fl * 0.6);
      arrow(g, x, y, x + dir * 170, y, 9);
      // つぎの 向き（赤い 矢印。チカチカ しながら はっきり して くる）
      if (fl > 0) {
        const bx = dir > 0 ? WALL_R - 40 - k * (WALL_R - WALL_L - 300) : WALL_L + 40 + k * (WALL_R - WALL_L - 300);
        g.strokeStyle = '#e8264a'; g.fillStyle = '#e8264a';
        g.globalAlpha = alpha * fl * (0.35 + Math.abs(Math.sin(t * 9)) * 0.65) * (0.4 + Math.sin(k * Math.PI) * 0.6);
        arrow(g, bx, y, bx - dir * 170, y, 9);
      }
    }
    g.restore();
  }

  // ギミック「おもり」：下むきの ふとい 矢印（風船が おもくなる）
  function drawHeavyMarks(g, t, alpha) {
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = '#7a5bd0'; g.fillStyle = '#7a5bd0';
    for (let i = 0; i < 5; i++) {
      const x = WALL_L + 180 + i * 390;
      const k = ((t * 0.7 + i * 0.2) % 1);
      const y = 180 + k * 520;
      g.globalAlpha = alpha * (0.3 + Math.sin(k * Math.PI) * 0.7);
      arrow(g, x, y, x, y + 150, 10);
    }
    g.restore();
  }

  // ギミック「ふきあげ」：下のほうだけ 上むきの 矢印が のぼっていく
  function drawLiftMarks(g, t, alpha) {
    g.save();
    g.globalAlpha = alpha;
    // はたらく ところが 見て わかるように、下の おびを うすく 色づける
    const lg = g.createLinearGradient(0, LIFT_Y, 0, GROUND);
    lg.addColorStop(0, 'rgba(47,163,107,0)');
    lg.addColorStop(1, 'rgba(47,163,107,0.22)');
    g.fillStyle = lg; g.fillRect(WALL_L, LIFT_Y, WALL_R - WALL_L, GROUND - LIFT_Y);
    g.setLineDash([20, 14]);
    g.lineWidth = 5; g.strokeStyle = 'rgba(47,163,107,0.6)';
    g.beginPath(); g.moveTo(WALL_L, LIFT_Y); g.lineTo(WALL_R, LIFT_Y); g.stroke();
    g.setLineDash([]);
    g.strokeStyle = '#2fa36b'; g.fillStyle = '#2fa36b';
    for (let i = 0; i < 7; i++) {
      const x = WALL_L + 130 + i * 270;
      const k = ((t * 0.85 + i * 0.14) % 1);
      const y = GROUND - 30 - k * (GROUND - LIFT_Y - 20);
      g.globalAlpha = alpha * (0.25 + Math.sin(k * Math.PI) * 0.75);
      arrow(g, x, y, x, y - 130, 10);
    }
    g.restore();
  }

  /* ---------- メニューの サムネイル ---------- */
  // メニューのカードは たての まん中あたりだけ 見えるので、中身を 上に よせる
  function drawThumb(g) {
    const s = 552 / W;
    g.save();
    g.scale(s, s);
    g.translate(0, -200);
    g.fillStyle = '#b9d6e6'; g.fillRect(0, -280, W, 300);
    drawCourt(g);
    drawNet(g, NET_TOP, 0.5);
    drawChar(g, 480, GROUND - PR, 'cat', 1, 0.4, 0, 'idle');
    drawChar(g, 1440, GROUND - PR - 150, 'rabbit', -1, 1.2, 0, 'air');
    drawBalloon(g, 1000, 500, 'normal', 0.6, 0, 1);
    g.restore();
  }

  /* ---------- あそびかたの アイコン ---------- */
  const SVG_MOVE = '<svg viewBox="0 0 64 64"><rect x="3" y="20" width="18" height="18" rx="4" fill="#fff" stroke="#4a3a2a" stroke-width="3"/>' +
    '<rect x="43" y="20" width="18" height="18" rx="4" fill="#fff" stroke="#4a3a2a" stroke-width="3"/>' +
    '<path d="M16 29 L8 29 M12 25 L8 29 L12 33" stroke="#4a3a2a" stroke-width="3" fill="none" stroke-linecap="round"/>' +
    '<path d="M48 29 L56 29 M52 25 L56 29 L52 33" stroke="#4a3a2a" stroke-width="3" fill="none" stroke-linecap="round"/>' +
    '<path d="M32 46 v-18 M24 36 l8 -10 8 10" stroke="#e2517f" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const SVG_HITWAY = '<svg viewBox="0 0 64 64"><circle cx="20" cy="44" r="14" fill="#f6a15c" stroke="#4a3a2a" stroke-width="3"/>' +
    '<circle cx="34" cy="22" r="10" fill="#ff7fa8" stroke="#4a3a2a" stroke-width="3"/>' +
    '<path d="M40 18 L58 8" stroke="#e2517f" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M52 8 L58 8 L58 14" stroke="#e2517f" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const SVG_DROP = '<svg viewBox="0 0 64 64"><circle cx="32" cy="16" r="11" fill="#ff7fa8" stroke="#4a3a2a" stroke-width="3"/>' +
    '<path d="M32 30 v12 M25 38 l7 8 7 -8" stroke="#e8264a" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<ellipse cx="32" cy="52" rx="15" ry="5" fill="none" stroke="#e8264a" stroke-width="3"/>' +
    '<path d="M6 58 H58" stroke="#b5924f" stroke-width="5" stroke-linecap="round"/></svg>';
  const SVG_KINDS = '<svg viewBox="0 0 64 64"><circle cx="15" cy="20" r="12" fill="#7ec8f0" stroke="#4a3a2a" stroke-width="3"/>' +
    '<path d="M15 14 l2 5 h5 l-4 3 1.5 5 -4.5 -3 -4.5 3 1.5 -5 -4 -3 h5z" fill="#fff"/>' +
    '<circle cx="44" cy="17" r="8" fill="#8adf78" stroke="#4a3a2a" stroke-width="3"/>' +
    '<path d="M38 17 l3 -4 3 4 3 -4 3 4" stroke="#fff" stroke-width="2.5" fill="none" stroke-linejoin="round"/>' +
    '<circle cx="30" cy="44" r="13" fill="#c3a6f0" stroke="#4a3a2a" stroke-width="3"/>' +
    '<path d="M30 36 q6 8 0 16" stroke="#fff" stroke-width="3" fill="none"/></svg>';
  const SVG_BURST = '<svg viewBox="0 0 64 64">' +
    '<path d="M32 4 l5 11 11 -4 -4 11 11 5 -11 5 4 11 -11 -4 -5 11 -5 -11 -11 4 4 -11 -11 -5 11 -5 -4 -11 11 4z" fill="#ffd9e4" stroke="#e8264a" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M24 24 L40 40 M40 24 L24 40" stroke="#e8264a" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M6 58 H58" stroke="#b5924f" stroke-width="5" stroke-linecap="round"/></svg>';
  const SVG_GIM = '<svg viewBox="0 0 64 64"><path d="M32 6 L58 50 H6 Z" fill="#ffd23f" stroke="#4a3a2a" stroke-width="4" stroke-linejoin="round"/>' +
    '<rect x="29" y="20" width="6" height="16" rx="3" fill="#4a3a2a"/><circle cx="32" cy="42" r="3.5" fill="#4a3a2a"/>' +
    '<path d="M4 58 H60" stroke="#2a93bd" stroke-width="4" stroke-linecap="round"/></svg>';

  /* =========================================================
     ゲーム登録
     ========================================================= */
  A.register({
    id: 'balloon',
    order: 5,
    title: 'ふわふわ！風船バレー',
    shortTitle: '風船バレー',
    catch: '風船を 落としたら 相手に 1点。5点先取で かち！',
    tags: ['1〜2人', 'キーボード', '5点先取'],
    isNew: true,
    modesCompact: true,
    theme: { main: '#5ec2e8', dark: '#2a93bd', light: '#e3f6ff' },
    bgm: 'balloon',
    howto: [
      { icon: SVG_MOVE, html: '1P＝<b class="key">A</b><b class="key">D</b> うごく・<b class="key">W</b> ジャンプ　2P＝<b class="key">←</b><b class="key">→</b>・<b class="key">↑</b>' },
      { icon: SVG_HITWAY, html: 'ふれると はね返る。<b>まん中で うけると 高く</b>、<b>はしで うけると よこへ</b>' },
      { icon: SVG_DROP, html: '自分のコートに 落ちたら <b>相手に 1点</b>。さきに <b>5点</b>で かち。<b>ノーマルだけ</b> 地面に <b>落ちどころの わっか</b>が 出る' },
      { icon: SVG_BURST, html: 'ラリーが <b>30びょう</b> つづくと 風船が <b>われる</b>。<b>のこり10びょうから 数字</b>が 出るので、早めに <b>相手がわへ</b> おくろう' },
      { icon: SVG_KINDS, html: 'スペシャルは <b>風船の しゅるい</b>が かわる（6しゅるい）。<b>かたち</b>と <b>もよう</b>で 見わけよう。はじめに ぜんぶ 見せます' },
      { icon: SVG_GIM, html: 'スペシャルは <b>ギミック</b>も 出る（かぜ・バンパー・たかいネット・おもり・ふきあげ）。<b>かならず よこく</b>が 出る' },
    ],
    modes: [
      {
        id: '2p', label: '2人で たいせん', sub: 'ともだちと', recommend: true,
        children: [
          { id: '2p-normal', label: 'ノーマル', sub: 'ふつうの風船', desc: 'おなじ風船だけ。落ちどころの わっかも 出る。はじめては こっち', recommend: true },
          { id: '2p-special', label: 'スペシャル', sub: '風船＋ギミック', desc: '6しゅるいの 風船＋ギミック。落ちどころは 出ないので よみあい' },
        ],
      },
      {
        id: 'cpu', label: 'CPUと たいせん', sub: '1人で あそぶ',
        children: [
          { id: 'cpu-1', label: 'やさしい', sub: 'はじめて', desc: 'ゆっくり うごく。ジャンプも あまり しない', recommend: true },
          { id: 'cpu-2', label: 'ふつう', sub: 'なれてきたら', desc: 'よく 追いかけてくる。ねらって 返してくる' },
          { id: 'cpu-3', label: 'プロ', sub: 'つよい', desc: 'ほとんど 落とさない。すみを ねらってくる' },
        ],
      },
      {
        id: 'cpus', label: 'CPUと スペシャル', sub: '1人＋風船いろいろ',
        children: [
          { id: 'cpus-1', label: 'やさしい', sub: 'はじめて', desc: '風船の しゅるいを おぼえるのに ちょうどいい（ギミックなし）' },
          { id: 'cpus-2', label: 'ふつう', sub: 'なれてきたら', desc: 'ギミックも 出る。風船が かわっても CPUは ついてくる' },
          { id: 'cpus-3', label: 'プロ', sub: 'さいきょう', desc: 'いちばん むずかしい。かてたら すごい' },
        ],
      },
    ],
    rank: {
      boards: [
        { id: 'balloon.n1', label: 'やさしいに かった人', short: 'やさしい', kind: 'clear' },
        { id: 'balloon.n2', label: 'ふつうに かった人', short: 'ふつう', kind: 'clear' },
        { id: 'balloon.n3', label: 'プロに かった人', short: 'プロ', kind: 'clear' },
        { id: 'balloon.s3', label: 'スペシャルの プロに かった人', short: 'SPプロ', kind: 'clear' },
      ],
      boardOf: function (opts) {
        const m = (opts && opts.mode) || '';
        if (m === 'cpu-1' || m === 'cpus-1') return 'balloon.n1';
        if (m === 'cpu-2' || m === 'cpus-2') return 'balloon.n2';
        if (m === 'cpu-3') return 'balloon.n3';
        if (m === 'cpus-3') return 'balloon.s3';
        return null;
      },
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
    // 見た目だけの ランダム。あそびの ランダム（rnd）を みださないように 別に する
    const vrnd = A.rng(20261115);

    let mode = 'demo';          // demo | guide | count | serve | play | point | end
                                // guide＝スペシャルの 風船しょうかい（スペシャルのときだけ）
    let special = false;
    let cpuLv = 0;              // 0＝2人であそぶ
    let T = 0, cd = 0, matchT = 0, stateT = 0;
    let score = [0, 0];
    let finished = false, overtime = false;
    let hold = false;
    let shake = 0;
    let serveSide = 0;          // つぎの サーブが 落ちてくる がわ
    let serveWait = SERVE_WAIT;
    let rallyT = 0;             // いまの ラリーの ながさ（止まらない対策）
    let shStage = 0;            // しぼみの 段階（0＝ふつう／1＝しぼんできた／2＝もうすぐ われる）
    let lastTick = -1;          // カウントダウンの 音を 1びょうに 1回だけ 鳴らす ため
    let guideT = 0;             // 風船しょうかい画面の けいか時間
    let lastType = '', typeRun = 0;
    let banner = null;          // { txt, sub, col, y, t }
    let pops = [];
    let sparks = [];
    let rings = [];
    let bot = [false, false];   // テスト用：人がわも ボットに できる
    let loser = null;           // 失点した がわ（かおを かえる）
    let gim = null;             // { id, dir, t, dur, on }
    let lastGim = '';
    let aim = { x: W / 2, side: 0, ok: false, pts: [], t: 0 };

    const pads = [
      { x: 460, y: GROUND - PR, vx: 0, vy: 0, air: false, face: 1, cool: 0, squash: 0, kind: 'cat', hitT: 0 },
      { x: W - 460, y: GROUND - PR, vx: 0, vy: 0, air: false, face: -1, cool: 0, squash: 0, kind: 'rabbit', hitT: 0 },
    ];
    const ball = { x: W / 2, y: 300, vx: 0, vy: 0, type: 'normal', t: 0, pop: 0, fuse: 1, bounced: false, live: false, popped: false };

    const stats = {
      rallies: 0, hits: [0, 0], longest: 0, rallyHits: 0, types: {}, netHits: 0, gims: {},
      // ラリーの ながさ（秒）。しぼみが ちゃんと きいているかを 数字で 見る ため
      sumT: 0, maxT: 0, forced: 0, lastT: 0, windFlips: 0, bursts: 0,
    };

    function lv() { return CPU[cpuLv] || CPU[1]; }
    function bt() { return BALLOONS[ball.type] || BALLOONS.normal; }
    /* ---------- しぼみ ----------
       0（ピンピン）→ 1（もう すぐ われる）。12秒から はじまり 27秒で さいだい。
       重さ・はね返り・見た目・画面の 表示 ぜんぶ これ 1つから 作る。 */
    function shrinkK() {
      if (rallyT <= RALLY_SHRINK) return 0;
      return Math.min(1, (rallyT - RALLY_SHRINK) / (RALLY_BURST - RALLY_SHRINK));
    }
    // ラリーが 長いほど 風船が 重くなる（1.0 → 1+SHRINK_ADD）
    function shrinkMul() { return 1 + shrinkK() * SHRINK_ADD; }
    // しぼむと はね返りも よわくなる（ネットを こえにくく なる＝決まりやすい）
    function shrinkHit() { return 1 - shrinkK() * SHRINK_HIT; }
    // しぼむと 風船は ほんとうに 小さくなる。絵と 当たり判定を そろえてあるので
    //「小さく なった＝あてにくく なった」が 見たまま つたわる
    function bRad() { return (BALLOONS[ball.type] || BALLOONS.normal).r * (1 - shrinkK() * SHRINK_SIZE); }
    function stageOf() { return rallyT > RALLY_HARD ? 2 : (rallyT > RALLY_SHRINK ? 1 : 0); }
    // われるまでの のこり秒数（切り上げ）。10, 9, 8 … と へっていくのが そのまま 画面に 出る
    function burstLeft() { return Math.max(0, Math.ceil(RALLY_BURST - rallyT)); }
    // ギミック「たかいネット」で ネットの たかさが かわる
    function netTop() {
      if (gim && gim.on && gim.id === 'tall') {
        const k = Math.min(1, gim.t / 0.45);
        return NET_TOP - NET_RISE * k;
      }
      return NET_TOP;
    }
    function gimOn(id) { return !!(gim && gim.on && gim.id === id); }
    // かぜの 向きが かわる までの「よこく」の つよさ（0＝よこく中でない、1＝いますぐ かわる）
    // 0 より 大きい あいだは かならず 画面に よこくが 出ている
    function windFlipWarn() {
      if (!gim || !gim.on || gim.id !== 'wind' || gim.flipAt <= 0) return 0;
      const to = gim.flipAt - gim.t;
      if (to > WIND_WARN) return 0;
      return Math.max(0, Math.min(1, 1 - to / WIND_WARN));
    }
    // ギミックは スペシャルだけ。やさしい（CPU レベル1）には 出さない
    function gimAllowed() { return special && cpuLv !== 1; }
    /* 風船しょうかい画面を 出すか。
       6しゅるいの 風船は スペシャルにしか 出ないので、スペシャルだけ 出す。
       「CPUと スペシャル・やさしい」は 風船の しゅるいを おぼえる ための モードなので、
       そこでは いちばん 役に立つ と 考えて 出している。
       やさしいでも 出したくない ときは、ここに && cpuLv !== 1 を 足すだけで よい。 */
    function guideNeeded() { return special; }

    /* ---------- 風船の しゅるいを きめる ---------- */
    function pickType() {
      if (!special) return 'normal';
      const cand = [];
      let total = 0;
      BALLOON_IDS.forEach(function (k) {
        let w = BALLOONS[k].w;
        if (k === lastType) w *= 0.25;         // 同じのが つづきにくい
        if (k === 'normal' && typeRun >= 2) w *= 0.3;  // ふつうばかりにも ならない
        total += w;
        cand.push([k, total]);
      });
      const r = rnd() * total;
      for (let i = 0; i < cand.length; i++) if (r < cand[i][1]) return cand[i][0];
      return 'normal';
    }

    /* ---------- ギミックを きめる ---------- */
    // ギミック 1つぶんの 状態を 作る。
    // かぜは「とちゅうで 向きが かわる」ので、いつ かわるかも ここで きめておく。
    function makeGim(id, dir) {
      if (!id || !GIM[id]) return null;
      const o = { id: id, dir: dir || 1, t: 0, dur: GIM[id].dur, on: false, flipAt: -1, flips: 0, warned: false };
      // かならず よこくの あとに かわるので、WIND_WARN より あとに なるように する
      if (id === 'wind') o.flipAt = Math.max(WIND_WARN + 0.5, GIM.wind.dur * 0.5);
      return o;
    }

    function pickGim() {
      // 1点目は 出さない（まず ふつうに おぼえてもらう）
      if (!gimAllowed() || (score[0] + score[1]) < 1) return null;
      if (rnd() >= GIM_CHANCE) return null;
      const cand = GIM_IDS.filter(function (k) { return k !== lastGim; });
      const id = cand[Math.floor(rnd() * cand.length)] || 'wind';
      lastGim = id;
      stats.gims[id] = (stats.gims[id] || 0) + 1;
      // かぜの むきは 毎回 ランダム（左→右だけに ならないように）
      return makeGim(id, rnd() < 0.5 ? -1 : 1);
    }

    /* ---------- サーブ ---------- */
    function serve(side) {
      serveSide = side;
      loser = null;
      BUMPS.forEach(function (bp) { bp.flash = 0; });
      ball.type = pickType();
      if (ball.type === 'normal') typeRun++; else typeRun = 0;
      lastType = ball.type;
      stats.types[ball.type] = (stats.types[ball.type] || 0) + 1;
      ball.x = side === 0 ? (WALL_L + NET_X) / 2 : (NET_X + WALL_R) / 2;
      ball.y = 330;
      // まっすぐ すぎると「まん中で 受ける」が 続きやすいので すこし ずらす
      ball.vx = (rnd() - 0.5) * 140; ball.vy = 0;
      // ラリーが 終わったので 風船は ピンピンに もどる
      rallyT = 0; shStage = 0; lastTick = -1;
      ball.t = 0; ball.pop = 0; ball.fuse = 1; ball.bounced = false;
      ball.popped = false;
      ball.live = false;
      gim = pickGim();
      serveWait = gim ? SERVE_WAIT_GIM : SERVE_WAIT;
      if (special) {
        const b = bt();
        setBanner(b.call || (b.name + 'の 風船！'), b.col2, b.hint, 236);
      }
      mode = 'serve';
      stateT = 0;
      stats.rallyHits = 0;
      aim.ok = false; aim.pts = [];
    }

    function reset(opts) {
      const m = (opts && opts.mode) || '2p-normal';
      special = (m === '2p-special' || m.indexOf('cpus') === 0);
      cpuLv = 0;
      if (m.indexOf('cpu-') === 0) cpuLv = Number(m.slice(4)) || 1;
      else if (m.indexOf('cpus-') === 0) cpuLv = Number(m.slice(5)) || 1;
      pads[0].x = 460; pads[1].x = W - 460;
      pads.forEach(function (p) { p.y = GROUND - PR; p.vx = 0; p.vy = 0; p.air = false; p.cool = 0; p.squash = 0; p.hitT = 0; });
      pads[0].face = 1; pads[1].face = -1;
      score = [0, 0];
      matchT = 0; finished = false; overtime = false;
      lastType = ''; typeRun = 0; banner = null; pops = []; sparks = []; rings = [];
      shake = 0;
      bot = [false, false];
      loser = null;
      gim = null; lastGim = '';
      serveWait = SERVE_WAIT;
      rallyT = 0; shStage = 0; guideT = 0; lastTick = -1;
      ball.popped = false;       // もう一回 あそぶ ときに 風船が 消えたままに ならないように
      aim = { x: W / 2, side: 0, ok: false, pts: [], t: 0 };
      BUMPS.forEach(function (bp) { bp.flash = 0; });
      stats.rallies = 0; stats.hits = [0, 0]; stats.longest = 0; stats.rallyHits = 0;
      stats.types = {}; stats.netHits = 0; stats.gims = {};
      stats.sumT = 0; stats.maxT = 0; stats.forced = 0; stats.lastT = 0; stats.windFlips = 0;
      stats.bursts = 0;
    }

    /* ---------- スペシャルの 風船しょうかい画面 ---------- */
    function endGuide() {
      if (mode !== 'guide') return;
      mode = 'count';
      cd = 0;
      api.sfx('decide');
    }

    function addPop(x, y, txt, col) { pops.push({ x: x, y: y, txt: txt, col: col, t: 0 }); }
    function setBanner(txt, col, sub, y) { banner = { txt: txt, col: col, sub: sub || '', y: y || 330, t: 0 }; }
    function addSpark(x, y, nx, ny, col, n) {
      for (let i = 0; i < n; i++) {
        const a = Math.atan2(ny, nx) + (vrnd() - 0.5) * 1.8;
        const sp = 170 + vrnd() * 320;
        sparks.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: 0.46 + vrnd() * 0.26, col: col, r: 6 + vrnd() * 6 });
      }
    }
    function addRing(x, y, col) { rings.push({ x: x, y: y, col: col, t: 0 }); }

    /* ---------- プレイヤーの うごき ---------- */
    function padLimits(i) {
      return i === 0
        ? { lo: WALL_L + PR, hi: NET_X - NET_HW - PR - 4 }
        : { lo: NET_X + NET_HW + PR + 4, hi: WALL_R - PR };
    }

    function movePad(p, i, dir, jump, dt) {
      const want = dir * RUN;
      const d = want - p.vx;
      const step = ACC * dt;
      p.vx += Math.max(-step, Math.min(step, d));
      if (dir !== 0) p.face = dir > 0 ? 1 : -1;
      p.x += p.vx * dt;
      const L = padLimits(i);
      if (p.x < L.lo) { p.x = L.lo; p.vx = 0; }
      if (p.x > L.hi) { p.x = L.hi; p.vx = 0; }
      if (jump && !p.air) {
        p.vy = JUMP_V; p.air = true; p.squash = -0.14;
        api.audio.tone({ f: 420, f2: 760, dur: 0.1, type: 'triangle', vol: 0.12 });
      }
      if (p.air) {
        p.vy += PGRAV * dt;
        p.y += p.vy * dt;
        if (p.y >= GROUND - PR) { p.y = GROUND - PR; p.vy = 0; p.air = false; p.squash = 0.16; }
        if (p.y < CEIL + PR) { p.y = CEIL + PR; p.vy = 0; }
      }
      p.squash += (0 - p.squash) * Math.min(1, dt * 9);
      if (p.hitT > 0) p.hitT = Math.max(0, p.hitT - dt);
    }

    function moodOf(p, i) {
      if (loser !== null) return loser === i ? 'sad' : 'happy';
      if (p.hitT > 0) return 'hit';
      if (p.air) return 'air';
      if (Math.abs(p.vx) > 180) return 'run';
      return 'idle';
    }

    /* ---------- CPU ----------
       風船が 自分のコートに 来るときの 落ちどころを ざっくり 計算して そこへ向かう。
       よわい CPU は 反応が おそく、ねらいも ずれる。 */
    const ai = { t: 0, target: W - 460, wantJump: false, lastSee: 0 };

    function predictX() {
      // いまの 速度で すすめて、プレイヤーの 高さに 来るときの x を さがす
      let x = ball.x, y = ball.y, vx = ball.vx, vy = ball.vy;
      const b = bt();
      const sh = shrinkMul();
      const gg = BGRAV * b.g * sh * (gimOn('heavy') ? HEAVY_MUL : 1) *
        (ball.type === 'bomb' && ball.fuse <= 0 ? BOMB_GRAV : 1);
      const wind = gimOn('wind') ? WIND_ACC * gim.dir : 0;
      const lift = gimOn('lift');
      const br = bRad();
      const hitY = GROUND - PR - 20;
      for (let i = 0; i < 260; i++) {
        vy = Math.min(BFALL_MAX * sh, vy + gg * (1 / 60));
        if (lift && y > LIFT_Y && vy > 0) vy = Math.max(0, vy - LIFT_ACC * (1 / 60));
        vx += wind * (1 / 60);
        vx -= vx * BDRAG * (1 / 60);
        x += vx / 60; y += vy / 60;
        if (x < WALL_L + br) { x = WALL_L + br; vx = -vx; }
        if (x > WALL_R - br) { x = WALL_R - br; vx = -vx; }
        if (y > hitY) break;
      }
      return x;
    }

    // 落ちどころの 目じるし用。地面に とどくまで すすめて、とちゅうの 点も かえす
    function predictDrop() {
      const b = bt();
      let x = ball.x, y = ball.y, vx = ball.vx, vy = ball.vy;
      const sh = shrinkMul();
      const bombFall = (ball.type === 'bomb' && ball.fuse <= 0);
      const gg = BGRAV * b.g * sh * (gimOn('heavy') ? HEAVY_MUL : 1) * (bombFall ? BOMB_GRAV : 1);
      const vmax = BFALL_MAX * sh * (bombFall ? 2.2 : 1);
      const wind = gimOn('wind') ? WIND_ACC * gim.dir : 0;
      const lift = gimOn('lift');
      const nt = netTop();
      const dt = 1 / 60;
      const br = bRad();
      const pts = [];
      let hitGround = false;
      for (let i = 0; i < 300; i++) {
        vy = Math.min(vmax, vy + gg * dt);
        if (lift && y > LIFT_Y && vy > 0) vy = Math.max(0, vy - LIFT_ACC * dt);
        vx += wind * dt;
        vx -= vx * BDRAG * dt;
        if (Math.abs(vx) > VX_MAX) vx = (vx > 0 ? 1 : -1) * VX_MAX;
        x += vx * dt; y += vy * dt;
        if (x < WALL_L + br) { x = WALL_L + br; vx = Math.abs(vx) * 0.92; }
        if (x > WALL_R - br) { x = WALL_R - br; vx = -Math.abs(vx) * 0.92; }
        if (y < CEIL + br) { y = CEIL + br; vy = Math.abs(vy) * 0.6; }
        if (y + br > nt - 16 && Math.abs(x - NET_X) < NET_HW + br) {
          const sd = x >= NET_X ? 1 : -1;
          if (y < nt) { y = nt - br - 16; vy = -Math.abs(vy) * 0.55; vx += sd * 120; }
          else { x = NET_X + sd * (NET_HW + br); vx = sd * Math.abs(vx) * 0.8; }
        }
        if (i % 6 === 0) pts.push(x, y);
        if (y + br >= GROUND) { hitGround = true; break; }
      }
      aim.x = x; aim.side = x < NET_X ? 0 : 1; aim.ok = hitGround; aim.pts = pts;
    }

    function aiControl(dt) {
      const p = pads[1];
      const L = padLimits(1);
      const c = lv();
      ai.t -= dt;
      if (ai.t <= 0) {
        ai.t = c.react;
        let tx;
        const comingHere = ball.vx > 0 || ball.x > NET_X;
        if (ball.live && comingHere) {
          tx = predictX();
          // よわいほど 読みが あまい（いまの位置に 引っぱられる）
          tx = ball.x + (tx - ball.x) * c.read;
          tx += (rnd() - 0.5) * 2 * c.err;
          // ねらい：相手の いないほうへ 返すために 風船の はしに まわりこむ
          const aimLeft = pads[0].x > (WALL_L + NET_X) / 2;
          tx += (aimLeft ? 1 : -1) * 96 * c.aim;
        } else {
          tx = (NET_X + WALL_R) / 2 + (rnd() - 0.5) * 120;
        }
        ai.target = Math.max(L.lo, Math.min(L.hi, tx));
        // ジャンプ：風船が 高めで 近いとき
        const near = Math.abs(ball.x - p.x) < 150 && ball.y < GROUND - PR - 120 && ball.y > CEIL + 80;
        ai.wantJump = ball.live && near && !p.air && rnd() < c.jump;
      }
      const dx = ai.target - p.x;
      let dir = 0;
      if (Math.abs(dx) > 14) dir = dx > 0 ? 1 : -1;
      return { dir: dir * c.speed, jump: ai.wantJump };
    }

    /* ---------- 風船を はね返す ----------
       当てた「ところ」で とぶ向きが きまる。
       ・まん中（off=0）  → まっすぐ 上へ 高く
       ・はし（off=±1）   → よこへ 大きく
       MIN_UP で かならず 上むきに なることは 変えない。 */
    function hitBall(p, i) {
      const b = bt();
      const reach = PR + bRad();
      let off = (ball.x - p.x) / reach;
      off = Math.max(-1, Math.min(1, off));
      // はしで 当てたときの よこ成分を 強調する（差が 体感できるように）
      const sgn = off >= 0 ? 1 : -1;
      let nx = sgn * Math.pow(Math.abs(off), 0.7) * AIM_SIDE;
      let ny = -Math.sqrt(Math.max(0.04, 1 - nx * nx));
      // かならず 上むき（ななめ上）に とばす
      if (ny > -MIN_UP) {
        ny = -MIN_UP;
        const k = Math.sqrt(Math.max(0.0001, 1 - ny * ny));
        nx = sgn * k;
      }
      // しぼんだ 風船は はね返りも よわい（＝高く とばない。ラリーが 決まりやすい）
      let sp = HIT_SPEED * b.hit * shrinkHit() * (1 + Math.abs(off) * 0.1);
      if (p.air) sp *= 1.12;                       // ジャンプ中は すこし つよい
      // 相手がわへの かるい おし出し。
      // これが ないと「まん中で 当てる」を くり返すだけで 風船が 自分の上を
      // 行ったり来たりして、いつまでも ネットを こえない（ためして 見つけた）。
      const side = (i === 0 ? 1 : -1);
      ball.vx = nx * sp + p.vx * 0.26 + side * OVER_PUSH;
      ball.vy = ny * sp;
      // しぼんだ 風船は 空気が ぬけて まっすぐ とばない（ねらいが きかなく なる）
      const wob = shrinkK();
      if (wob > 0) ball.vx += (rnd() - 0.5) * SHRINK_WOBBLE * wob;
      if (Math.abs(ball.vx) > VX_MAX) ball.vx = (ball.vx > 0 ? 1 : -1) * VX_MAX;
      // かさなりを ほどく
      ball.x = p.x + nx * (reach + 2);
      ball.y = p.y + ny * (reach + 2);
      ball.live = true;
      ball.pop = 0.5;
      p.cool = HIT_COOL;
      p.squash = -0.1;
      p.hitT = 0.26;
      stats.hits[i]++;
      stats.rallyHits++;
      if (stats.rallyHits > stats.longest) stats.longest = stats.rallyHits;
      // 手ごたえ：火花・ひかる わ・わずかな ゆれ・音
      addSpark(ball.x, ball.y, nx, ny, b.col, 8);
      addRing(ball.x, ball.y, b.col2);
      shake = Math.max(shake, 0.07);
      api.sfx('pop');
      // まん中ほど 高い音（当てた ところが 音でも わかる）
      api.audio.tone({ f: 420 + (1 - Math.abs(off)) * 420, dur: 0.07, type: 'triangle', vol: 0.1 });
    }

    /* ---------- 失点 ---------- */
    function point(ls) {
      const winner = ls === 0 ? 1 : 0;
      loser = ls;
      score[winner]++;
      stats.rallies++;
      // ラリーの ながさを 記録する（しぼみが きいているかを あとで 数字で みる）
      stats.lastT = +rallyT.toFixed(2);
      stats.sumT = +(stats.sumT + rallyT).toFixed(2);
      if (rallyT > stats.maxT) stats.maxT = +rallyT.toFixed(2);
      shake = 0.3;
      api.sfx('goal');
      addPop(ball.x, GROUND - 90, 'ドスン！', '#e8264a');
      addSpark(ball.x, GROUND - 20, 0, -1, bt().col, 14);
      const names = nameOf();
      setBanner(names[winner] + 'の 1てん！', winner === 0 ? '#e2517f' : '#2a93bd', '', 330);
      mode = 'point';
      stateT = 0;
      if (gim) gim.on = false;
      if (score[winner] >= WIN_SCORE || (overtime)) { endMatch(winner); return; }
      ball.live = false;
    }

    /* ---------- 風船が われる ----------
       空気が なくなったら ほんとうに われる。
       「もう すぐ われる！」の 表示と 絵の しぼみが うそに ならないように する。
       safety＝true は RALLY_MAX の 安全そうち から 呼ばれた とき */
    function burstBalloon(safety) {
      ball.popped = true;
      ball.live = false;
      addPop(ball.x, Math.max(220, ball.y - 130), '風船が われた！', '#e8264a');
      addSpark(ball.x, ball.y, 0, -1, bt().col, 20);
      addSpark(ball.x, ball.y, 0, 1, '#ffffff', 12);
      addRing(ball.x, ball.y, '#e8264a');
      api.sfx('crash');
      shake = Math.max(shake, 0.34);
      stats.bursts++;
      if (safety) stats.forced++;
      point(ball.x < NET_X ? 0 : 1);
    }

    function nameOf() {
      return cpuLv ? ['あなた', 'CPU（' + lv().name + '）'] : ['1P', '2P'];
    }

    function endMatch(winner) {
      if (finished) return;
      finished = true;
      mode = 'end';
      stateT = 0;
      loser = winner === 0 ? 1 : 0;
      const names = nameOf();
      const humanWin = (winner === 0);
      const cpuWin = cpuLv > 0 && humanWin;
      api.sfx(humanWin || !cpuLv ? 'win' : 'finish');
      setBanner(names[winner] + 'の かち！', winner === 0 ? '#e2517f' : '#2a93bd', '', 330);
      const sub = 'スコア <b>' + score[0] + ' - ' + score[1] + '</b>' +
        '　いちばん長い ラリー <b>' + stats.longest + '</b>かい' +
        (special ? '　<b>スペシャル</b>' : '');
      api.finish({
        // クリア者リスト（CPU戦で 人が かったときだけ のせる）
        score: cpuWin ? 1 : 0,
        ribbon: cpuWin ? (lv().name + 'に かった！') : 'けっか',
        headline: names[winner] + 'の かち！',
        big: score[0] + ' - ' + score[1],
        sub: sub,
        delay: 1400,
      });
    }

    /* =========================================================
       update
       ========================================================= */
    function update(dt) {
      if (hold) return;
      T += dt;
      if (shake > 0) shake = Math.max(0, shake - dt);
      ball.t += dt;
      if (ball.pop > 0) ball.pop = Math.max(0, ball.pop - dt * 2.4);
      pads.forEach(function (p) { if (p.cool > 0) p.cool = Math.max(0, p.cool - dt); });
      for (let i = pops.length - 1; i >= 0; i--) { pops[i].t += dt; if (pops[i].t > 1.1) pops.splice(i, 1); }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.t += dt; s.vy += 880 * dt; s.x += s.vx * dt; s.y += s.vy * dt;
        if (s.t > s.life) sparks.splice(i, 1);
      }
      for (let i = rings.length - 1; i >= 0; i--) { rings[i].t += dt; if (rings[i].t > 0.4) rings.splice(i, 1); }
      BUMPS.forEach(function (bp) { if (bp.flash > 0) bp.flash = Math.max(0, bp.flash - dt * 3.2); });
      if (banner) { banner.t += dt; if (banner.t > 2.2) banner = null; }

      if (mode === 'demo') { demo(dt); return; }
      // スペシャルの 風船しょうかい（カウントダウンの 前に 1回だけ）
      if (mode === 'guide') {
        guideT += dt;
        if (guideT >= GUIDE_TIME) endGuide();
        return;
      }
      if (mode === 'count') {
        cd += dt;
        const was = Math.ceil(COUNT_TIME - (cd - dt));
        const now = Math.ceil(COUNT_TIME - cd);
        if (now !== was && now >= 0) api.sfx(now === 0 ? 'go' : 'count');
        if (cd >= COUNT_TIME) serve(rnd() < 0.5 ? 0 : 1);
        return;
      }
      if (mode === 'end') { stateT += dt; movePlayers(dt); return; }
      if (mode === 'point') {
        stateT += dt;
        movePlayers(dt);
        // 落ちた風船は その場で しぼむ
        if (stateT > 1.25) serve(score[0] > score[1] ? 1 : 0);
        return;
      }

      matchT += dt;
      if (!overtime && matchT >= MATCH_TIME && mode !== 'end') {
        if (score[0] !== score[1]) { endMatch(score[0] > score[1] ? 0 : 1); return; }
        overtime = true;
        setBanner('えんちょう！ つぎの 1点で かち', '#c79a0a', '', 330);
      }

      movePlayers(dt);

      if (mode === 'serve') {
        stateT += dt;
        // ふわっと 浮かんで まっている
        ball.y = 330 + Math.sin(stateT * 3) * 14;
        if (stateT >= serveWait) {
          ball.live = true;
          mode = 'play';
          if (gim) {
            gim.on = true; gim.t = 0;
            addPop(W / 2, 470, GIM[gim.id].name + ' スタート！', GIM[gim.id].col);
            api.sfx('whoosh');
          }
        }
        return;
      }

      /* ---- play ---- */
      // ラリーが 長くなったら 風船が しぼんで 重くなる。
      // （どちらも 落とさないと いつまでも 終わらないため。画面にも 段階を 出す）
      rallyT += dt;
      // しぼみの 段階が あがったら、はっきり 知らせる
      const st = stageOf();
      if (st > shStage) {
        shStage = st;
        if (st === 1) {
          addPop(W / 2, 470, '風船が しぼんできた！', '#d8622a');
          api.sfx('whoosh');
        } else {
          // のこり10びょう。ここから 数字の カウントダウンが はじまる
          addPop(W / 2, 560, 'のこり ' + RALLY_WARN + 'びょう！ 相手がわへ！', '#e8264a');
          api.sfx('bonk');
          shake = Math.max(shake, 0.18);
        }
      }
      // カウントダウンの 音。10〜4 は そっと、3・2・1 は はっきり
      if (shStage === 2) {
        const secL = burstLeft();
        if (secL !== lastTick && secL >= 1 && secL <= RALLY_WARN) {
          lastTick = secL;
          api.sfx(secL <= 3 ? 'count' : 'tick');
        }
      }
      // 空気が なくなった → 風船が われる。いま 風船が ある がわの 失点
      if (rallyT >= RALLY_BURST) { burstBalloon(false); return; }
      // 最後の 安全そうち（なにかの ぐあいで 上の われるしょりを とおらなかったとき用）
      if (rallyT > RALLY_MAX) { burstBalloon(true); return; }
      // ギミックの 時間
      if (gim && gim.on) {
        gim.t += dt;
        // かぜ：とちゅうで 向きが かわる。かならず WIND_WARN 秒の よこくが 先に 出る
        if (gim.id === 'wind' && gim.flipAt > 0) {
          const toFlip = gim.flipAt - gim.t;
          if (toFlip <= WIND_WARN && !gim.warned) {
            // よこくの 文字は drawWindFlipWarn の はこが 出すので、ここは 音だけ
            gim.warned = true;
            api.sfx('count');
          }
          if (toFlip <= 0) {
            gim.dir = -gim.dir;
            gim.flipAt = -1;
            gim.flips++;
            stats.windFlips++;
            addPop(W / 2, 560, gim.dir > 0 ? 'かぜは → に かわった！' : 'かぜは ← に かわった！', GIM.wind.col);
            api.sfx('whoosh');
            shake = Math.max(shake, 0.12);
          }
        }
        if (gim.t > gim.dur) {
          addPop(W / 2, 470, GIM[gim.id].name + ' おわり', GIM[gim.id].col);
          gim.on = false;
        }
      }
      const b = bt();
      // ばくはつ風船の ひも
      if (ball.type === 'bomb' && ball.live) {
        ball.fuse = Math.max(0, ball.fuse - dt / BOMB_FUSE);
      }
      const shrink = shrinkMul();
      const heavy = gimOn('heavy') ? HEAVY_MUL : 1;
      const gg = BGRAV * b.g * shrink * heavy * (ball.type === 'bomb' && ball.fuse <= 0 ? BOMB_GRAV : 1);
      ball.vy = Math.min(BFALL_MAX * shrink * (ball.type === 'bomb' && ball.fuse <= 0 ? 2.2 : 1), ball.vy + gg * dt);
      // ギミック：ふきあげ（下のほうで 落ちるのを ゆるめる。上には おし上げないので 止まらなく ならない）
      if (gimOn('lift') && ball.y > LIFT_Y && ball.vy > 0) {
        ball.vy = Math.max(0, ball.vy - LIFT_ACC * dt);
      }
      // ギミック：かぜ（VX_MAX は こえない）
      if (gimOn('wind')) ball.vx += WIND_ACC * gim.dir * dt;
      // しぼんだ 風船は とんでいる あいだも ふらふら する（見ていても わかる）
      if (shrinkK() > 0) ball.vx += Math.sin(ball.t * 8.5) * 340 * shrinkK() * dt;
      ball.vx -= ball.vx * BDRAG * dt;
      if (Math.abs(ball.vx) > VX_MAX) ball.vx = (ball.vx > 0 ? 1 : -1) * VX_MAX;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      // しぼんだ ぶんだけ 当たり判定も 小さい（絵と そろえている）
      const br = bRad();

      // かべ・天じょう
      if (ball.x < WALL_L + br) { ball.x = WALL_L + br; ball.vx = Math.abs(ball.vx) * 0.92; api.sfx('wall'); }
      if (ball.x > WALL_R - br) { ball.x = WALL_R - br; ball.vx = -Math.abs(ball.vx) * 0.92; api.sfx('wall'); }
      if (ball.y < CEIL + br) { ball.y = CEIL + br; ball.vy = Math.abs(ball.vy) * 0.6; }

      // ネット（たかさが かわることが ある）
      const nt = netTop();
      if (ball.y + br > nt - 16) {
        const dx = ball.x - NET_X;
        if (Math.abs(dx) < NET_HW + br) {
          if (ball.y < nt) {
            // てっぺんに あたった
            ball.y = nt - br - 16;
            ball.vy = -Math.abs(ball.vy) * 0.55;
            ball.vx += (dx >= 0 ? 1 : -1) * 120;
          } else {
            ball.x = NET_X + (dx >= 0 ? 1 : -1) * (NET_HW + br);
            ball.vx = (dx >= 0 ? 1 : -1) * Math.abs(ball.vx) * 0.8;
          }
          stats.netHits++;
          api.sfx('wall');
        }
      }

      // ギミック：バンパー（はねかえるだけ。力は くわえないので 止まらなく ならない）
      if (gimOn('bump')) {
        for (let k = 0; k < BUMPS.length; k++) {
          const bp = BUMPS[k];
          const dx2 = ball.x - bp.x, dy2 = ball.y - bp.y;
          const dd = Math.hypot(dx2, dy2);
          const rr = bp.r + br;
          if (dd < rr && dd > 0.001) {
            const nx2 = dx2 / dd, ny2 = dy2 / dd;
            ball.x = bp.x + nx2 * rr;
            ball.y = bp.y + ny2 * rr;
            const vn = ball.vx * nx2 + ball.vy * ny2;
            if (vn < 0) {
              ball.vx -= 1.86 * vn * nx2;
              ball.vy -= 1.86 * vn * ny2;
            }
            if (Math.abs(ball.vx) > VX_MAX) ball.vx = (ball.vx > 0 ? 1 : -1) * VX_MAX;
            bp.flash = 1;
            ball.pop = 0.5;
            addSpark(ball.x, ball.y, nx2, ny2, '#f3a8de', 7);
            api.sfx('bonk');
          }
        }
      }

      // プレイヤーに あたる
      for (let i = 0; i < 2; i++) {
        const p = pads[i];
        if (p.cool > 0) continue;
        const d = Math.hypot(ball.x - p.x, ball.y - p.y);
        if (d < PR + br) hitBall(p, i);
      }

      // 地面
      if (ball.y + br >= GROUND) {
        if (ball.type === 'bouncy' && !ball.bounced && ball.fuse > 0) {
          // 「はずむ」は 1回だけ 床で はね返る（へんな方向へ）
          ball.bounced = true;
          ball.y = GROUND - br;
          ball.vy = -Math.abs(ball.vy) * 0.82 - 160;
          ball.vx += (rnd() - 0.5) * 460;
          if (Math.abs(ball.vx) > VX_MAX) ball.vx = (ball.vx > 0 ? 1 : -1) * VX_MAX;
          ball.pop = 0.6;
          addPop(ball.x, GROUND - 120, 'はずんだ！', '#45a93a');
          addSpark(ball.x, GROUND - 10, 0, -1, b.col, 9);
          api.sfx('bonk');
        } else {
          ball.y = GROUND - br;
          point(ball.x < NET_X ? 0 : 1);
          return;
        }
      }

      // 落ちどころの 読み（毎フレームは 重いので 少し 間を あける）
      // ノーマルだけ。スペシャルは わざと 出さない（読み合いを たのしんでもらう）
      if (special) { aim.ok = false; aim.pts = []; }
      else {
        aim.t -= dt;
        if (aim.t <= 0) { aim.t = 0.05; predictDrop(); }
      }
    }

    function movePlayers(dt) {
      // 1P
      let d0 = 0, j0 = false;
      if (bot[0]) {
        // テスト用の かんたんボット
        const tx = ball.x < NET_X ? ball.x : (WALL_L + NET_X) / 2;
        d0 = Math.abs(tx - pads[0].x) > 14 ? (tx > pads[0].x ? 1 : -1) : 0;
        j0 = ball.live && Math.abs(ball.x - pads[0].x) < 140 && ball.y < GROUND - PR - 130 && !pads[0].air;
      } else {
        if (api.input.anyDown('KeyA')) d0 -= 1;
        if (api.input.anyDown('KeyD')) d0 += 1;
        j0 = api.input.anyDown('KeyW');
      }
      movePad(pads[0], 0, d0, j0 && mode !== 'count', dt);

      // 2P or CPU
      let d1 = 0, j1 = false;
      if (cpuLv > 0 || bot[1]) {
        const r = aiControl(dt);
        d1 = r.dir; j1 = r.jump;
      } else {
        if (api.input.anyDown('ArrowLeft')) d1 -= 1;
        if (api.input.anyDown('ArrowRight')) d1 += 1;
        j1 = api.input.anyDown('ArrowUp');
      }
      movePad(pads[1], 1, d1, j1 && mode !== 'count', dt);
    }

    let demoT = 0;
    function demo(dt) {
      demoT -= dt;
      if (demoT <= 0 || !ball.live) {
        ball.x = (WALL_L + NET_X) / 2 + rnd() * 600;
        ball.y = 300; ball.vx = (rnd() - 0.5) * 300; ball.vy = 0;
        ball.type = rnd() < 0.5 ? 'normal' : BALLOON_IDS[Math.floor(rnd() * BALLOON_IDS.length)];
        ball.live = true; ball.bounced = false; ball.fuse = 1;
        demoT = 4;
      }
      const b = bt();
      ball.vy = Math.min(BFALL_MAX, ball.vy + BGRAV * b.g * dt);
      ball.x += ball.vx * dt; ball.y += ball.vy * dt;
      if (ball.x < WALL_L + b.r || ball.x > WALL_R - b.r) ball.vx = -ball.vx;
      if (ball.y + b.r > GROUND - 10) { ball.vy = -620; ball.y = GROUND - b.r - 10; }
      bot[0] = true;
      movePlayers(dt);
    }

    /* =========================================================
       draw
       ========================================================= */
    function draw(g) {
      g.save();
      if (shake > 0) {
        const s = shake * 18;
        g.translate((vrnd() - 0.5) * s, (vrnd() - 0.5) * s);
      }
      drawCourt(g);

      // ギミック：かぜの 矢印（よこくのときは うすく）
      if (gim && gim.id === 'wind' && (gim.on || mode === 'serve')) {
        drawWindArrows(g, gim.dir, T, gim.on ? 0.95 : 0.4, windFlipWarn());
      }
      // ギミック：おもり／ふきあげ（よこくのときは うすく）
      if (gim && gim.id === 'heavy' && (gim.on || mode === 'serve')) {
        drawHeavyMarks(g, T, gim.on ? 0.9 : 0.4);
      }
      if (gim && gim.id === 'lift' && (gim.on || mode === 'serve')) {
        drawLiftMarks(g, T, gim.on ? 0.9 : 0.4);
      }
      // かぜの 向きが かわる よこく。
      // キャラや 風船より「うしろ」に 描く。前に 置いたら 1.5秒ものあいだ
      // 風船が はこに かくれて しまい、かえって あそびにくかった。
      if (windFlipWarn() > 0) drawWindFlipWarn(g);

      // 落ちどころ（ノーマルだけ。スペシャルは 読み合いを たのしんでもらう）
      if (mode === 'play' && ball.live && !special) drawAim(g);

      // 風船の まっすぐ 下の かげ。
      // スペシャルでも これだけは のこす：落ちどころは 教えないが、
      // 「いま 風船が よこ方向に どこに いるか」は かげが ないと とても 見にくかった。
      if (mode !== 'count' && !ball.popped) {
        // スペシャルは わっかが ないぶん、かげを すこし こくする。
        // 撮って 見たら、もとの こさでは 高いところの 風船の かげが
        // ほとんど 見えず、よこの いちが つかめなかった。
        const k = Math.max(special ? 0.26 : 0.15, 1 - (GROUND - ball.y) / 900);
        const r0 = bRad();
        g.save();
        g.globalAlpha = (special ? 0.34 : 0.24) * k;
        g.fillStyle = '#000';
        ell(g, ball.x, GROUND + 7, r0 * k * 1.15, r0 * k * 0.3); g.fill();
        g.restore();
      }

      // ネット（たかさが かわる）
      const nt = netTop();
      if (gim && gim.id === 'tall' && mode === 'serve') {
        // よこく：たかくなった あとの ネットを 点せんの かたちで 見せる
        g.save();
        const ghost = NET_TOP - NET_RISE;
        g.globalAlpha = 0.55 + Math.sin(T * 6) * 0.25;
        g.fillStyle = 'rgba(255,230,150,0.55)';
        g.fillRect(NET_X - NET_HW, ghost, NET_HW * 2, NET_RISE);
        g.globalAlpha = 1;
        g.setLineDash([16, 12]);
        g.lineWidth = 6; g.strokeStyle = '#c79a0a';
        g.beginPath();
        g.moveTo(NET_X - NET_HW, NET_TOP); g.lineTo(NET_X - NET_HW, ghost);
        g.lineTo(NET_X + NET_HW, ghost); g.lineTo(NET_X + NET_HW, NET_TOP);
        g.stroke();
        g.setLineDash([]);
        // 「ここまで たかくなる」矢印（プレートに かくれない 下がわに 出す）
        g.fillStyle = '#c79a0a'; g.strokeStyle = '#c79a0a';
        arrow(g, NET_X + 86, NET_TOP - 16, NET_X + 86, ghost + 12, 10);
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(NET_X + 56, ghost + 4); g.lineTo(NET_X + 116, ghost + 4);
        g.stroke();
        g.restore();
      }
      drawNet(g, nt, T);

      // ギミック：バンパー
      if (gim && gim.id === 'bump' && (gim.on || mode === 'serve')) {
        const a = gim.on ? 1 : 0.45 + Math.sin(T * 6) * 0.2;
        BUMPS.forEach(function (bp) { drawBumper(g, bp, T, a, bp.flash || 0); });
      }

      pads.forEach(function (p, i) {
        // かげ
        g.save(); g.globalAlpha = 0.2;
        g.fillStyle = '#000';
        const k = Math.max(0.3, 1 - (GROUND - PR - p.y) / 700);
        ell(g, p.x, GROUND + 7, PR * k, PR * k * 0.26); g.fill();
        g.restore();
        drawChar(g, p.x, p.y, p.kind, p.face, T + i, p.squash, moodOf(p, i));
      });

      // ラリーが 長いと 風船が 小さく しぼんでいく（重くなったのが 見てわかるように）
      // ※ 文字の ラベルは 出さない（かたちと もようで 見わける）
      const dfk = shrinkK();
      if (!ball.popped) {              // われたら 風船は 消える（火花だけ のこる）
        g.save();
        g.translate(ball.x, ball.y);
        const sk = 1 - dfk * SHRINK_SIZE;
        g.scale(sk, sk);
        drawBalloon(g, 0, 0, ball.type, ball.t, ball.pop, ball.fuse, { deflate: dfk });
        g.restore();
      }

      // 火花・ひかる わ
      rings.forEach(function (rg2) {
        const k = rg2.t / 0.4;
        g.save();
        g.globalAlpha = (1 - k) * 0.9;
        g.lineWidth = 13 * (1 - k) + 2;
        g.strokeStyle = '#fff';
        circ(g, rg2.x, rg2.y, 20 + k * 104); g.stroke();
        g.lineWidth = 7 * (1 - k) + 1;
        g.strokeStyle = rg2.col;
        circ(g, rg2.x, rg2.y, 20 + k * 104); g.stroke();
        g.restore();
      });
      sparks.forEach(function (s) {
        const k = s.t / s.life;
        g.save();
        g.globalAlpha = Math.max(0, 1 - k * k);
        g.fillStyle = '#fff';
        star4(g, s.x, s.y, s.r * (1 - k * 0.5) * 1.35); g.fill();
        g.fillStyle = s.col;
        star4(g, s.x, s.y, s.r * (1 - k * 0.5)); g.fill();
        g.restore();
      });

      pops.forEach(function (p) {
        const a = p.t < 0.8 ? 1 : (1.1 - p.t) / 0.3;
        g.save(); g.globalAlpha = Math.max(0, Math.min(1, a));
        A.text(g, p.txt, p.x, p.y - p.t * 60, { size: 46, color: p.col, stroke: '#fff', strokeWidth: 10 });
        g.restore();
      });
      g.restore();

      if (mode !== 'demo' && mode !== 'guide') drawHud(g);
      if (mode === 'count') drawCount(g);
      // ギミックの よこく（サーブの あいだ ずっと 出す）
      if (gim && !gim.on && mode === 'serve') drawGimWarn(g);
      // スペシャルの 風船しょうかい（カウントダウンの 前）
      if (mode === 'guide') { drawGuide(g); return; }
      if (banner) {
        const a = banner.t < 1.6 ? 1 : (2.2 - banner.t) / 0.6;
        g.save(); g.globalAlpha = Math.max(0, Math.min(1, a));
        A.text(g, banner.txt, W / 2, banner.y, { size: 82, color: banner.col, stroke: '#fff', strokeWidth: 18 });
        if (banner.sub) {
          A.text(g, banner.sub, W / 2, banner.y + 66, { size: 44, color: '#5a4a3a', stroke: '#fff', strokeWidth: 12 });
        }
        g.restore();
      }
    }

    /* ---------- 落ちどころの 目じるし ---------- */
    function drawAim(g) {
      if (!aim.ok) return;
      const col = aim.side === 0 ? '#e2517f' : '#2a93bd';
      // とおり道の 点
      g.save();
      for (let i = 0; i < aim.pts.length; i += 2) {
        const k = i / Math.max(2, aim.pts.length);
        g.globalAlpha = 0.42 * (1 - k * 0.55);
        g.fillStyle = '#fff';
        circ(g, aim.pts[i], aim.pts[i + 1], 9.5 - k * 3.5); g.fill();
        g.fillStyle = col;
        circ(g, aim.pts[i], aim.pts[i + 1], 6.5 - k * 2.5); g.fill();
      }
      g.restore();
      // 地面の わっか
      const pulse = 0.88 + Math.sin(T * 7) * 0.12;
      g.save();
      g.translate(aim.x, GROUND + 10);
      g.globalAlpha = 0.34;
      g.fillStyle = col;
      ell(g, 0, 0, 78 * pulse, 24 * pulse); g.fill();
      g.globalAlpha = 1;
      g.lineWidth = 12; g.strokeStyle = 'rgba(255,255,255,0.9)';
      ell(g, 0, 0, 78 * pulse, 24 * pulse); g.stroke();
      g.lineWidth = 7; g.strokeStyle = col;
      ell(g, 0, 0, 78 * pulse, 24 * pulse); g.stroke();
      g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,0.85)';
      ell(g, 0, 0, 34, 11); g.stroke();
      g.lineWidth = 4; g.strokeStyle = col;
      ell(g, 0, 0, 34, 11); g.stroke();
      g.restore();
      // 下むきの 矢印
      g.save();
      const ay = GROUND - 66 - Math.abs(Math.sin(T * 5)) * 16;
      g.fillStyle = '#fff'; g.strokeStyle = '#fff';
      arrow(g, aim.x, ay - 40, aim.x, ay + 8, 13);
      g.fillStyle = col; g.strokeStyle = col;
      arrow(g, aim.x, ay - 38, aim.x, ay + 5, 8);
      g.restore();
    }

    /* ---------- ギミックの よこく ---------- */
    function drawGimWarn(g) {
      const d = GIM[gim.id];
      const blink = 0.62 + Math.abs(Math.sin(T * 5)) * 0.38;
      const bw = 700, bh = 136, bx = W / 2 - bw / 2, by = 342;
      g.save();
      g.globalAlpha = 0.96;
      A.roundRect(g, bx, by, bw, bh, 26);
      g.fillStyle = 'rgba(255,255,255,0.95)'; g.fill();
      g.lineWidth = 9; g.strokeStyle = d.col; g.globalAlpha = blink; g.stroke();
      g.globalAlpha = 1;
      // 注意マーク
      g.save();
      g.translate(bx + 72, by + bh / 2);
      g.scale(1.02, 1.02);
      g.lineJoin = 'round';
      g.beginPath(); g.moveTo(0, -40); g.lineTo(42, 32); g.lineTo(-42, 32); g.closePath();
      g.fillStyle = '#ffd23f'; g.fill();
      g.lineWidth = 6; g.strokeStyle = INK; g.stroke();
      A.roundRect(g, -6, -22, 12, 32, 6); g.fillStyle = INK; g.fill();
      circ(g, 0, 20, 6); g.fill();
      g.restore();
      A.text(g, 'つぎは ' + d.name + '！', bx + 400, by + 46, { size: 52, color: d.col });
      A.text(g, d.hint, bx + 400, by + 100, { size: 36, color: '#5a4a3a' });
      g.restore();
    }

    /* ---------- かぜの 向きが かわる よこく ----------
       「急に 右から 左に なる」を 入れたが、小さい子も あそぶので
       かならず かわる 1.5秒 前から これを 出す（突然は なし） */
    function drawWindFlipWarn(g) {
      const k = windFlipWarn();
      const next = -gim.dir;                 // つぎの 向き
      const blink = 0.55 + Math.abs(Math.sin(T * 10)) * 0.45;
      const bw = 820, bh = 128, bx = W / 2 - bw / 2, by = 292;
      g.save();
      A.roundRect(g, bx, by, bw, bh, 26);
      g.fillStyle = 'rgba(255,255,255,0.95)'; g.fill();
      g.lineWidth = 10; g.strokeStyle = '#e8264a';
      g.globalAlpha = blink; g.stroke();
      g.globalAlpha = 1;
      // つぎの 向きの ふとい矢印
      g.save();
      g.translate(bx + 116, by + bh / 2);
      g.fillStyle = '#e8264a'; g.strokeStyle = '#e8264a';
      arrow(g, -next * 62, 0, next * 62, 0, 18);
      g.restore();
      A.text(g, 'かぜが ' + (next > 0 ? 'みぎ' : 'ひだり') + 'むきに かわる！', bx + 470, by + 46,
        { size: 50, color: '#e8264a' });
      // のこり時間の バー（これが いっぱいに なったら かわる）
      g.save();
      A.roundRect(g, bx + 230, by + 84, bw - 300, 16, 8);
      g.fillStyle = 'rgba(0,0,0,.14)'; g.fill();
      A.roundRect(g, bx + 230, by + 84, (bw - 300) * k, 16, 8);
      g.fillStyle = '#e8264a'; g.fill();
      g.restore();
      g.restore();
    }

    /* ---------- スペシャルの 風船しょうかい（スタートの 前に どんと 1回） ---------- */
    function drawGuide(g) {
      g.save();
      g.fillStyle = 'rgba(16,30,44,0.62)';
      g.fillRect(0, 0, W, H);

      A.text(g, 'とくべつな 風船が 6しゅるい！', W / 2, 96,
        { size: 66, color: '#ffffff', stroke: '#2a93bd', strokeWidth: 18 });
      A.text(g, 'かたちと もようで 見わけよう', W / 2, 160,
        { size: 34, color: '#ffe9a8', stroke: 'rgba(20,40,56,0.9)', strokeWidth: 8 });

      // 風船は ぜんぶ 同じ ばい率で 描く。
      //「おおきい」「ちいさい」は 大きさの ちがいが そのまま 見わけかたなので、
      // ここで そろえて しまっては 意味が ない。
      const cardW = 520, cardH = 300, gapX = 26, gapY = 22;
      const x0 = (W - (cardW * 3 + gapX * 2)) / 2, y0 = 190;
      BALLOON_IDS.forEach(function (ty, i) {
        const b = BALLOONS[ty];
        const cxx = x0 + (i % 3) * (cardW + gapX);
        const cyy = y0 + Math.floor(i / 3) * (cardH + gapY);
        g.save();
        A.roundRect(g, cxx, cyy, cardW, cardH, 26);
        g.fillStyle = 'rgba(255,255,255,0.96)'; g.fill();
        g.lineWidth = 8; g.strokeStyle = b.col2; g.stroke();
        g.restore();
        g.save();
        g.translate(cxx + cardW / 2, cyy + 100);
        drawBalloon(g, 0, 0, ty, T + i * 0.7, 0, 0.62, { compact: true });
        g.restore();
        A.text(g, b.name, cxx + cardW / 2, cyy + 232, { size: 42, color: b.deep });
        A.text(g, b.hint, cxx + cardW / 2, cyy + 272, { size: 26, color: '#5a4a3a' });
      });

      A.text(g, WIN_SCORE + 'てん さきに とったら かち！', W / 2, 852,
        { size: 54, color: '#ffffff', stroke: '#e2517f', strokeWidth: 16 });
      // いきなり われた、に ならないように ここで ルールを 言っておく
      A.text(g, RALLY_BURST + 'びょう ラリーが つづくと 風船が われる！　のこり ' + RALLY_WARN + 'びょうから 数字が 出るよ',
        W / 2, 910, { size: 29, color: '#ffd23f', stroke: 'rgba(20,40,56,0.92)', strokeWidth: 9 });
      A.text(g, gimAllowed() ? 'ギミックも 出るよ（かならず よこくが 出ます）' : 'ギミックは 出ません',
        W / 2, 954, { size: 26, color: '#d8ecf6', stroke: 'rgba(20,40,56,0.9)', strokeWidth: 8 });
      A.text(g, 'なにか おすと すすむよ', W / 2, 994,
        { size: 24, color: '#ffffff', stroke: 'rgba(20,40,56,0.9)', strokeWidth: 8 });
      // ほうっておいても すすむので、のこりを バーで 見せる
      const k = Math.max(0, Math.min(1, 1 - guideT / GUIDE_TIME));
      const bw = 700, bx = W / 2 - bw / 2;
      A.roundRect(g, bx, 1026, bw, 10, 5);
      g.fillStyle = 'rgba(255,255,255,0.28)'; g.fill();
      A.roundRect(g, bx, 1026, bw * k, 10, 5);
      g.fillStyle = '#5ec2e8'; g.fill();
      g.restore();
    }

    function drawHud(g) {
      const names = nameOf();
      // スコアの 箱。右上には 音・ぜんがめんの ボタンが あるので、2P の箱は そこまで 寄せない。
      // あいだの 410〜1130 を「ルールの 帯」に つかう
      const SB = [40, 1140], SBW = 360;
      [0, 1].forEach(function (i) {
        const x = SB[i];
        g.save();
        A.roundRect(g, x, 20, SBW, 104, 22);
        g.fillStyle = 'rgba(255,255,255,.93)'; g.fill();
        g.strokeStyle = i === 0 ? '#e2517f' : '#2a93bd'; g.lineWidth = 7; g.stroke();
        g.restore();
        A.text(g, names[i], x + 24, 50, { size: 26, color: '#7a6a5a', align: 'left' });
        A.text(g, String(score[i]), x + 24, 92, { size: 54, color: i === 0 ? '#e2517f' : '#2a93bd', align: 'left' });
        // 「/ 5」＝5点先取が ずっと 見えている
        A.text(g, '/ ' + WIN_SCORE, x + 68, 97, { size: 30, color: '#9a8a7a', align: 'left' });
        // あと何点
        const left = WIN_SCORE - score[i];
        if (left <= 2 && left > 0 && !finished) {
          A.text(g, 'あと ' + left, x + SBW - 20, 92, { size: 34, color: '#c79a0a', align: 'right' });
        }
      });

      const HX = 770;            // スコアの 箱に かからない まん中
      let yy = 92;               // 下に つみ重ねて いく ための y
      let timeY = 56;            // のこり時間＋かちの じょうけん の y
      /* ---- いま 飛んでいる 風船は 何で、何が 起きるのか（スペシャルは ずっと 出す） ----
         文字ラベルを 風船の 上から 消した ぶん、ここを 遠くからでも 読める 大きさに した。
         はこの 中の アイコンは しゅるいに よらず 同じ 大きさ（はんけい36）に そろえる。
         大きい／小さいの ちがいは 名前で 読めるので、はこから はみ出さない ほうを とった。 */
      if (special) {
        const b = bt();
        const pw = 720, px = HX - pw / 2;
        g.save();
        A.roundRect(g, px, 12, pw, 118, 26);
        g.fillStyle = 'rgba(255,255,255,.95)'; g.fill();
        g.lineWidth = 8; g.strokeStyle = b.col2; g.stroke();
        g.restore();
        g.save();
        g.translate(px + 84, 74);
        const isc = 36 / b.r;
        g.scale(isc, isc);
        drawBalloon(g, 0, 0, ball.type, T, 0, ball.fuse, { compact: true, deflate: shrinkK() });
        g.restore();
        A.text(g, b.name, px + 170, 52, { size: 46, color: b.deep, align: 'left' });
        A.text(g, b.hint, px + 170, 100, { size: 29, color: '#5a4a3a', align: 'left' });
        timeY = 162;             // はこの 下に 出す（かさならない ように）
        yy = 190;
      }
      // のこり時間＋かちの じょうけん（えんちょうのときは 文字）
      const left = Math.max(0, Math.ceil(MATCH_TIME - matchT));
      const mm = Math.floor(left / 60), ss = left % 60;
      A.text(g,
        (overtime ? 'えんちょう' : ('のこり ' + mm + ':' + (ss < 10 ? '0' : '') + ss)) +
        '　／　' + WIN_SCORE + 'てん さきに とったら かち',
        HX, timeY, { size: 34, color: overtime ? '#c79a0a' : '#4a5a64', stroke: '#fff', strokeWidth: 9 });

      // ギミックが うごいている あいだの 表示（のこり時間つき）
      if (gim && gim.on) {
        const d = GIM[gim.id];
        const k = Math.max(0, 1 - gim.t / gim.dur);
        const bw = 520, bx = HX - bw / 2, by = yy;
        g.save();
        A.roundRect(g, bx, by, bw, 66, 18);
        g.fillStyle = 'rgba(255,255,255,.92)'; g.fill();
        g.lineWidth = 6; g.strokeStyle = d.col; g.stroke();
        g.restore();
        const nm = d.name + (gim.id === 'wind' ? (gim.dir > 0 ? '　→（みぎへ）' : '　←（ひだりへ）') : '');
        A.text(g, nm, bx + bw / 2, by + 27, { size: 34, color: d.col });
        g.save();
        A.roundRect(g, bx + 24, by + 48, bw - 48, 9, 4.5);
        g.fillStyle = 'rgba(0,0,0,.12)'; g.fill();
        A.roundRect(g, bx + 24, by + 48, (bw - 48) * k, 9, 4.5);
        g.fillStyle = d.col; g.fill();
        g.restore();
        yy += 78;
      }

      /* ---- しぼみの 段階 ----
         1段階目：しぼんできた という 知らせだけ。
         2段階目（のこり10びょう）：秒数を 数字で カウントダウンする。
         作者いわく「勝手に われて 点を 取られるのは 不憫」なので、
         ・あと何秒か（数字）
         ・何が 起きるか（われる）
         ・どうすれば 助かるか（相手がわへ おくる）
         の 3つを ぜんぶ 出す。のこり3びょうからは 大きく・赤く・はやい 点めつに する。 */
      if (shStage === 1 && mode === 'play') {
        const col = '#d8622a';
        const k = 1 - shrinkK();                 // のこりの「空気」
        const bw = 620, bx = HX - bw / 2, by = yy;
        g.save();
        A.roundRect(g, bx, by, bw, 74, 20);
        g.fillStyle = 'rgba(255,255,255,.93)'; g.fill();
        g.lineWidth = 8; g.strokeStyle = col; g.stroke();
        g.restore();
        A.text(g, 'しぼんできた！ おもい・ふらふら', bx + bw / 2, by + 28, { size: 33, color: col });
        g.save();
        A.roundRect(g, bx + 26, by + 50, bw - 52, 14, 7);
        g.fillStyle = 'rgba(0,0,0,.14)'; g.fill();
        A.roundRect(g, bx + 26, by + 50, (bw - 52) * k, 14, 7);
        g.fillStyle = col; g.fill();
        g.restore();
      } else if (shStage === 2 && mode === 'play') {
        const secL = burstLeft();
        const urgent = secL <= 3;                // のこり3びょうからは つよく
        const col = urgent ? '#ff1744' : '#e8264a';
        const k = 1 - shrinkK();
        const blink = 0.55 + Math.abs(Math.sin(T * (urgent ? 17 : 9))) * 0.45;
        const bw = 760, bh = 106, bx = HX - bw / 2, by = yy;
        g.save();
        if (urgent) {                            // すこし 大きく 見せる
          g.translate(HX, by + bh / 2);
          g.scale(1.06, 1.06);
          g.translate(-HX, -(by + bh / 2));
        }
        g.save();
        A.roundRect(g, bx, by, bw, bh, 22);
        g.fillStyle = 'rgba(255,255,255,.95)'; g.fill();
        g.lineWidth = urgent ? 11 : 8; g.strokeStyle = col;
        g.globalAlpha = blink; g.stroke();
        g.restore();
        // のこり秒数（大きい 数字）
        circ(g, bx + 58, by + 48, 37);
        g.fillStyle = col; g.globalAlpha = 0.14; g.fill(); g.globalAlpha = 1;
        g.lineWidth = 5; g.strokeStyle = col; g.stroke();
        A.text(g, String(secL), bx + 58, by + 50, { size: urgent ? 60 : 54, color: col });
        // 何が 起きるか／どうすれば 助かるか
        A.text(g, 'あと ' + secL + 'びょうで われる！', bx + 118, by + 32,
          { size: urgent ? 38 : 34, color: col, align: 'left' });
        A.text(g, '相手がわへ おくろう！', bx + 118, by + 70,
          { size: 27, color: '#5a4a3a', align: 'left' });
        // のこりの 空気の バー（0 に なると われて、風船が ある がわの 失点）
        g.save();
        A.roundRect(g, bx + 20, by + 90, bw - 40, 10, 5);
        g.fillStyle = 'rgba(0,0,0,.14)'; g.fill();
        A.roundRect(g, bx + 20, by + 90, (bw - 40) * k, 10, 5);
        g.fillStyle = col; g.fill();
        g.restore();
        g.restore();
      }
      // 操作の あんない（最初の 12秒だけ）
      if (matchT < 12 && !finished) {
        const a = matchT > 10 ? (12 - matchT) / 2 : 1;
        g.save(); g.globalAlpha = a;
        A.text(g, 'A / D うごく　W ジャンプ', (WALL_L + NET_X) / 2, GROUND + 44, { size: 34, color: '#8a6a4a', stroke: '#fff', strokeWidth: 8 });
        A.text(g, cpuLv ? 'CPU' : '← / → うごく　↑ ジャンプ', (NET_X + WALL_R) / 2, GROUND + 44, { size: 34, color: '#8a6a4a', stroke: '#fff', strokeWidth: 8 });
        g.restore();
      }
    }

    function drawCount(g) {
      const left = Math.ceil(COUNT_TIME - cd);
      const txt = left <= 0 ? 'スタート！' : String(left);
      const k = 1 - ((COUNT_TIME - cd) % 1);
      g.save();
      g.fillStyle = 'rgba(0,0,0,.26)'; g.fillRect(0, 0, W, H);
      g.translate(W / 2, H / 2 - 60);
      g.scale(1 + k * 0.25, 1 + k * 0.25);
      A.text(g, txt, 0, 0, { size: left <= 0 ? 150 : 210, color: '#fff', stroke: '#5ec2e8', strokeWidth: 20 });
      g.restore();
      A.text(g, WIN_SCORE + 'てん さきに とったら かち！', W / 2, H / 2 + 150, {
        size: 52, color: '#2a93bd', stroke: '#fff', strokeWidth: 12,
      });
    }

    /* =========================================================
       エンジンとの やりとり
       ========================================================= */
    const inst = {
      start: function (opts) {
        reset(opts);
        // スペシャルだけ、カウントダウンの 前に 6しゅるいの しょうかいを 出す。
        // ノーマルでは 出さない（風船が 1しゅるいだけなので じゃまに なる）
        if (guideNeeded()) { mode = 'guide'; guideT = 0; }
        else { mode = 'count'; }
        cd = 0;
        api.setCursor('default');
      },
      update: update,
      draw: draw,
      // しょうかい画面は キー／クリックでも すすめられる
      // （画面が 出た ちょくごの 入力は 読まない。モードを えらんだ ときの 1回を ひろわないため）
      onKeyDown: function () { if (mode === 'guide' && guideT > GUIDE_SKIP_AFTER) endGuide(); },
      onPointerDown: function () { if (mode === 'guide' && guideT > GUIDE_SKIP_AFTER) endGuide(); },
      debug: {
        get mode() { return mode; },
        get score() { return score.slice(); },
        get ball() {
          return { x: Math.round(ball.x), y: Math.round(ball.y), vx: Math.round(ball.vx), vy: Math.round(ball.vy), type: ball.type, live: ball.live, fuse: +ball.fuse.toFixed(3) };
        },
        get pads() { return pads.map(function (p) { return { x: Math.round(p.x), y: Math.round(p.y), air: p.air }; }); },
        get stats() { return JSON.parse(JSON.stringify(stats)); },
        get special() { return special; },
        get cpuLv() { return cpuLv; },
        get finished() { return finished; },
        setHold: function (v) { hold = !!v; },
        setBot: function (i, v) { bot[i] = !!v; },
        clearCool: function () { pads.forEach(function (p) { p.cool = 0; }); },
        setPad: function (i, x) { pads[i].x = x; pads[i].vx = 0; },
        get rallyT() { return +rallyT.toFixed(2); },
        get shrink() { return +shrinkMul().toFixed(3); },
        /* --- R6+ しぼみ・しょうかい画面の かくにん用（ふやした ぶん） --- */
        get shrinkK() { return +shrinkK().toFixed(3); },
        get ballR() { return Math.round(bRad()); },
        get shrinkHit() { return +shrinkHit().toFixed(3); },
        get stage() { return shStage; },
        get guideT() { return +guideT.toFixed(2); },
        skipGuide: endGuide,
        // ラリー時間だけ 0 に もどす（風船を ピンピンの じょうたいに する）。
        // テストで「ふつうの 風船を 返せるか」を 測るときに つかう
        resetRally: function () { rallyT = 0; shStage = 0; lastTick = -1; ball.popped = false; },
        get rallyConsts() {
          return {
            SHRINK: RALLY_SHRINK, HARD: RALLY_HARD, BURST: RALLY_BURST,
            WARN: RALLY_WARN, MAX: RALLY_MAX, GUIDE: GUIDE_TIME,
          };
        },
        // われるまでの のこり秒数（画面に 出ている 数字と 同じもの）
        get burstLeft() { return burstLeft(); },
        get windWarn() { return +windFlipWarn().toFixed(3); },
        beginPlay: function () { cd = COUNT_TIME; serve(0); },
        setScore: function (a, b2) { score[0] = a; score[1] = b2; },
        serveNow: function (side) { serve(side || 0); },
        setBall: function (o) {
          if (o.x != null) ball.x = o.x;
          if (o.y != null) ball.y = o.y;
          if (o.vx != null) ball.vx = o.vx;
          if (o.vy != null) ball.vy = o.vy;
          if (o.type) ball.type = o.type;
          if (o.live != null) ball.live = !!o.live;
        },
        pickType: pickType,
        consts: { WIN_SCORE: WIN_SCORE, GROUND: GROUND, NET_X: NET_X, PR: PR, HIT_SPEED: HIT_SPEED, MATCH_TIME: MATCH_TIME, CEIL: CEIL, NET_TOP: NET_TOP },
        types: function () { return BALLOON_IDS.slice(); },
        /* --- ここから 下は R6 で ふやした ぶん（絵・ギミックの かくにん用） --- */
        gims: function () { return GIM_IDS.slice(); },
        get gim() {
          return gim ? {
            id: gim.id, dir: gim.dir, on: gim.on, t: +gim.t.toFixed(2), dur: gim.dur,
            flipAt: gim.flipAt, flips: gim.flips, warned: !!gim.warned,
          } : null;
        },
        setGim: function (id, dir) {
          gim = makeGim(id, dir);
          if (gim) { serveWait = SERVE_WAIT_GIM; lastGim = id; }
        },
        startGim: function () { if (gim) { gim.on = true; gim.t = 0; } },
        get netTop() { return Math.round(netTop()); },
        get aim() { return { x: Math.round(aim.x), side: aim.side, ok: aim.ok }; },
        get bumps() { return BUMPS.map(function (b2) { return { x: b2.x, y: b2.y, r: b2.r }; }); },
        setMood: function (i, m) { pads[i].hitT = (m === 'hit') ? 0.26 : 0; },
        setMode: function (m) { mode = m; },
      },
    };
    return inst;
  }
})();
