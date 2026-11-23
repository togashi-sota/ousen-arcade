/* =========================================================
   Arcade エンジン（共通基盤）
   - 1920x1080 の仮想ステージを画面に合わせて拡大縮小
   - ゲーム選択 → あそびかた → プレイ → 結果 の画面遷移を統一
   - 入力（キーボード/マウス）、一時停止、確認ダイアログ、全画面、保存
   各ゲームは games/<id>/game.js で Arcade.register({...}) を呼ぶ。
   仕様は dev/CONTRACT.md を参照。
   ========================================================= */
(function () {
  'use strict';

  const W = 1920, H = 1080;
  const STEP = 1 / 120;
  const FONT = '"BIZ UDPGothic","Yu Gothic UI","Yu Gothic","Meiryo","Hiragino Kaku Gothic ProN",sans-serif';
  const params = new URLSearchParams(location.search);
  const AUDIO = window.ArcadeAudio;

  const $ = function (id) { return document.getElementById(id); };

  /* ---------------- 保存（端末内のみ） ---------------- */
  // R4：文化祭中に作った新しい版。前の版（ousenArcade2026.*）とは保存先を分ける（前の版には書きこまない）
  const PREFIX = 'ousenArcadeWeb.';
  const OLD_PREFIX = 'ousenArcadeWeb__none.';
  const mem = {};
  const store = {
    get: function (key, def) {
      try {
        const v = localStorage.getItem(PREFIX + key);
        return v === null ? (key in mem ? mem[key] : def) : JSON.parse(v);
      } catch (e) { return key in mem ? mem[key] : def; }
    },
    set: function (key, val) {
      mem[key] = val;
      try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); } catch (e) { /* 保存できなくても続行 */ }
    },
  };

  /* ---------------- 乱数（シード付き） ---------------- */
  function rng(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    return function () {
      s += 0x6D2B79F5;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- 描画ヘルパー ---------------- */
  function font(size, weight) { return (weight || 'bold') + ' ' + Math.round(size) + 'px ' + FONT; }
  function roundRect(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  // text(g, "文字", x, y, {size, color, align, baseline, stroke, strokeWidth, weight, shadow})
  function text(g, str, x, y, o) {
    o = o || {};
    g.save();
    g.font = font(o.size || 40, o.weight);
    g.textAlign = o.align || 'center';
    g.textBaseline = o.baseline || 'middle';
    g.lineJoin = 'round';
    if (o.shadow) {
      g.fillStyle = o.shadow;
      if (o.stroke) { g.strokeStyle = o.shadow; g.lineWidth = o.strokeWidth || 10; g.strokeText(str, x, y + (o.shadowOffset || 6)); }
      g.fillText(str, x, y + (o.shadowOffset || 6));
    }
    if (o.stroke) {
      g.strokeStyle = o.stroke;
      g.lineWidth = o.strokeWidth || 10;
      g.strokeText(str, x, y);
    }
    g.fillStyle = o.color || '#3b2f4a';
    g.fillText(str, x, y);
    g.restore();
  }

  /* ---------------- 状態 ---------------- */
  const defs = [];
  const byId = {};
  let canvas, g, stage;
  let scale = 1, pxScale = 1;
  let phase = 'boot';        // menu | intro | play | result
  let def = null;            // 選択中のゲーム定義
  let game = null;           // ゲームインスタンス
  let lastOpts = null;       // リトライ用
  let paused = false;
  let pauseReason = null;    // 'blur' | 'confirm' | 'menu'
  let resumeTimer = 0;
  let resultLockUntil = 0;
  let gtime = 0;
  let acc = 0;
  let menuFocus = 0;
  let introFocus = 0;
  let dialogFocus = 0;       // 0=つづける 1=はい
  let confirmAction = null;
  let errorCount = 0;
  let cursor = 'default';
  let lastInput = 0;          // 最後に操作された時刻（放置で自動的にメニューへ戻す）
  const IDLE_TO_MENU = 60;    // あそびかた・結果画面で 60 秒操作がなければメニューへ
  const RANK = window.ArcadeRank;
  let modePage = null;        // 2段メニュー：ひらいている親モード（null = 1段目）
  let rankFrom = 'intro';     // ランキング画面を閉じたときの戻り先
  let rankBoard = 0, rankDay = 0, rankHi = -1;  // ランキング画面の選択状態
  let pendingReg = null;      // 結果画面：ランキング登録まち { boardId, score, pos, day }
  let lastBoard = null;       // 直前のプレイが属するランキングのボード
  let nameCtx = null;         // ニックネーム入力中の状態（step: 'name' → 'age'）
  let hostMode = false;       // ランキング画面のホストモード（Shift + Delete）。記録を消せる
  let hostArm = null;         // ホストモード：二度押し待ちの { kind, i, at }
  let nameLockUntil = 0;      // 入力画面が出た直後のクリックを無視する（連打よけ）
  let menuLockUntil = 0;      // メニューに戻った直後のクリックを無視する（連打よけ）
  const IDLE_STAFF = 60;      // スタッフ画面も 60 秒さわらなければメニューへ戻す
                              // （来場者の前に記録一覧と「ぜんぶ消す」を出したままにしない）
  const keys = new Set();
  const pointer = { x: W / 2, y: H / 2, down: false, inside: false };

  const input = {
    isDown: function (code) { return keys.has(code); },
    anyDown: function () { for (let i = 0; i < arguments.length; i++) if (keys.has(arguments[i])) return true; return false; },
    pointer: pointer,
    clear: function () { keys.clear(); pointer.down = false; },
  };

  /* ---------------- ゲーム登録 ---------------- */
  function register(d) {
    if (!d || !d.id || byId[d.id]) return;
    defs.push(d);
    byId[d.id] = d;
    defs.sort(function (a, b) { return (a.order || 99) - (b.order || 99); });
    // ランキングのボードを登録（ゲーム側は宣言するだけ）
    if (RANK && d.rank && Array.isArray(d.rank.boards)) {
      d.rank.boards.forEach(function (b) {
        RANK.registerBoard({ id: b.id, label: b.label, short: b.short, unit: b.unit, kind: b.kind, game: d.id });
      });
    }
  }

  /* ---------- モード（2段メニュー対応） ---------- */
  function topModes(d) {
    return (d && d.modes && d.modes.length) ? d.modes : [{ id: 'normal', label: 'スタート！' }];
  }
  // リストの中の最初の葉（実際にプレイするモード）を返す
  function firstLeafOf(list) {
    let found = null;
    (function walk(l) {
      (l || []).forEach(function (m) {
        if (found) return;
        if (m.children && m.children.length) walk(m.children);
        else found = m;
      });
    })(list);
    return found;
  }
  // 葉を id で探す。親の id をわたされたら、その親の最初の子を返す
  // （?mode=cpu や Arcade.debug.start('cpu') でも遊べるように）
  function findLeaf(d, id) {
    if (!id) return null;
    let found = null;
    (function walk(list) {
      (list || []).forEach(function (m) {
        if (found) return;
        if (m.id === id) { found = (m.children && m.children.length) ? firstLeafOf(m.children) : m; return; }
        if (m.children && m.children.length) walk(m.children);
      });
    })(topModes(d));
    return found;
  }
  function firstLeaf(d) { return firstLeafOf(topModes(d)) || { id: 'normal' }; }
  // いま表示するボタン列（1段目 or 2段目）
  function currentModeList() {
    if (modePage && modePage.children) return modePage.children;
    return topModes(def);
  }

  /* ---------------- ゲームへ渡す API ---------------- */
  function makeApi(d) {
    return {
      W: W, H: H, FONT: FONT, def: d,
      input: input,
      audio: AUDIO,
      sfx: function (n, o) { AUDIO.sfx(n, o); },
      store: store,
      params: params,
      rng: rng,
      font: font,
      text: text,
      roundRect: roundRect,
      get time() { return gtime; },
      get phase() { return phase; },
      get paused() { return paused; },
      setCursor: function (c) { cursor = c || 'default'; applyCursor(); },
      finish: function (r) { finishGame(d, r); },
      toast: toast,
    };
  }

  function safe(fn, where) {
    try { return fn(); } catch (e) {
      errorCount++;
      console.error('[Arcade] ' + where, e);
      if (errorCount > 3 && phase !== 'menu') {
        errorCount = 0;
        toast('エラーが出たので メニューにもどります');
        goMenu();
      }
    }
    return undefined;
  }

  /* ---------------- 画面サイズ ---------------- */
  function resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    scale = Math.min(vw / W, vh / H);
    const ox = Math.round((vw - W * scale) / 2), oy = Math.round((vh - H * scale) / 2);
    stage.style.transform = 'translate(' + ox + 'px,' + oy + 'px) scale(' + scale + ')';
    const dpr = window.devicePixelRatio || 1;
    pxScale = Math.min(2, Math.max(0.5, scale * dpr));
    const cw = Math.round(W * pxScale), ch = Math.round(H * pxScale);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    document.querySelectorAll('.card canvas').forEach(function (c) {
      const tw = Math.round(552 * pxScale), th = Math.round(300 * pxScale);
      if (c.width !== tw) { c.width = tw; c.height = th; }
    });
  }

  function toVirtual(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  }

  function applyCursor() {
    canvas.style.cursor = (phase === 'play' && !paused) ? cursor : 'default';
  }

  /* ---------------- 画面切替 ---------------- */
  const SCREENS = ['screen-menu', 'screen-intro', 'screen-result', 'screen-rank', 'screen-staff'];
  function showOnly(id) {
    SCREENS.forEach(function (s) { $(s).hidden = (s !== id); });
  }

  function setTheme(d) {
    const st = document.documentElement.style;
    const th = (d && d.theme) || { main: '#ff7fa8', dark: '#e2517f', light: '#ffe6ef' };
    st.setProperty('--theme', th.main);
    st.setProperty('--theme-dark', th.dark);
    st.setProperty('--theme-light', th.light);
  }

  function destroyGame() {
    if (game && game.destroy) safe(function () { game.destroy(); }, 'destroy');
    game = null;
  }

  function goMenu() {
    destroyGame();
    hideOverlays();
    paused = false;
    cursor = 'default';
    def = null;
    modePage = null;
    pendingReg = null;
    nameCtx = null;
    rankHi = -1;
    $('overlay-name').hidden = true;
    // 「ほかのゲーム」の連打で、そのままカードを押してしまわないように
    menuLockUntil = performance.now() + 350;
    phase = 'menu';
    setTheme(null);
    showOnly('screen-menu');
    $('tb-menu').hidden = true;
    updateModeBadge();
    refreshCards();
    fitCardText();
    focusCard(menuFocus);
    AUDIO.playBgm('menu');
    applyCursor();
  }

  function openIntro(d) {
    destroyGame();
    hideOverlays();
    paused = false;
    def = d;
    setTheme(d);
    cursor = 'default';
    errorCount = 0;
    game = safe(function () { return d.create(makeApi(d)); }, 'create');
    if (!game) { goMenu(); return; }
    phase = 'intro';
    acc = 0;
    // あそびかた
    $('intro-title').textContent = d.title;
    $('intro-catch').textContent = d.catch || '';
    $('intro-tags').innerHTML = (d.tags || []).map(function (t) { return '<span class="tag">' + t + '</span>'; }).join('');
    $('intro-howto').innerHTML = (d.howto || []).map(function (h) {
      return '<div class="howto-row"><div class="howto-icon">' + (h.icon || '') + '</div><div class="howto-text">' + h.html + '</div></div>';
    }).join('');
    // あそびかた画面にもハイスコアは出さない（「ランキングを みる」で見てもらう）
    $('intro-best').innerHTML = '';
    modePage = null;
    renderModes();
    $('intro-rank').hidden = !(RANK && d.rank);
    showOnly('screen-intro');
    $('tb-menu').hidden = false;
    AUDIO.playBgm(d.bgm || null);
    applyCursor();
  }

  // あそびかた画面のモードボタンを描き直す（2段メニュー）
  function renderModes() {
    const wrap = $('intro-buttons');
    const list = currentModeList();
    // ボタンが多いときは小さめにしてはみ出さないようにする（「← もどる」も数に入れる）
    // R4：def.modesCompact（ホッケー：親が3つ）は 3つでも小さめにして 1行に収める
    const nb = list.length + (modePage ? 1 : 0);
    wrap.className = 'intro-buttons' + ((nb >= 4 || (nb >= 3 && def && def.modesCompact)) ? ' many' : '');
    wrap.innerHTML = '';
    list.forEach(function (m, i) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (i === 0 ? 'btn-main' : 'btn-sub');
      b.innerHTML = esc(m.label) + (m.sub ? '<span class="mode-sub">' + esc(m.sub) + '</span>' : '') +
        (m.recommend ? '<span class="mode-badge">はじめての人に おすすめ</span>' : '');
      b.addEventListener('click', function () { pickMode(m); });
      b.addEventListener('mouseenter', function () { introFocus = i; markFocus(wrap.children, i); showDesc(); });
      wrap.appendChild(b);
    });
    if (modePage) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'btn btn-ghost';
      back.textContent = '← もどる';
      back.addEventListener('click', function () { AUDIO.sfx('back'); modePage = null; renderModes(); });
      wrap.appendChild(back);
    }
    introFocus = 0;
    markFocus(wrap.children, 0);
    showDesc();
  }
  function showDesc() {
    const list = currentModeList();
    const m = list[introFocus];
    $('intro-desc').textContent = (m && m.desc) ? m.desc : '';
  }
  // ボタンが押された。子があれば 2 段目へ、なければプレイ開始。
  function pickMode(m) {
    if (!m) return;
    if (m.children && m.children.length) {
      AUDIO.unlock();
      AUDIO.sfx('select');
      modePage = m;
      renderModes();
      return;
    }
    startPlay(m);
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function startPlay(mode, isRetry) {
    if (!def) return;
    AUDIO.unlock();
    const d = def;
    const opts = { mode: mode ? mode.id : 'normal', retry: !!isRetry };
    lastOpts = opts;
    if (isRetry || phase === 'result') {
      destroyGame();
      cursor = 'default';
      game = safe(function () { return d.create(makeApi(d)); }, 'create');
      if (!game) { goMenu(); return; }
    }
    hideOverlays();
    paused = false;
    phase = 'play';
    acc = 0;
    input.clear();
    showOnly(null);
    $('tb-menu').hidden = false;
    if (!isRetry) AUDIO.sfx('decide');
    if (AUDIO.currentBgm !== (d.bgm || null)) AUDIO.playBgm(d.bgm || null);
    safe(function () { game.start(opts); }, 'start');
    applyCursor();
  }

  function retry() {
    if (!def || !lastOpts) return;
    const m = findLeaf(def, lastOpts.mode) || { id: lastOpts.mode };
    AUDIO.sfx('decide');
    startPlay(m, true);
  }

  // 自己ベストの 1 行。def.bestHtml があればそちらを使う（コース別などに対応）
  function bestLine(d, withToday) {
    if (d.bestHtml) { try { return d.bestHtml(store) || ''; } catch (e) { return ''; } }
    if (!d.best) return '';
    const v = store.get(d.best.key, null);
    if (v === null || v === undefined) return d.best.label + '：まだ きろくなし';
    let s = d.best.label + '：<b>' + formatScore(d, v) + '</b>';
    const tl = todayRank(d);
    if (withToday && tl.length) s += '　／　きょうの 1い：<b>' + formatScore(d, tl[0]) + '</b>';
    return s;
  }
  // そのプレイの自己ベスト保存キー（モードごとに分けられる）
  function bestKey(d, opts) {
    if (!d.best) return null;
    if (d.best.keyOf) { try { return d.best.keyOf(opts || lastOpts || { mode: 'normal' }); } catch (e) { /* 落ちない */ } }
    return d.best.key || null;
  }

  /* ---------------- きょうのランキング（この PC だけ・上位5つ・点数のみ） ---------------- */
  function todayKey() { const t = new Date(); return t.getFullYear() + '-' + (t.getMonth() + 1) + '-' + t.getDate(); }
  function todayRank(d) {
    const r = store.get('rank.' + d.id, null);
    if (!r || r.date !== todayKey() || !Array.isArray(r.list)) return [];
    return r.list.filter(function (v) { return typeof v === 'number' && isFinite(v); });
  }
  function addRank(d, score) {
    const list = todayRank(d).slice();
    let pos = list.findIndex(function (v) { return score > v; });
    if (pos < 0) pos = list.length;
    list.splice(pos, 0, score);
    const top = list.slice(0, 5);
    store.set('rank.' + d.id, { date: todayKey(), list: top });
    return { pos: pos < 5 ? pos + 1 : 0, list: top };
  }
  function rankHtml(d, rk) {
    if (!rk || !rk.list.length) return '';
    let html = '<span class="rank-title">きょうの ランキング</span>';
    rk.list.forEach(function (v, i) {
      html += '<span class="rank-chip' + (i + 1 === rk.pos ? ' me' : '') + '"><i>' + (i + 1) + '</i>' + formatScore(d, v) + '</span>';
    });
    return html;
  }
  function formatScore(d, v) {
    if (d.best && d.best.format) return d.best.format(v);
    return v + ((d.best && d.best.unit) || '');
  }

  // r = { ribbon, headline, big, sub, score, delay }
  function finishGame(d, r) {
    if (phase !== 'play' || d !== def) return;
    r = r || {};
    phase = 'result';
    paused = false;
    hideOverlays();
    pendingReg = null;
    const hasScore = typeof r.score === 'number' && isFinite(r.score) && r.score > 0;

    // --- 自己ベスト（大きいほど良い）。0 は記録しない ---
    let isRecord = false;
    const bk = bestKey(d, lastOpts);
    if (bk && hasScore) {
      const prev = store.get(bk, null);
      if (prev === null || prev === undefined || r.score > prev) { store.set(bk, r.score); isRecord = true; }
    }

    // --- ランキング（ボードがあるゲームだけ） ---
    let boardId = null, pos = 0;
    if (RANK && d.rank && d.rank.boardOf) {
      try { boardId = d.rank.boardOf(lastOpts || { mode: 'normal' }) || null; } catch (e) { boardId = null; }
      if (!boardId || !RANK.board(boardId)) boardId = null;
      else if (hasScore) pos = RANK.rankOf(boardId, r.score);
    }
    lastBoard = boardId;

    // --- 旧方式（ランキングを持たないゲーム用の「きょうの上位5つ」） ---
    let rk = null;
    if (!boardId && d.best && !d.rank) rk = hasScore ? addRank(d, r.score) : { pos: 0, list: todayRank(d) };
    const rankIn = !!(rk && rk.pos > 0);

    $('result-ribbon').textContent = r.ribbon || 'けっか';
    $('result-headline').textContent = r.headline || '';
    $('result-big').textContent = r.big != null ? r.big : (r.score != null ? formatScore(d, r.score) : '');
    $('result-sub').innerHTML = r.sub || '';
    $('result-record').textContent = isRecord ? 'しんきろく！' : (rankIn ? 'きょうの ' + rk.pos + 'い！' : '');
    $('result-record').hidden = !(isRecord || rankIn);
    // 結果画面にもハイスコアは出さない（ランキングで見てもらう）
    $('result-best').innerHTML = '';
    $('result-rank').innerHTML = rk ? rankHtml(d, rk) : '';
    $('result-rank').hidden = !(rk && rk.list.length);

    // ランキングに入るなら「のせる？」、入らなければ ねぎらい＋ランキングを見る導線
    const ask = $('result-ask');
    if (boardId && pos > 0) {
      // 日をここで決めておく（入力中に日付が変わっても、遊んだ日のランキングに入れる）
      const clearList = RANK.isClear(boardId);
      pendingReg = { boardId: boardId, score: r.score, pos: pos, day: RANK.dayId(), clear: clearList };
      $('result-ask-text').textContent = clearList
        ? 'クリア！ なまえを のこす？'
        : 'ランキング ' + pos + 'い！ なまえを のせる？';
      ask.hidden = false;
      $('result-rankview').hidden = true;
    } else {
      ask.hidden = true;
      $('result-rankview').hidden = !boardId && !(d.rank && RANK);
    }

    resultLockUntil = performance.now() + 900;
    setTimeout(function () {
      if (phase !== 'result' || def !== d) return;
      showOnly('screen-result');
      resultLockUntil = performance.now() + 800;   // パネルが出てから 0.8 秒は押せない（連打で飛ばさない）
      dialogFocus = 0;
      markFocus(resultButtons(), 0);
      if (pendingReg) AUDIO.sfx('sparkle');
      else if (isRecord) AUDIO.sfx('newrecord');
      else if (rankIn) AUDIO.sfx('sparkle');
    }, r.delay != null ? r.delay : 700);
    applyCursor();
  }

  // 結果画面でキーボード操作の対象になるボタン列
  function resultButtons() {
    if (pendingReg && !$('result-ask').hidden) return [$('result-reg-yes'), $('result-reg-no')];
    const l = [$('result-retry')];
    if (!$('result-rankview').hidden) l.push($('result-rankview'));
    l.push($('result-menu'));
    return l;
  }
  // 「のせない」を選んだとき
  function declineReg() {
    if (!pendingReg) return;
    pendingReg = null;
    $('result-ask').hidden = true;
    $('result-rankview').hidden = false;
    AUDIO.sfx('back');
    dialogFocus = 0;
    markFocus(resultButtons(), 0);
  }
  // 「のせる」→ ニックネーム入力
  function acceptReg() {
    if (!pendingReg) return;
    const p = pendingReg;
    AUDIO.sfx('decide');
    openName(p, function (name, age) {
      const res = guard(function () { return RANK.add(p.boardId, name, p.score, p.day, age); }, 'rank.add') ||
                  { ok: false, pos: 0, saved: false };
      pendingReg = null;
      $('result-ask').hidden = true;
      $('result-rankview').hidden = false;
      if (res.ok) {
        $('result-record').textContent = p.clear
          ? 'クリアした人 ' + res.pos + '人め！'
          : 'ランキング ' + res.pos + 'い！';
        $('result-record').hidden = false;
        AUDIO.sfx('newrecord');
        if (!res.saved) toast('※ このパソコンに 記録を 保存できませんでした（スタッフに しらせてね）', 6000);
        rankHi = res.pos - 1;
        openRank(p.boardId, p.day, 'result');
      } else {
        toast('ざんねん、ランキングに 入りませんでした');
        dialogFocus = 0;
        markFocus(resultButtons(), 0);
      }
    }, function () {
      // やめる → 結果画面にもどる
      declineReg();
    });
  }

  /* =========================================================
     ランキング画面
     ========================================================= */
  // ランキング画面で いま見ている ゲーム（6本を またいで 見られる）
  let rankGame = null;
  function rankGames() {
    if (!RANK) return [];
    return defs.filter(function (d) { return d.rank && RANK.boardsOf(d.id).length; });
  }
  function rankGameIndex() {
    const gs = rankGames();
    const i = gs.findIndex(function (d) { return d.id === rankGame; });
    return i >= 0 ? i : 0;
  }
  function viewBoards() {
    if (!RANK) return [];
    const gs = rankGames();
    const g = gs[rankGameIndex()];
    const b = g ? RANK.boardsOf(g.id) : [];
    return b.length ? b : RANK.boards();
  }
  function dayIndexOfToday() {
    const id = RANK ? RANK.dayId() : 'test';
    for (let i = 0; i < RANK.DAYS.length; i++) if (RANK.DAYS[i].id === id) return i;
    return 2;
  }
  // 新しい画面で万一エラーが出ても、展示が止まらないようにする
  function guard(fn, where, fallback) {
    try { return fn(); } catch (e) {
      console.error('[Arcade] ' + where, e);
      toast('うまく ひらけませんでした');
      if (fallback) { try { fallback(); } catch (e2) { /* これ以上は何もしない */ } }
    }
    return undefined;
  }

  // boardId / dayId を省略すると「今のコース・今日」を開く
  function openRank(boardId, dayId, from) {
    if (!RANK) return;
    const gs = rankGames();
    if (!gs.length) return;
    rankFrom = from || (phase === 'result' ? 'result' : 'intro');
    // どのゲームの ランキングを 出すか：ボード指定 → いまのゲーム → さいしょのゲーム
    rankGame = null;
    if (boardId) { const bb = RANK.board(boardId); if (bb) rankGame = bb.game; }
    if (!rankGame && def && def.rank) rankGame = def.id;
    if (!rankGame) rankGame = gs[0].id;
    const bs = viewBoards();
    if (!bs.length) return;
    rankBoard = 0;
    if (boardId) { const i = bs.findIndex(function (b) { return b.id === boardId; }); if (i >= 0) rankBoard = i; }
    rankDay = dayId ? Math.max(0, RANK.DAYS.findIndex(function (d) { return d.id === dayId; })) : dayIndexOfToday();
    hostMode = false;
    hostArm = null;
    phase = 'rank';
    lastInput = gtime;
    let bad = false;
    guard(renderRank, 'renderRank', function () { bad = true; });
    if (bad) { phase = def ? 'intro' : 'menu'; return; }
    showOnly('screen-rank');
    $('tb-menu').hidden = false;
    applyCursor();
  }
  // 見せる日のならび。文化祭の当日は「れんしゅう」を来場者に出さない
  // （スタッフ設定からはいつでも見られる）
  function dayVisible(i) {
    const d = RANK.DAYS[i];
    if (!d) return false;
    if (d.id !== 'test') return true;
    return RANK.dayId() === 'test';
  }
  function renderRank() {
    const bs = viewBoards();
    if (rankBoard >= bs.length) rankBoard = 0;
    const b = bs[rankBoard];
    if (!dayVisible(rankDay)) rankDay = dayIndexOfToday();
    // 日で分けない設定のときは、つねに記録が入っている箱を見る
    if (RANK.ONE_LIST) rankDay = dayIndexOfToday();
    const dayObj = RANK.DAYS[rankDay] || RANK.DAYS[2];
    const clearList = RANK.isClear(b.id);
    // 見出しは「いま見ているゲーム」の名前（メニューから ひらいたときは def が ないため）
    const headGame = rankGames()[rankGameIndex()] || def;
    $('rank-head').textContent = clearList
      ? ((headGame ? headGame.shortTitle || headGame.title : '') + '　' + b.label)
      : ((headGame ? headGame.title : '') + ' ランキング');

    // ゲームのタブ（6本を またいで 見られる）
    const gs = rankGames();
    const gt = $('rank-tabs-game');
    gt.innerHTML = '';
    gt.hidden = gs.length < 2;
    if (gs.length >= 2) {
      const gi = rankGameIndex();
      gs.forEach(function (gd, i) {
        const t = document.createElement('button');
        t.type = 'button';
        t.className = 'rank-tab' + (i === gi ? ' on' : '');
        t.textContent = gd.shortTitle || gd.title;
        t.addEventListener('click', function () {
          if (rankGame === gd.id) return;
          rankGame = gd.id; rankBoard = 0; rankHi = -1; AUDIO.sfx('select'); renderRank();
        });
        gt.appendChild(t);
      });
    }

    // コースのタブ（1つしかないときは出さない）
    const tb = $('rank-tabs-board');
    tb.innerHTML = '';
    tb.hidden = bs.length < 2;
    bs.forEach(function (bb, i) {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'rank-tab' + (i === rankBoard ? ' on' : '');
      t.textContent = bb.short || bb.label;
      t.addEventListener('click', function () { if (rankBoard !== i) { rankBoard = i; rankHi = -1; AUDIO.sfx('select'); renderRank(); } });
      tb.appendChild(t);
    });

    // 日のタブ
    const td = $('rank-tabs-day');
    td.innerHTML = '';
    let shown = 0;
    // 日で分けない設定のときは、そもそも 作らない
    (RANK.ONE_LIST ? [] : RANK.DAYS).forEach(function (dd, i) {
      if (!dayVisible(i)) return;
      shown++;
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'rank-tab' + (i === rankDay ? ' on' : '');
      t.textContent = dd.short;
      t.addEventListener('click', function () { if (rankDay !== i) { rankDay = i; rankHi = -1; AUDIO.sfx('select'); renderRank(); } });
      td.appendChild(t);
    });
    td.hidden = RANK.ONE_LIST || shown < 2;

    // ホストモード（記録を消せる）。来場者の画面とは色を変えて、出しっぱなしに気づけるように
    $('screen-rank').classList.toggle('hosting', hostMode);
    $('rank-host').hidden = !hostMode;
    if (hostMode) {
      $('rank-host-msg').textContent = 'ホストモード：' + dayObj.short + '／' + (b.short || b.label) +
        '　消したい記録の ✕ を 2回 おす（数字キー 1〜9・0 でも OK）';
      const ca = $('rank-host-clear');
      ca.textContent = (hostArm && hostArm.kind === 'all') ? 'ほんとうに？ もう一度おす' : 'この一覧を ぜんぶ消す';
      ca.classList.toggle('armed', !!(hostArm && hostArm.kind === 'all'));
      $('rank-host-undo').disabled = !RANK.hasUndo();
    }

    // 一覧（ホストモードでは ぜんぶ出す。多いときは 一覧がスクロールする）
    const all = RANK.list(b.id, dayObj.id);
    const SHOW_MAX = hostMode ? 999 : (RANK.ONE_LIST ? 20 : 12);
    const list = all.slice(0, SHOW_MAX);
    const ol = $('rank-list');
    // 11件以上は2列にして、20件でも画面に収まるようにする
    ol.className = 'rank-list' + (list.length > 10 ? ' two' : '');
    ol.innerHTML = '';
    list.forEach(function (e, i) {
      const li = document.createElement('li');
      li.className = 'rank-row' + (i < 3 ? ' r' + (i + 1) : '') + (i === rankHi ? ' me' : '');
      const rk = document.createElement('span');
      rk.className = 'rk';
      rk.textContent = String(i + 1);
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = e.name;            // textContent なので HTML は実行されない
      li.appendChild(rk); li.appendChild(nm);
      // 年れい（入れた人だけ）
      if (e.age) {
        const ag = document.createElement('span');
        ag.className = 'ag';
        ag.textContent = e.age + 'さい';
        li.appendChild(ag);
      }
      // クリア者リストは点数を出さない（クリアした順に名前がならぶだけ）
      if (!clearList) {
        const sc = document.createElement('span');
        sc.className = 'sc';
        sc.textContent = e.score + (b.unit || '');
        li.appendChild(sc);
      }
      if (hostMode) {
        const del = document.createElement('button');
        del.type = 'button';
        const armedHere = !!(hostArm && hostArm.kind === 'row' && hostArm.i === i);
        del.className = 'rank-hdel' + (armedHere ? ' armed' : '');
        del.textContent = armedHere ? 'けす？' : '✕';
        del.title = 'この記録を消す（2回おす）';
        del.addEventListener('click', function () { hostDelete(i); });
        li.appendChild(del);
      }
      ol.appendChild(li);
    });
    if (all.length > SHOW_MAX) {
      const li = document.createElement('li');
      li.className = 'rank-more';
      li.textContent = 'ほかに ' + (all.length - SHOW_MAX) + '人';
      ol.appendChild(li);
    }
    $('rank-empty').hidden = all.length > 0;
    $('rank-empty').textContent = clearList
      ? 'まだ だれも クリアしていません。さいしょの 1人に なろう！'
      : 'まだ きろくが ないよ。さいしょの 1人に なろう！';
  }
  /* ---------- ホストモード（ランキング画面で Shift + Delete） ---------- */
  function hostToggle(on) {
    hostMode = (on === undefined) ? !hostMode : !!on;
    hostArm = null;
    AUDIO.sfx(hostMode ? 'decide' : 'back');
    if (hostMode) toast('ホストモード：✕ を 2回 おすと 記録を 消せます（おわるときは Esc か Shift + Delete）', 4000);
    guard(renderRank, 'renderRank');
  }
  function hostCurrent() {
    const bs = viewBoards();
    const b = bs[rankBoard] || bs[0];
    const d = RANK.DAYS[rankDay] || RANK.DAYS[2];
    return { b: b, d: d };
  }
  function hostArmFor(kind, i) {
    const at = performance.now();
    hostArm = { kind: kind, i: i, at: at };
    setTimeout(function () { if (hostArm && hostArm.at === at) { hostArm = null; if (phase === 'rank') guard(renderRank, 'renderRank'); } }, 4000);
  }
  // i 番目（0から）の記録を消す。1回目は「けす？」になり、4秒以内にもう一度で消す
  function hostDelete(i) {
    if (!hostMode) return;
    const c = hostCurrent();
    const l = RANK.list(c.b.id, c.d.id);
    if (i < 0 || i >= l.length) { AUDIO.sfx('miss'); return; }
    if (hostArm && hostArm.kind === 'row' && hostArm.i === i) {
      const e = l[i];
      hostArm = null;
      const r = RANK.removeAt(c.b.id, c.d.id, i, { name: e.name, score: e.score, at: e.at, id: e.id });
      rankHi = -1;
      AUDIO.sfx(r.ok ? 'back' : 'miss');
      toast(r.ok ? '「' + e.name + '」を 消しました（まちがえたら「ひとつ前に もどす」）' : (r.msg || '消せませんでした'), r.ok ? 3000 : 5000);
    } else {
      hostArmFor('row', i);
      AUDIO.sfx('select');
    }
    guard(renderRank, 'renderRank');
  }
  function hostClearList() {
    if (!hostMode) return;
    const c = hostCurrent();
    if (hostArm && hostArm.kind === 'all') {
      hostArm = null;
      const r = RANK.clearBoardDay(c.b.id, c.d.id);
      rankHi = -1;
      AUDIO.sfx('back');
      toast(r.msg, r.ok ? 3000 : 5000);
    } else {
      hostArmFor('all', -1);
      AUDIO.sfx('select');
    }
    guard(renderRank, 'renderRank');
  }
  function hostUndo() {
    if (!hostMode) return;
    hostArm = null;
    const r = RANK.undo();
    rankHi = -1;
    toast(r.msg, r.ok && r.saved ? 3000 : 5000);
    guard(renderRank, 'renderRank');
  }

  function closeRank() {
    AUDIO.sfx('back');
    rankHi = -1;
    hostMode = false;
    hostArm = null;
    if (rankFrom === 'menu') {
      goMenu();
      lastInput = gtime;
      return;
    }
    if (rankFrom === 'result' && def) {
      phase = 'result';
      showOnly('screen-result');
      dialogFocus = 0;
      markFocus(resultButtons(), 0);
      resultLockUntil = performance.now() + 300;
    } else if (def) {
      phase = 'intro';
      showOnly('screen-intro');
    } else {
      goMenu();
    }
    lastInput = gtime;
    applyCursor();
  }

  /* =========================================================
     ニックネーム入力（画面のキーボードで入れる。IME 不要）
     ========================================================= */
  // ひらがな・カタカナは「あいうえお」が たてに ならぶ 50音表にする。
  // よこ書きだと 字を さがすのに まよう、という本人の指摘で たて組みに した（2026-11-15）。
  // 1つの文字列が 1つの「列」。上から下に ならぶ。
  const KANA_COLS = {
    hira: ['あいうえお', 'かきくけこ', 'さしすせそ', 'たちつてと', 'なにぬねの',
           'はひふへほ', 'まみむめも', 'やゆよ', 'らりるれろ', 'わをん',
           'ゃゅょっ', 'ー゛゜'],
    kata: ['アイウエオ', 'カキクケコ', 'サシスセソ', 'タチツテト', 'ナニヌネノ',
           'ハヒフヘホ', 'マミムメモ', 'ヤユヨ', 'ラリルレロ', 'ワヲン',
           'ャュョッ', 'ー゛゜'],
  };
  const KBD = {
    abc: ['ABCDEFGHIJKL', 'MNOPQRSTUVWX', 'YZ0123456789'],
  };
  const DAKU = {
    'か': 'が', 'き': 'ぎ', 'く': 'ぐ', 'け': 'げ', 'こ': 'ご',
    'さ': 'ざ', 'し': 'じ', 'す': 'ず', 'せ': 'ぜ', 'そ': 'ぞ',
    'た': 'だ', 'ち': 'ぢ', 'つ': 'づ', 'て': 'で', 'と': 'ど',
    'は': 'ば', 'ひ': 'び', 'ふ': 'ぶ', 'へ': 'べ', 'ほ': 'ぼ',
    'カ': 'ガ', 'キ': 'ギ', 'ク': 'グ', 'ケ': 'ゲ', 'コ': 'ゴ',
    'サ': 'ザ', 'シ': 'ジ', 'ス': 'ズ', 'セ': 'ゼ', 'ソ': 'ゾ',
    'タ': 'ダ', 'チ': 'ヂ', 'ツ': 'ヅ', 'テ': 'デ', 'ト': 'ド',
    'ハ': 'バ', 'ヒ': 'ビ', 'フ': 'ブ', 'ヘ': 'ベ', 'ホ': 'ボ',
  };
  const HANDAKU = { 'は': 'ぱ', 'ひ': 'ぴ', 'ふ': 'ぷ', 'へ': 'ぺ', 'ほ': 'ぽ', 'ハ': 'パ', 'ヒ': 'ピ', 'フ': 'プ', 'ヘ': 'ペ', 'ホ': 'ポ' };

  function openName(info, onOk, onCancel) {
    nameCtx = { step: 'name', value: '', age: '', layout: 'hira', onOk: onOk, onCancel: onCancel, info: info };
    // 「はい！のせる」を連打したときに、その下のキーを押してしまわないように
    nameLockUntil = performance.now() + 350;
    showNameStep();
    $('overlay-name').hidden = false;
  }
  // なまえだけ（年れいの 入力は 本人の依頼で やめた：2026-11-15）
  function showNameStep() {
    const info = nameCtx.info;
    const b = RANK.board(info.boardId);
    $('name-title').textContent = RANK.isClear(info.boardId)
      ? 'クリア！ おめでとう！'
      : ('ランキング ' + info.pos + 'い！ おめでとう！');
    $('name-note').textContent = 'ニックネームを 入れてね（ほんみょうは 入れないでね・' + RANK.NAME_MAX + 'もじまで）　' +
      (b ? b.label + (RANK.isClear(info.boardId) ? '' : '：' + info.score + (b.unit || '')) : '');
    $('name-tabs').hidden = false;
    $('name-ok').textContent = 'とうろく！';
    $('name-cancel').textContent = 'やめる';
    renderNameTabs();
    renderKbd();
    updateNameBox();
  }
  function renderNameTabs() {
    const tabs = [['hira', 'ひらがな'], ['kata', 'カタカナ'], ['abc', 'ABC・すうじ']];
    const w = $('name-tabs');
    w.innerHTML = '';
    tabs.forEach(function (t) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'name-tab' + (nameCtx.layout === t[0] ? ' on' : '');
      b.textContent = t[1];
      b.addEventListener('click', function () { nameCtx.layout = t[0]; AUDIO.sfx('select'); renderNameTabs(); renderKbd(); });
      w.appendChild(b);
    });
  }
  function renderKbd() {
    const w = $('name-kbd');
    w.innerHTML = '';
    const cols = KANA_COLS[nameCtx.layout];
    if (cols) {
      // たて組み：列ごとに 上から下へ ならべる
      w.className = 'name-kbd kana';
      cols.forEach(function (col, ci) {
        Array.from(col).forEach(function (ch, ri) {
          const k = kbdKey(ch, function () { typeChar(ch); });
          k.style.gridColumn = String(ci + 1);
          k.style.gridRow = String(ri + 1);
          w.appendChild(k);
        });
      });
      const del = kbdKey('← けす', function () { backspace(); }, 'act');
      del.style.gridColumn = '11 / span 2';
      del.style.gridRow = '5';
      w.appendChild(del);
      return;
    }
    // ABC・すうじは よこ書きのまま（アルファベット順に よむため）
    w.className = 'name-kbd abc';
    KBD.abc.forEach(function (row, ri) {
      Array.from(row).forEach(function (ch, ci) {
        const k = kbdKey(ch, function () { typeChar(ch); });
        k.style.gridColumn = String(ci + 1);
        k.style.gridRow = String(ri + 1);
        w.appendChild(k);
      });
    });
    const del2 = kbdKey('← けす', function () { backspace(); }, 'act');
    del2.style.gridColumn = '11 / span 2';
    del2.style.gridRow = '4';
    w.appendChild(del2);
  }
  function kbdKey(label, fn, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'kbd-key' + (cls ? ' ' + cls : '');
    b.textContent = label;
    // 画面が出た直後のクリック（前の画面のボタンの連打）は無視する
    if (fn) b.addEventListener('click', function () { if (performance.now() >= nameLockUntil) fn(); });
    else b.disabled = true;
    return b;
  }
  // 年れいの 入力は もう つかわない（外から 呼ばれても 何もしない）
  function typeAge() { }
  function typeChar(ch) {
    if (!nameCtx) return;
    if (ch === '゛' || ch === '゜') {
      const arr = Array.from(nameCtx.value);
      if (!arr.length) return;
      const map = ch === '゛' ? DAKU : HANDAKU;
      const last = arr[arr.length - 1];
      if (map[last]) { arr[arr.length - 1] = map[last]; nameCtx.value = arr.join(''); AUDIO.sfx('select'); updateNameBox(); }
      return;
    }
    if (Array.from(nameCtx.value).length >= RANK.NAME_MAX) { AUDIO.sfx('miss'); return; }
    nameCtx.value += ch;
    AUDIO.sfx('select');
    updateNameBox();
  }
  function backspace() {
    if (!nameCtx) return;
    const arr = Array.from(nameCtx.value);
    arr.pop();
    nameCtx.value = arr.join('');
    AUDIO.sfx('back');
    updateNameBox();
  }
  function updateNameBox() {
    $('name-value').textContent = nameCtx ? nameCtx.value : '';
    $('name-value').classList.remove('age');
    $('name-ok').disabled = !(nameCtx && RANK.sanitizeName(nameCtx.value));
    $('name-ok').style.opacity = $('name-ok').disabled ? 0.45 : 1;
  }
  function nameOk() {
    if (!nameCtx) return;
    const v = RANK.sanitizeName(nameCtx.value);
    if (!v) { toast('なまえを 入れてね'); AUDIO.sfx('miss'); return; }
    // 年れいは きかない。そのまま とうろく
    const cb = nameCtx.onOk;
    $('overlay-name').hidden = true;
    nameCtx = null;
    if (cb) cb(v, 0);
  }
  function nameCancel() {
    if (!nameCtx) return;
    const cb = nameCtx.onCancel;
    $('overlay-name').hidden = true;
    nameCtx = null;
    AUDIO.sfx('back');
    if (cb) cb();
  }

  /* =========================================================
     スタッフ設定画面（ゲーム選択画面で Shift + Delete）
     ========================================================= */
  let staffArmedKind = '';     // 二度押し確認まちの操作
  let staffArmedBtn = null;    // そのボタン（別のボタンを押したら元にもどす）
  let staffArmedLabel = '';
  let staffDelArmed = null;    // 1件削除の ✕ も同時に2つ武装させない
  function disarmStaff() {
    if (staffArmedBtn) { staffArmedBtn.textContent = staffArmedLabel; }
    staffArmedKind = ''; staffArmedBtn = null; staffArmedLabel = '';
    $('staff-note').textContent = '';
  }
  function disarmDel() {
    if (staffDelArmed) { staffDelArmed.textContent = '✕'; staffDelArmed.dataset.armed = ''; }
    staffDelArmed = null;
  }
  function openStaff() {
    if (!RANK) return;
    phase = 'staff';
    disarmStaff();
    disarmDel();
    $('staff-json').value = '';
    $('staff-note').textContent = '';
    guard(renderStaff, 'renderStaff');
    showOnly('screen-staff');
    $('tb-menu').hidden = false;
    applyCursor();
  }
  function closeStaff() { AUDIO.sfx('back'); goMenu(); }
  function renderStaff() {
    // 開くたび・描き直すたびに、いま本当に保存できるかを確かめ直す
    // （容量がいっぱいになった場合に気づけるように）
    RANK.checkStorage();
    const auto = RANK.autoDayId();
    const mode = RANK.dayMode();
    const now = new Date();
    const c = RANK.counts();
    const warn = RANK.dayMismatch()
      ? '<br><span class="ng">※ 手で固定しているため、じどう判定（' + RANK.dayShort(auto) +
        '）とちがう日に記録されます。よければ「じどう判定」に戻してください。</span>'
      : '';
    $('staff-status').innerHTML =
      'このパソコンの時計：<b>' + now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日 ' +
        ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2) + '</b>' +
      '　／　じどう判定：<b>' + RANK.dayLabel(auto) + '</b><br>' +
      'いま記録される先：<b>' + RANK.dayLabel(RANK.dayId()) + '</b>（設定：' + (mode === 'auto' ? 'じどう' : RANK.dayShort(mode)) + '）' + warn + '<br>' +
      '保存件数　1日目 ' + c.day1 + ' 件／2日目 ' + c.day2 + ' 件／れんしゅう ' + c.test + ' 件<br>' +
      'ブラウザ保存：' + (RANK.healthy()
        ? '<span class="ok">つかえます（ブラウザを閉じても記録は残ります）</span>'
        : '<span class="ng">つかえません！ 記録が保存されていません（' +
          (RANK.writeFails ? '保存に失敗 ' + RANK.writeFails + ' 回：' : '') + esc(RANK.storageError || '原因不明') +
          '）すぐに「書き出す」でバックアップを取ってください</span>') +
      '<br><span style="font-size:21px">※ 記録がディスクに書かれるまで数秒かかります。かたづけるときは、' +
      '<b>最後のプレイから10秒ほど待ってから</b>ブラウザを閉じ、そのあとPCの電源を切ってください。</span>';

    // 日の切りかえ
    const dw = $('staff-days');
    dw.innerHTML = '';
    [['auto', 'じどう判定（ふだんはこれ）'], ['day1', '1日目（11/14）にする'], ['day2', '2日目（11/15）にする'], ['test', 'れんしゅうにする']]
      .forEach(function (t) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-sub staff-btn' + (mode === t[0] ? ' on' : '');
        b.textContent = t[1];
        b.addEventListener('click', function () { RANK.setDayMode(t[0]); renderStaff(); toast('記録先を ' + RANK.dayLabel(RANK.dayId()) + ' にしました'); });
        dw.appendChild(b);
      });

    // 記録一覧
    const bw = $('staff-boards');
    bw.innerHTML = '';
    let any = false;
    RANK.DAYS.forEach(function (dd) {
      RANK.boards().forEach(function (b) {
        const l = RANK.list(b.id, dd.id);
        if (!l.length) return;
        any = true;
        const box = document.createElement('div');
        box.className = 'staff-bd';
        const h = document.createElement('h4');
        h.textContent = RANK.dayShort(dd.id) + '／' + b.label + '（' + l.length + '件）';
        box.appendChild(h);
        l.forEach(function (e, i) {
          const row = document.createElement('div');
          row.className = 'staff-ent';
          const si = document.createElement('span'); si.className = 'i'; si.textContent = (i + 1) + '.';
          const sn = document.createElement('span'); sn.className = 'n'; sn.textContent = e.name + (e.age ? '（' + e.age + 'さい）' : '');
          const ss = document.createElement('span'); ss.className = 's'; ss.textContent = e.score + (b.unit || '');
          // 保存は秒まで持っているが、一覧は「日付 時:分」までを出す（はみ出さないように）
          const st = document.createElement('span'); st.className = 't'; st.textContent = (e.at || '').slice(0, 16);
          const del = document.createElement('button');
          del.type = 'button'; del.className = 'staff-del'; del.textContent = '✕';
          del.title = 'この記録を消す';
          const expect = { name: e.name, score: e.score, at: e.at, id: e.id };
          del.addEventListener('click', function () {
            if (del.dataset.armed === '1') {
              staffDelArmed = null;
              // 画面に出ていた中身と一致するときだけ消す（別の記録を消さないため）
              const r = RANK.removeAt(b.id, dd.id, i, expect);
              renderStaff();
              toast(r.msg || (r.ok ? '1件 消しました' : '消せませんでした'), r.ok && r.saved ? 2600 : 5000);
            } else {
              disarmDel();                  // 同時に2つ武装させない
              staffDelArmed = del;
              del.dataset.armed = '1';
              del.textContent = '!';
              setTimeout(function () { if (staffDelArmed === del) disarmDel(); }, 3000);
            }
          });
          row.appendChild(si); row.appendChild(sn); row.appendChild(ss); row.appendChild(st); row.appendChild(del);
          box.appendChild(row);
        });
        bw.appendChild(box);
      });
    });
    if (!any) { const n = document.createElement('div'); n.className = 'staff-none'; n.textContent = 'まだ記録がありません。'; bw.appendChild(n); }
    $('staff-undo').disabled = !RANK.hasUndo();
    $('staff-undo').style.opacity = RANK.hasUndo() ? 1 : 0.45;
    // 前の版の記録（同じブラウザで開いているときだけ見える。読むだけ）
    const lc = RANK.legacyCount();
    $('staff-legacy-info').innerHTML = lc
      ? '前の版の ランキングが <b>' + lc + ' 件</b> 見つかりました。下のボタンで こちらへ写せます（前の版は そのまま残ります。2回押しても 同じ記録は ふえません）。'
      : '前の版の ランキングは 見つかりませんでした（前の版と ちがうブラウザ・ちがう起動のしかたで 開いているかもしれません。その場合は 前の版で「ファイルに保存」→ ここで「ファイルから読みこむ」）。';
    $('staff-legacy').disabled = !lc;
    $('staff-legacy').style.opacity = lc ? 1 : 0.45;
  }
  // 前の版の 自己ベスト・音の設定も写す（こちらに無いとき／前の版のほうが大きいときだけ）
  function importLegacyStore() {
    let n = 0;
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(OLD_PREFIX) === 0) keys.push(k);
      }
      keys.forEach(function (k) {
        const rest = k.slice(OLD_PREFIX.length);
        let v;
        try { v = JSON.parse(localStorage.getItem(k)); } catch (e) { return; }
        if (/\.best(\.|$)/.test(rest)) {
          if (typeof v !== 'number' || !isFinite(v)) return;
          const cur = store.get(rest, null);
          if (typeof cur !== 'number' || v > cur) { store.set(rest, v); n++; }
        } else if (rest === 'sfxOn' || rest === 'bgmOn') {
          if (store.get(rest, null) === null && typeof v === 'boolean') store.set(rest, v);
        }
      });
    } catch (e) { /* 読めなくても続行 */ }
    return n;
  }

  /* ---------- 前の版の記録を はじめの1回だけ 自動で 引きつぐ ----------
     前の版（festival-arcade）は 保存場所の名前が `ousenArcade2026.` で、
     この版は `ousenArcade2026r4.` なので、そのままでは 中身が 見えない。
     スタッフ画面の「前の版から 引きつぐ」を 押せば 写せるが、
     展示当日に 3台ぶん 押して回るのは 現実的でないので、起動時に 1回だけ 自動でやる。
     ・前の版のキーは 読むだけ。消したり 書いたり しない
     ・1回だけ（しるしを 残す）。あとから スタッフが 消した記録が 復活しないように
     ・中の id で 重なりを 見るので、手で 押したあとに これが 走っても 増えない */
  let carriedOver = 0;
  function autoCarryOver() {
    if (!RANK) return;
    if (store.get('rank2.legacyAuto', false)) return;   // もう やってある
    let n = 0;
    try { n = RANK.legacyCount(); } catch (e) { n = 0; }
    if (!n) return;                                     // 前の版が 無ければ 何もしない
    let r = null;
    try { r = RANK.importLegacy(); } catch (e) { r = null; }
    try { importLegacyStore(); } catch (e) { /* 自己ベストは 失敗しても 続ける */ }
    if (r && r.ok) {
      store.set('rank2.legacyAuto', true);
      carriedOver = n;
    }
  }

  // 二度押しが必要な操作。別のボタンを押したら、前のボタンは必ず元にもどす
  function armed(kind, btn, label, run) {
    if (staffArmedKind === kind && staffArmedBtn === btn) {
      disarmStaff();
      run();
      return;
    }
    disarmStaff();                       // 前に武装していたボタンのラベルを戻す
    staffArmedKind = kind;
    staffArmedBtn = btn;
    staffArmedLabel = label;
    btn.textContent = 'ほんとうに？ もう一度おす';
    $('staff-note').textContent = '※ 5秒以内にもう一度押すと実行します。押さなければ取り消されます。';
    setTimeout(function () { if (staffArmedKind === kind && staffArmedBtn === btn) disarmStaff(); }, 5000);
  }
  function stampName() {
    const t = new Date();
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return 'ousen-ranking-' + t.getFullYear() + p(t.getMonth() + 1) + p(t.getDate()) + '-' + p(t.getHours()) + p(t.getMinutes());
  }
  function wireStaff() {
    const TA = $('staff-json');
    $('staff-export').addEventListener('click', function () {
      TA.value = RANK.exportText();
      toast('書き出しました。コピーして メモ帳などに保存してください');
    });
    $('staff-copy').addEventListener('click', function () {
      if (!TA.value) TA.value = RANK.exportText();
      TA.focus();
      TA.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      if (!ok && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(TA.value).then(function () { toast('コピーしました'); }).catch(function () { toast('コピーできませんでした。手で選んでコピーしてください'); });
      } else {
        toast(ok ? 'コピーしました' : 'コピーできませんでした。手で選んでコピーしてください');
      }
      TA.blur();
    });
    $('staff-save').addEventListener('click', function () {
      const text = TA.value || RANK.exportText();
      TA.value = text;
      try {
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = stampName() + '.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
        toast('ダウンロードフォルダに保存しました（保存されない場合は コピーを使ってください）', 4000);
      } catch (e) {
        toast('ファイルに保存できませんでした。上の枠をコピーしてください', 4000);
      }
    });
    $('staff-import').addEventListener('click', function () { doImport('merge'); });
    $('staff-legacy').addEventListener('click', function () {
      disarmStaff();
      const r = RANK.importLegacy();
      const nb = importLegacyStore();
      $('staff-note').textContent = r.msg + (nb ? '（自己ベスト ' + nb + ' 件も）' : '');
      renderStaff();
      toast(r.msg, r.ok && r.saved ? 4000 : 6000);
    });
    // JSON ファイルを えらんで 読みこむ（前の版で「ファイルに保存」したもの）
    $('staff-file').addEventListener('click', function () { disarmStaff(); $('staff-file-input').value = ''; $('staff-file-input').click(); });
    $('staff-file-input').addEventListener('change', function () {
      const f = this.files && this.files[0];
      if (!f) return;
      const fr = new FileReader();
      fr.onload = function () {
        TA.value = String(fr.result || '');
        doImport('merge');
      };
      fr.onerror = function () { toast('ファイルを 読めませんでした', 5000); };
      fr.readAsText(f);
    });
    $('staff-replace').addEventListener('click', function () { doImport('replace'); });
    function doImport(mode) {
      const txt = TA.value.trim();
      if (!txt) {
        $('staff-note').textContent = '枠に JSON を貼りつけてから押してください。';
        toast('枠に JSON を貼りつけてから押してください', 4000);
        return;
      }
      const r = RANK.importText(txt, mode);
      $('staff-note').textContent = r.msg;
      renderStaff();
      // 失敗したときも必ず画面の下に出す（スタッフ画面は縦に長く、文字が見えないことがあるため）
      toast(r.msg, r.ok && r.saved ? 3000 : 6000);
    }
    $('staff-undo').addEventListener('click', function () {
      disarmStaff();
      const r = RANK.undo();
      $('staff-note').textContent = r.msg || '';
      renderStaff();
      toast(r.msg, r.ok && r.saved ? 3000 : 6000);
    });
    $('staff-cleartest').addEventListener('click', function () {
      armed('ct', this, 'れんしゅうの記録だけ消す', function () {
        const r = RANK.clearDay('test');
        renderStaff();
        toast(r.msg, r.saved ? 2600 : 6000);
      });
    });
    $('staff-clearall').addEventListener('click', function () {
      armed('ca', this, 'ぜんぶ消す', function () {
        const r = RANK.clearAll();
        defs.forEach(function (d) {
          if (d.best) {
            store.set(d.best.key, null);
            store.set('rank.' + d.id, null);
          }
        });
        // コース別の自己ベストも消す（sub.best.easy など）
        try {
          const kill = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.indexOf(PREFIX) === 0 && /\.best(\.|$)/.test(k)) kill.push(k);
          }
          kill.forEach(function (k) { localStorage.removeItem(k); });
        } catch (e) { /* 消せなくても続行 */ }
        renderStaff();
        toast('ランキングと ハイスコアを すべて消しました' + (r.saved ? '' : '（※保存できませんでした）'), r.saved ? 2600 : 6000);
      });
    });
    $('staff-close').addEventListener('click', closeStaff);
    // 消す・読みこむ 以外のボタンを押したら、二度押し確認は取り消す
    ['staff-export', 'staff-copy', 'staff-save', 'staff-import', 'staff-replace']
      .forEach(function (id) { $(id).addEventListener('click', disarmStaff); });
  }

  /* ---------------- 一時停止・確認 ---------------- */
  function hideOverlays() {
    $('overlay-pause').hidden = true;
    $('overlay-confirm').hidden = true;
    $('overlay-resume').hidden = true;
    resumeTimer = 0;
    confirmAction = null;
    AUDIO.duck(false);
  }

  function pause(reason) {
    if (phase !== 'play') return;
    if (paused && pauseReason === 'confirm') return;
    paused = true;
    pauseReason = reason;
    input.clear();
    $('overlay-resume').hidden = true;
    resumeTimer = 0;
    AUDIO.duck(true);
    if (game && game.onPause) safe(function () { game.onPause(true); }, 'onPause');
    if (reason === 'blur') {
      $('overlay-confirm').hidden = true;
      $('overlay-pause').hidden = false;
      dialogFocus = 0;
      markFocus([$('pause-resume'), $('pause-menu')], 0);
    }
    applyCursor();
  }

  function resume() {
    if (!paused) return;
    $('overlay-pause').hidden = true;
    $('overlay-confirm').hidden = true;
    confirmAction = null;
    input.clear();
    // 3-2-1 のあと再開
    pauseReason = 'resume';
    resumeTimer = 1.5;
    $('overlay-resume').hidden = false;
    $('resume-num').textContent = '3';
    AUDIO.sfx('count');
  }

  function finishResume() {
    $('overlay-resume').hidden = true;
    paused = false;
    pauseReason = null;
    AUDIO.duck(false);
    input.clear();
    if (game && game.onPause) safe(function () { game.onPause(false); }, 'onPause');
    applyCursor();
  }

  function askConfirm(kind) {
    if (phase !== 'play') return;
    pause('confirm');
    confirmAction = kind;
    $('overlay-pause').hidden = true;
    $('overlay-confirm').hidden = false;
    if (kind === 'menu') {
      $('confirm-title').textContent = 'メニューにもどる？';
      $('confirm-text').textContent = 'いまのゲームは おわりになります';
      $('confirm-yes').textContent = 'メニューへ';
    } else {
      $('confirm-title').textContent = 'さいしょから やりなおす？';
      $('confirm-text').textContent = 'いまのゲームは おわりになります';
      $('confirm-yes').textContent = 'やりなおす';
    }
    dialogFocus = 0;
    markFocus([$('confirm-no'), $('confirm-yes')], 0);
    AUDIO.sfx('pause');
  }

  function confirmYes() {
    const k = confirmAction;
    hideOverlays();
    paused = false;
    if (k === 'menu') { AUDIO.sfx('back'); goMenu(); }
    else if (k === 'retry') retry();
  }
  function confirmNo() {
    $('overlay-confirm').hidden = true;
    confirmAction = null;
    resume();
  }

  function markFocus(list, idx) {
    for (let i = 0; i < list.length; i++) list[i].classList.toggle('focus', i === idx);
  }

  /* ---------------- 全画面 ---------------- */
  function toggleFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
      if (p && p.then) {
        p.then(function () {
          // 全画面中は Esc を短く押してもメニュー確認になるようにする（長押しで全画面解除）
          if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(['Escape']).catch(function () {});
        }).catch(function () { toast('ぜんがめんにできませんでした（F11 キーでもできます）'); });
      }
    } else {
      if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
      if (document.exitFullscreen) document.exitFullscreen().catch(function () {});
    }
  }

  /* ---------------- トースト ---------------- */
  let toastTimer = null;
  function toast(msg, ms) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 2600);
  }

  /* ---------------- 音の設定 ---------------- */
  function applySoundUi() {
    $('tb-sfx').classList.toggle('off', !AUDIO.sfxOn);
    $('tb-bgm').classList.toggle('off', !AUDIO.bgmOn);
  }
  function toggleSfx() {
    AUDIO.unlock();
    AUDIO.setSfxOn(!AUDIO.sfxOn);
    store.set('sfxOn', AUDIO.sfxOn);
    applySoundUi();
    toast(AUDIO.sfxOn ? 'こうかおん オン' : 'こうかおん オフ', 1200);
    AUDIO.sfx('select');
  }
  function toggleBgm() {
    AUDIO.unlock();
    AUDIO.setBgmOn(!AUDIO.bgmOn);
    store.set('bgmOn', AUDIO.bgmOn);
    applySoundUi();
    toast(AUDIO.bgmOn ? 'BGM オン' : 'BGM オフ', 1200);
  }

  /* ---------------- メニュー ---------------- */
  let thumbCanvases = [];
  function buildMenu() {
    const wrap = $('menu-cards');
    wrap.innerHTML = '';
    thumbCanvases = [];
    defs.forEach(function (d, i) {
      const th = d.theme || { main: '#999', dark: '#666', light: '#eee' };
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'card';
      card.style.setProperty('--c-main', th.main);
      card.style.setProperty('--c-dark', th.dark);
      card.style.setProperty('--c-light', th.light);
      card.innerHTML =
        '<div class="card-num">' + (i + 1) + '</div>' +
        (d.isNew ? '<div class="card-new">NEW</div>' : '<div class="card-play">あそぶ ▶</div>') +
        '<div class="card-thumb"><canvas width="552" height="300"></canvas></div>' +
        '<div class="card-body">' +
        '<div class="card-title">' + d.title + '</div>' +
        '<div class="card-catch">' + (d.catch || '') + '</div>' +
        '<div class="card-tags">' + (d.tags || []).map(function (t) { return '<span class="tag">' + t + '</span>'; }).join('') + '</div>' +
        '</div>' +
        '<div class="card-best"></div>';
      card.addEventListener('click', function () {
        if (performance.now() < menuLockUntil) return;
        AUDIO.unlock(); AUDIO.sfx('decide'); openIntro(d);
      });
      card.addEventListener('mouseenter', function () { if (menuFocus !== i) { menuFocus = i; focusCard(i); } });
      wrap.appendChild(card);
      thumbCanvases.push({ c: card.querySelector('canvas'), d: d });
    });
    resize();
  }
  // スタッフが日を手で固定しているときだけ、ゲーム選択画面に小さな札を出す。
  // 2台ならべて出すときに「ランキング台／ためし台」をひと目で見分けるため。
  function updateModeBadge() {
    const el = $('menu-mode');
    if (!el || !RANK) return;
    const m = RANK.dayMode();
    if (m === 'auto') { el.hidden = true; return; }
    el.hidden = false;
    if (m === 'test') {
      el.className = 'menu-mode';
      el.textContent = 'ためし台（きろくは のこりません）';
    } else {
      el.className = 'menu-mode live';
      el.textContent = 'ランキング台（' + RANK.dayShort(m) + 'に きろく）';
    }
  }

  // カードの文字がはみ出さないように調整する（表示中に測る）
  //  1行に収まるまで少しずつ縮める → 下限まで縮めても入らなければ折り返す
  function fitOne(el, min, wrapSize) {
    el.style.whiteSpace = 'nowrap';
    el.style.fontSize = '';
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth + 1 && size > min) {
      size -= 1;
      el.style.fontSize = size + 'px';
    }
    if (el.scrollWidth > el.clientWidth + 1 && wrapSize) {
      el.style.whiteSpace = 'normal';
      el.style.fontSize = wrapSize + 'px';
    }
  }
  function fitCardText() {
    document.querySelectorAll('.card-title').forEach(function (el) {
      if (!el.dataset.fitted) { fitOne(el, 30, 0); if (el.clientWidth > 0) el.dataset.fitted = '1'; }
    });
    document.querySelectorAll('.card-catch').forEach(function (el) {
      if (!el.dataset.fitted) { fitOne(el, 24, 27); if (el.clientWidth > 0) el.dataset.fitted = '1'; }
    });
    // 記録の行は中身が変わるので、毎回測り直す
    document.querySelectorAll('.card-best').forEach(function (el) { fitOne(el, 19, 22); });
  }
  function refreshCards() {
    const cards = document.querySelectorAll('.card');
    defs.forEach(function (d, i) {
      const el = cards[i] && cards[i].querySelector('.card-best');
      // ハイスコアは常時表示しない（上手な人の点数を見て小さい子が遠慮しないように）。
      // 記録は結果画面のあとと「ランキングを みる」から見られる。
      if (el) el.innerHTML = d.bestText || (d.rank ? 'あそんだあと ランキングに のせられるよ' : '');
    });
    // 文字数が変わるので、カードの記録行を測り直す
    document.querySelectorAll('.card-best').forEach(function (el) { fitOne(el, 19, 22); });
  }
  function focusCard(i) {
    const cards = document.querySelectorAll('.card');
    for (let k = 0; k < cards.length; k++) cards[k].classList.toggle('focus', k === i);
  }

  // メニュー背景（桜と旗の飾り）
  const petals = [];
  for (let i = 0; i < 46; i++) {
    petals.push({ x: Math.random() * W, y: Math.random() * H, s: 10 + Math.random() * 14, v: 30 + Math.random() * 50, a: Math.random() * 6.28, w: 0.6 + Math.random() * 1.4, ph: Math.random() * 6.28 });
  }
  function drawPetal(g, x, y, s, a) {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.beginPath();
    g.moveTo(0, -s);
    g.bezierCurveTo(s * 0.9, -s * 0.9, s * 0.8, s * 0.5, 0, s);
    g.bezierCurveTo(-s * 0.8, s * 0.5, -s * 0.9, -s * 0.9, 0, -s);
    g.fill();
    g.restore();
  }
  function drawMenuBg(g, t, dt) {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#bfe6ff');
    sky.addColorStop(0.55, '#fff0f6');
    sky.addColorStop(1, '#ffe2ec');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // 太陽の光
    g.save();
    g.translate(W / 2, 200);
    g.rotate(t * 0.03);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 16; i++) {
      g.rotate(Math.PI / 8);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(-90, -1400);
      g.lineTo(90, -1400);
      g.closePath();
      g.fill();
    }
    g.restore();
    // 雲
    g.fillStyle = 'rgba(255,255,255,0.9)';
    [[220, 250, 1], [1650, 170, 1.2], [1250, 330, 0.8], [520, 120, 0.7]].forEach(function (c, i) {
      const x = ((c[0] + t * (10 + i * 4)) % (W + 400)) - 200;
      cloud(g, x, c[1], c[2]);
    });
    // 丘
    g.fillStyle = '#c9eeb2';
    g.beginPath();
    g.moveTo(0, H);
    g.lineTo(0, 900);
    g.quadraticCurveTo(480, 800, 960, 900);
    g.quadraticCurveTo(1440, 1000, 1920, 870);
    g.lineTo(W, H);
    g.fill();
    g.fillStyle = '#a8df8c';
    g.beginPath();
    g.moveTo(0, H);
    g.lineTo(0, 990);
    g.quadraticCurveTo(700, 900, 1300, 980);
    g.quadraticCurveTo(1700, 1030, 1920, 960);
    g.lineTo(W, H);
    g.fill();
    // 桜の木（左右）
    sakuraTree(g, 90, 1000, 1.25, t);
    sakuraTree(g, 1830, 1010, 1.1, t + 2);
    // ガーランド（旗）
    garland(g, t);
    // 花びら
    for (let i = 0; i < petals.length; i++) {
      const p = petals[i];
      p.y += p.v * dt;
      p.x += Math.sin(t * p.w + p.ph) * 30 * dt + 15 * dt;
      p.a += dt * p.w;
      if (p.y > H + 20) { p.y = -20; p.x = Math.random() * W; }
      if (p.x > W + 20) p.x = -20;
      g.fillStyle = i % 3 === 0 ? 'rgba(255,170,200,0.85)' : 'rgba(255,200,220,0.85)';
      drawPetal(g, p.x, p.y, p.s * 0.6, p.a);
    }
  }
  function cloud(g, x, y, s) {
    g.beginPath();
    g.arc(x, y, 50 * s, 0, 7);
    g.arc(x + 55 * s, y - 25 * s, 60 * s, 0, 7);
    g.arc(x + 120 * s, y, 50 * s, 0, 7);
    g.arc(x + 60 * s, y + 15 * s, 55 * s, 0, 7);
    g.fill();
  }
  function sakuraTree(g, x, y, s, t) {
    g.save();
    g.translate(x, y);
    g.scale(s, s);
    g.fillStyle = '#9b6b4f';
    g.beginPath();
    g.moveTo(-26, 0);
    g.quadraticCurveTo(-10, -150, -40, -260);
    g.lineTo(-10, -270);
    g.quadraticCurveTo(10, -170, 26, 0);
    g.fill();
    const blobs = [[-40, -300, 120], [60, -330, 110], [-120, -360, 90], [0, -420, 110], [110, -420, 80], [-90, -460, 70]];
    blobs.forEach(function (b, i) {
      const wob = Math.sin(t * 1.2 + i) * 4;
      g.fillStyle = i % 2 ? '#ffc6da' : '#ffb3cd';
      g.beginPath();
      g.arc(b[0] + wob, b[1], b[2], 0, 7);
      g.fill();
    });
    g.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 18; i++) {
      const a = i * 2.4, r = 40 + (i * 37) % 140;
      g.beginPath();
      g.arc(Math.cos(a) * r, -380 + Math.sin(a) * r * 0.6, 8, 0, 7);
      g.fill();
    }
    g.restore();
  }
  function garland(g, t) {
    const cols = ['#ff7fa8', '#ffd34d', '#59b8ff', '#7ed957', '#b48cff'];
    g.strokeStyle = 'rgba(120,90,140,0.6)';
    g.lineWidth = 4;
    const sag = 60;
    g.beginPath();
    g.moveTo(-20, 10);
    g.quadraticCurveTo(W / 2, 10 + sag * 2, W + 20, 10);
    g.stroke();
    for (let i = 0; i < 24; i++) {
      const u = (i + 0.5) / 24;
      const x = -20 + (W + 40) * u;
      const y = 10 + 2 * u * (1 - u) * sag * 2;
      const sw = Math.sin(t * 2 + i) * 0.08;
      g.save();
      g.translate(x, y);
      g.rotate(sw);
      g.fillStyle = cols[i % cols.length];
      g.beginPath();
      g.moveTo(-26, 0);
      g.lineTo(26, 0);
      g.lineTo(0, 52);
      g.closePath();
      g.fill();
      g.restore();
    }
  }

  /* ---------------- メインループ ---------------- */
  let last = 0;
  function frame(nowMs) {
    requestAnimationFrame(frame);
    let dt = last ? (nowMs - last) / 1000 : 1 / 60;
    last = nowMs;
    if (dt > 0.25) dt = 0.25;
    if (dt < 0) dt = 0;
    gtime += dt;

    if ((phase === 'intro' || phase === 'result' || phase === 'rank') && gtime - lastInput > (phase === 'rank' && hostMode ? 180 : IDLE_TO_MENU)) {
      lastInput = gtime;
      goMenu();
    }
    // スタッフ画面は来場者に見せる画面ではないので、放置されたらメニューに戻す
    // （ただし JSON を貼りつけ中・入力欄を使っている間は戻さない）
    if (phase === 'staff' && gtime - lastInput > IDLE_STAFF) {
      lastInput = gtime;
      const ta = $('staff-json');
      if (!ta.value.trim() && document.activeElement !== ta) goMenu();
    }

    // 再開カウントダウン
    if (paused && resumeTimer > 0) {
      resumeTimer -= dt;
      const n = Math.ceil(resumeTimer / 0.5);
      const el = $('resume-num');
      if (resumeTimer <= 0) finishResume();
      else if (el.textContent !== String(n)) { el.textContent = String(n); AUDIO.sfx('count'); }
    }

    if (game && phase !== 'menu' && !paused) {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 40) {
        safe(function () { game.update(STEP); }, 'update');
        acc -= STEP;
        n++;
        if (!game) break;
      }
      if (n >= 40) acc = 0;
    }
    render(dt);
  }

  function render(dt) {
    g.setTransform(pxScale, 0, 0, pxScale, 0, 0);
    if (phase === 'menu' || phase === 'boot' || phase === 'staff') {
      drawMenuBg(g, gtime, dt);
      // カードのサムネイル
      for (let i = 0; i < thumbCanvases.length; i++) {
        const tc = thumbCanvases[i];
        const tg = tc.c.getContext('2d');
        tg.setTransform(tc.c.width / 552, 0, 0, tc.c.height / 300, 0, 0);
        if (tc.d.drawThumb) safe(function () { tc.d.drawThumb(tg, 552, 300, gtime); }, 'thumb');
        else { tg.fillStyle = '#eee'; tg.fillRect(0, 0, 552, 300); }
      }
    } else if (game) {
      g.save();
      safe(function () { game.draw(g); }, 'draw');
      g.restore();
    }
  }

  /* ---------------- 入力 ---------------- */
  const BLOCK_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'PageUp', 'PageDown', 'Home', 'End', 'Backspace', 'Enter', 'NumpadEnter']);

  function isTyping(e) {
    const t = e && e.target;
    const tag = (t && t.tagName) || '';
    return tag === 'TEXTAREA' || tag === 'INPUT' || (t && t.isContentEditable);
  }

  function onKeyDown(e) {
    const code = e.code || e.key;
    // スタッフ画面の入力欄に文字を打っているときは、ブラウザに任せる
    if (isTyping(e)) {
      if (code === 'Escape' && e.target.blur) e.target.blur();
      return;
    }
    // F11（全画面）と Ctrl/Alt/Win の組み合わせ以外は、ブラウザの動作を止める（F1 ヘルプ・F5 再読み込み・F7 などを子どもが押しても大丈夫に）
    const passthrough = code === 'F11' || e.ctrlKey || e.altKey || e.metaKey;
    if (!passthrough) e.preventDefault();
    if (passthrough) return;
    lastInput = gtime;
    AUDIO.unlock();
    AUDIO.resumePending();

    // ニックネーム入力中（いちばん手前）
    if (!$('overlay-name').hidden) {
      if (code === 'Escape') { if (!e.repeat) nameCancel(); return; }
      if (code === 'Enter' || code === 'NumpadEnter') { if (!e.repeat) nameOk(); return; }
      if (code === 'Backspace') { backspace(); return; }
      if (!e.repeat && typeof e.key === 'string' && e.key.length === 1 && /[A-Za-z0-9]/.test(e.key)) {
        typeChar(e.key.toUpperCase());
      }
      return;
    }

    // 共通キー
    if (code === 'KeyF' && !e.repeat) { toggleFullscreen(); return; }
    if (code === 'KeyM' && !e.repeat) { toggleSfx(); return; }

    // ダイアログ表示中
    if (!$('overlay-confirm').hidden) {
      if (e.repeat) return;
      const list = [$('confirm-no'), $('confirm-yes')];
      if (code === 'Escape') { confirmNo(); return; }
      if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'Tab' || code === 'KeyA' || code === 'KeyD') { dialogFocus = 1 - dialogFocus; markFocus(list, dialogFocus); AUDIO.sfx('select'); return; }
      if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') { if (dialogFocus === 1) confirmYes(); else confirmNo(); return; }
      if (code === 'KeyR' && confirmAction === 'retry') { confirmYes(); return; }
      return;
    }
    if (!$('overlay-pause').hidden) {
      if (e.repeat) return;
      const list = [$('pause-resume'), $('pause-menu')];
      if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'Tab') { dialogFocus = 1 - dialogFocus; markFocus(list, dialogFocus); return; }
      if (code === 'Escape') { askConfirm('menu'); return; }
      if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') { if (dialogFocus === 1) askConfirm('menu'); else resume(); return; }
      return;
    }
    if (paused) return; // 再開カウント中

    if (phase === 'menu') {
      if (e.repeat) return;
      const n = defs.length;
      if (code === 'ArrowLeft' || code === 'KeyA') { menuFocus = (menuFocus + n - 1) % n; focusCard(menuFocus); AUDIO.sfx('select'); }
      else if (code === 'ArrowRight' || code === 'KeyD' || code === 'Tab') { menuFocus = (menuFocus + 1) % n; focusCard(menuFocus); AUDIO.sfx('select'); }
      // R5：6本を 2段3列で ならべたので、上下でも 動けるように
      else if (code === 'ArrowUp' || code === 'KeyW') { menuFocus = (menuFocus + n - 3) % n; focusCard(menuFocus); AUDIO.sfx('select'); }
      else if (code === 'ArrowDown' || code === 'KeyS') { menuFocus = (menuFocus + 3) % n; focusCard(menuFocus); AUDIO.sfx('select'); }
      else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') { if (defs[menuFocus]) { AUDIO.sfx('decide'); openIntro(defs[menuFocus]); } }
      else if (code === 'Delete' && e.shiftKey) {
        // スタッフ用: Shift + Delete で スタッフ設定画面をひらく（すぐには消さない）
        AUDIO.sfx('select');
        openStaff();
      }
      else if (code === 'KeyT') { if (rankGames().length) { AUDIO.sfx('decide'); openRank(null, null, 'menu'); } }
      else if (/^(Digit|Numpad)[1-9]$/.test(code)) {
        const k = parseInt(code.slice(-1), 10) - 1;
        if (defs[k]) { menuFocus = k; AUDIO.sfx('decide'); openIntro(defs[k]); }
      }
      return;
    }
    if (phase === 'intro') {
      if (e.repeat) return;
      const btns = $('intro-buttons').children;
      const list = currentModeList();
      if (code === 'Escape' || code === 'Backspace') {
        AUDIO.sfx('back');
        if (modePage) { modePage = null; renderModes(); } else goMenu();
        return;
      }
      if (code === 'KeyT' && RANK && def.rank) { openRank(null, null, 'intro'); return; }
      if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown' || code === 'Tab') {
        const n = btns.length;
        if (n > 1) {
          const dir = (code === 'ArrowLeft' || code === 'ArrowUp') ? -1 : 1;
          introFocus = (introFocus + dir + n) % n;
          markFocus(btns, introFocus);
          showDesc();
          AUDIO.sfx('select');
        }
        return;
      }
      if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
        if (modePage && introFocus >= list.length) { AUDIO.sfx('back'); modePage = null; renderModes(); return; }
        pickMode(list[introFocus] || list[0]);
        return;
      }
      return;
    }
    if (phase === 'rank') {
      if (e.repeat) return;
      const bs = viewBoards();
      // ホストモード（Shift + Delete で 出す／しまう）
      if (code === 'Delete' && e.shiftKey) { hostToggle(); return; }
      if (hostMode) {
        if (code === 'Escape') { hostToggle(false); return; }
        const m = /^(?:Digit|Numpad)([0-9])$/.exec(code);
        if (m) { const n = parseInt(m[1], 10); hostDelete(n === 0 ? 9 : n - 1); return; }
        if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space' || code === 'Backspace') return;
      }
      if (code === 'Escape' || code === 'Backspace' || code === 'Enter' || code === 'NumpadEnter' || code === 'Space') { closeRank(); return; }
      if (code === 'ArrowLeft' || code === 'ArrowRight') {
        if (bs.length > 1) {
          rankBoard = (rankBoard + (code === 'ArrowLeft' ? -1 : 1) + bs.length) % bs.length;
          rankHi = -1; AUDIO.sfx('select'); renderRank();
        }
        return;
      }
      // 1〜9 で ゲームを きりかえる（6本ぶんを その場で 見くらべられる）
      const gm = /^(?:Digit|Numpad)([1-9])$/.exec(code);
      if (gm) {
        const gs2 = rankGames();
        const gi2 = parseInt(gm[1], 10) - 1;
        if (gs2[gi2] && gs2[gi2].id !== rankGame) {
          rankGame = gs2[gi2].id; rankBoard = 0; rankHi = -1; AUDIO.sfx('select'); renderRank();
        }
        return;
      }
      if (code === 'ArrowUp' || code === 'ArrowDown' || code === 'Tab') {
        const n = RANK.DAYS.length;
        const dir = code === 'ArrowUp' ? -1 : 1;
        for (let k = 0; k < n; k++) {               // 出していない日はとばす
          rankDay = (rankDay + dir + n) % n;
          if (dayVisible(rankDay)) break;
        }
        rankHi = -1; AUDIO.sfx('select'); renderRank();
        return;
      }
      return;
    }
    if (phase === 'staff') {
      if (e.repeat) return;
      if (code === 'Escape') closeStaff();
      return;
    }
    if (phase === 'result') {
      if (e.repeat) return;
      if (performance.now() < resultLockUntil || $('screen-result').hidden) return;
      const list = resultButtons();
      const n = list.length;
      if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'Tab') {
        if (n > 1) {
          dialogFocus = (dialogFocus + (code === 'ArrowLeft' ? -1 : 1) + n) % n;
          markFocus(list, dialogFocus);
          AUDIO.sfx('select');
        }
        return;
      }
      // ランキング登録のおさそいが出ているあいだは、それを先に答えてもらう
      if (pendingReg && !$('result-ask').hidden) {
        if (code === 'Escape') { declineReg(); return; }
        if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
          if (dialogFocus === 1) declineReg(); else acceptReg();
        }
        return;
      }
      if (code === 'Escape') { AUDIO.sfx('back'); goMenu(); return; }
      // Enter は いつでも「もう一回」（どのボタンを えらんでいても）
      if (code === 'Enter' || code === 'NumpadEnter' || code === 'KeyR') { retry(); return; }
      if (code === 'KeyT' && !$('result-rankview').hidden) { openRank(lastBoard, null, 'result'); return; }
      if (code === 'Space') {
        const b = list[dialogFocus];
        if (b === $('result-menu')) { AUDIO.sfx('back'); goMenu(); }
        else if (b === $('result-rankview')) openRank(lastBoard, null, 'result');
        else retry();
        return;
      }
      return;
    }
    if (phase === 'play') {
      if (code === 'Escape') { if (!e.repeat) askConfirm('menu'); return; }
      if (code === 'KeyR') { if (!e.repeat) askConfirm('retry'); return; }
      if (keys.has(code) || e.repeat) return; // キーリピートは無視（プレイ前から押しっぱなしのキーは、いったん離すまで無効）
      keys.add(code);
      if (game && game.onKeyDown) safe(function () { game.onKeyDown(code); }, 'onKeyDown');
    }
  }

  function onKeyUp(e) {
    const code = e.code || e.key;
    if (isTyping(e)) return;
    if (BLOCK_KEYS.has(code)) e.preventDefault();
    if (keys.has(code)) {
      keys.delete(code);
      if (phase === 'play' && !paused && game && game.onKeyUp) safe(function () { game.onKeyUp(code); }, 'onKeyUp');
    }
  }

  function onPointerDown(e) {
    lastInput = gtime;
    AUDIO.unlock();
    AUDIO.resumePending();
    const p = toVirtual(e);
    pointer.x = p.x; pointer.y = p.y; pointer.inside = true;
    if (e.target !== canvas) return;
    if (e.button !== undefined && e.button !== 0) return;
    pointer.down = true;
    if (phase === 'play' && !paused && game && game.onPointerDown) safe(function () { game.onPointerDown(p.x, p.y); }, 'onPointerDown');
  }
  function onPointerMove(e) {
    lastInput = gtime;
    const p = toVirtual(e);
    pointer.x = p.x; pointer.y = p.y; pointer.inside = true;
    if (phase === 'play' && !paused && game && game.onPointerMove) safe(function () { game.onPointerMove(p.x, p.y); }, 'onPointerMove');
  }
  function onPointerUp(e) {
    const p = toVirtual(e);
    pointer.x = p.x; pointer.y = p.y;
    if (!pointer.down) return;
    pointer.down = false;
    if (phase === 'play' && !paused && game && game.onPointerUp) safe(function () { game.onPointerUp(p.x, p.y); }, 'onPointerUp');
  }

  function onBlur() {
    input.clear();
    if (phase === 'play' && (!paused || resumeTimer > 0)) pause('blur');
  }

  /* ---------------- 起動 ---------------- */
  function boot() {
    canvas = $('game-canvas');
    stage = $('stage');
    g = canvas.getContext('2d');

    AUDIO.setSfxOn(store.get('sfxOn', true) && params.get('mute') !== '1');
    AUDIO.setBgmOn(store.get('bgmOn', true) && params.get('mute') !== '1');
    applySoundUi();

    window.addEventListener('resize', resize);
    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp, { passive: false });
    stage.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', function () { if (document.hidden) onBlur(); });
    window.addEventListener('contextmenu', function (e) { if (phase !== 'staff') e.preventDefault(); });
    // スタッフ画面だけは、はみ出した内容をホイールでスクロールできるようにする
    window.addEventListener('wheel', function (e) { if (phase !== 'staff') e.preventDefault(); }, { passive: false });
    window.addEventListener('dragstart', function (e) { e.preventDefault(); });
    window.addEventListener('mousedown', function (e) { if (e.button === 1) e.preventDefault(); });
    setupNavGuard();
    document.addEventListener('fullscreenchange', function () {
      if (!document.fullscreenElement && navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
      setTimeout(resize, 50);
    });

    $('tb-full').addEventListener('click', function () { toggleFullscreen(); });
    $('tb-sfx').addEventListener('click', toggleSfx);
    $('tb-bgm').addEventListener('click', toggleBgm);
    $('tb-menu').addEventListener('click', function () {
      if (phase === 'play') askConfirm('menu');
      else { AUDIO.sfx('back'); goMenu(); }
    });
    $('intro-back').addEventListener('click', function () { AUDIO.sfx('back'); goMenu(); });
    $('intro-rank').addEventListener('click', function () { AUDIO.sfx('decide'); openRank(null, null, 'intro'); });
    // ゲーム選択画面からも ランキングを 見られるようにする（遊ぶ前に 見たい人のため）
    const mr = $('menu-rank');
    if (mr) mr.addEventListener('click', function () {
      if (performance.now() < menuLockUntil) return;
      if (!rankGames().length) return;
      AUDIO.unlock(); AUDIO.sfx('decide'); openRank(null, null, 'menu');
    });
    $('result-retry').addEventListener('click', function () { if (performance.now() >= resultLockUntil) retry(); });
    $('result-menu').addEventListener('click', function () { if (performance.now() >= resultLockUntil) { AUDIO.sfx('back'); goMenu(); } });
    $('result-rankview').addEventListener('click', function () { if (performance.now() >= resultLockUntil) openRank(lastBoard, null, 'result'); });
    $('result-reg-yes').addEventListener('click', function () { if (performance.now() >= resultLockUntil) acceptReg(); });
    $('result-reg-no').addEventListener('click', function () { if (performance.now() >= resultLockUntil) declineReg(); });
    $('rank-close').addEventListener('click', closeRank);
    $('rank-host-clear').addEventListener('click', hostClearList);
    $('rank-host-undo').addEventListener('click', hostUndo);
    $('rank-host-exit').addEventListener('click', function () { hostToggle(false); });
    $('name-ok').addEventListener('click', nameOk);
    $('name-cancel').addEventListener('click', nameCancel);
    wireStaff();
    $('pause-resume').addEventListener('click', function () { resume(); });
    $('pause-menu').addEventListener('click', function () { askConfirm('menu'); });
    $('overlay-pause').addEventListener('pointerdown', function (e) { if (e.target === $('overlay-pause')) resume(); });
    $('confirm-no').addEventListener('click', confirmNo);
    $('confirm-yes').addEventListener('click', confirmYes);
    // ボタンがフォーカスを持ち続けて Space で押されないようにする
    document.addEventListener('focusin', function (e) { if (e.target && e.target.blur && e.target.tagName === 'BUTTON') e.target.blur(); });

    autoCarryOver();          // 前の版の記録を 引きつぐ（はじめの1回だけ）
    buildMenu();
    resize();
    goMenu();
    if (carriedOver) toast('きのうまでの ランキング ' + carriedOver + ' 件を 引きつぎました', 6000);

    // テスト用: index.html?game=hockey&autostart=1&mode=cpu
    const gid = params.get('game');
    if (gid && byId[gid]) {
      menuFocus = defs.indexOf(byId[gid]);
      openIntro(byId[gid]);
      if (params.get('autostart') === '1') {
        const d2 = byId[gid];
        const m = findLeaf(d2, params.get('mode')) || firstLeaf(d2);
        startPlay(m);
      }
    }
    requestAnimationFrame(frame);
  }

  /* ---------------- テスト用フック ---------------- */
  // --- マウスのサイドボタン（戻る／進む）で展示から抜けないようにする ---
  // Chrome / Edge は、マウスの「戻る」ボタンをページに渡さずブラウザ本体で処理する。
  // そのため mousedown も auxclick も飛んでこず、preventDefault では止められない
  // （dev/tests/mouse-side.mjs で実測）。
  // そこで「戻り先」を自前の履歴で埋めておく。戻られても同じページに戻し直す。
  const NAV_STATE = { ousenArcade: 1 };
  const NAV_DEPTH = 40;        // 最初に積んでおく厚み
  let navGuard = false;
  let navFill = 0;             // いま積んである数（自前のカウンタ）
  let navTimer = 0;
  function navRefill() {
    navTimer = 0;
    try {
      while (navFill < NAV_DEPTH) { history.pushState(NAV_STATE, ''); navFill++; }
    } catch (e) { /* ブラウザが一時的に拒否しても、次の popstate でまた積む */ }
  }
  function setupNavGuard() {
    try {
      history.pushState(NAV_STATE, '');   // ここで失敗する環境なら、あきらめて素通しにする
      navFill = 1;
      window.addEventListener('popstate', function () {
        if (navFill > 0) navFill--;
        // 連打をまとめて1回で積み直す（履歴APIの呼びすぎを避けるため）
        if (!navTimer) navTimer = setTimeout(navRefill, 0);
      });
      navRefill();
      navGuard = true;
    } catch (e) {
      navGuard = false;   // 使えない環境でも、ゲーム自体はふつうに動く
    }
  }

  const debug = {
    get phase() { return phase; },
    get navGuard() { return navGuard; },
    get navFill() { return navFill; },
    get paused() { return paused; },
    get game() { return game; },
    get def() { return def; },
    // 同期的に n ステップ進める（自動テスト用）
    step: function (n) { for (let i = 0; i < (n || 1) && game; i++) game.update(STEP); },
    open: function (id) { if (byId[id]) openIntro(byId[id]); },
    // 葉のモード id を直接わたせる（例 'cpu-4', '2p-special', 'hard'）
    start: function (modeId) { startPlay(findLeaf(def, modeId) || firstLeaf(def)); },
    // 2段メニューの1段目のボタンを押す（親なら2段目へ、葉ならプレイ開始）
    pick: function (modeId) {
      const list = currentModeList();
      const m = list.find(function (x) { return x.id === modeId; });
      if (m) pickMode(m);
    },
    get modePage() { return modePage ? modePage.id : null; },
    modeButtons: function () {
      return Array.prototype.map.call($('intro-buttons').children, function (b) { return b.textContent; });
    },
    menu: goMenu,
    retry: retry,
    pause: pause,
    resume: resume,
    blur: onBlur,
    store: store,
    rank: RANK,
    openRank: function (boardId, dayId) { openRank(boardId || null, dayId || null, phase === 'result' ? 'result' : 'intro'); },
    closeRank: closeRank,
    openStaff: openStaff,
    staff: { render: renderStaff, close: closeStaff },
    // 結果画面のランキング登録まわり（自動テスト用）
    get pendingReg() {
      return pendingReg
        ? {
            boardId: pendingReg.boardId, score: pendingReg.score, pos: pendingReg.pos,
            day: pendingReg.day, clear: !!pendingReg.clear,
          }
        : null;
    },
    regYes: acceptReg,
    host: {
      get on() { return hostMode; },
      toggle: hostToggle,
      del: hostDelete,
      clear: hostClearList,
      undo: hostUndo,
    },
    regNo: declineReg,
    name: {
      get open() { return !$('overlay-name').hidden; },
      get value() { return nameCtx ? nameCtx.value : ''; },
      get step() { return nameCtx ? nameCtx.step : ''; },
      get age() { return nameCtx ? nameCtx.age : ''; },
      typeAge: typeAge,
      set: function (v) { if (nameCtx) { nameCtx.value = String(v); updateNameBox(); } },
      type: typeChar,
      back: backspace,
      ok: nameOk,
      cancel: nameCancel,
    },
    rankRows: function () {
      // クリア者リストは点数のらんが無い。「ほかに○人」の行は数に入れない
      return Array.prototype.filter.call($('rank-list').children, function (li) {
        return li.classList.contains('rank-row');
      }).map(function (li) {
        const c = li.children;
        return {
          rk: c[0] ? c[0].textContent : '',
          name: c[1] ? c[1].textContent : '',
          score: c[2] ? c[2].textContent : '',
          me: li.classList.contains('me'),
        };
      });
    },
  };

  window.Arcade = {
    W: W, H: H, STEP: STEP, FONT: FONT,
    register: register,
    boot: boot,
    rng: rng,
    font: font,
    text: text,
    roundRect: roundRect,
    store: store,
    defs: defs,
    debug: debug,
  };
})();
