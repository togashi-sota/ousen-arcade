/* =========================================================
   ArcadeRank — 文化祭ランキング（この PC のブラウザ内だけに保存）
   - 日付別（11/14=1日目 / 11/15=2日目 / それ以外=れんしゅう）
   - ゲーム・コースごとに「ボード」を分ける
   - 1 ボード 1 日あたり 上位 10 件
   - 外部通信・サーバーなし。localStorage のみ。
   保存キー： ousenArcade2026r4.rank2.<boardId>.<day>
   （R4＝文化祭中に作った新しい版。前の版 ousenArcade2026.* には書きこまない。
     前の版の記録は importLegacy() で「読むだけ」して こちらへ写す）
   ========================================================= */
(function () {
  'use strict';

  const PREFIX = 'ousenArcadeWeb.';
  const OLD_PREFIX = 'ousenArcadeWeb__none.';   // 前の版（読むだけ。書きこまない）
  const AGE_MIN = 1, AGE_MAX = 99;        // 年れい（入れなくてもよい）
  const MAX = 20;         // 点数で競うランキングの件数
  const MAX_CLEAR = 20;   // クリア者リスト（点数で並べず、クリアした順に名前がならぶ）の件数
  // true にすると 1日目／2日目で分けず、ぜんぶ「1日目」の箱にまとめる（通しのランキング）
  const ONE_LIST = true;
  const NAME_MAX = 8;
  const SCORE_MAX = 999999999;   // 不具合で巨大な数が入っても表示が壊れないように
  // 桜泉祭の日付（展示 PC のローカル時刻で判定する）
  const FEST = [
    { id: 'day1', y: 2026, m: 11, d: 14, label: 'みんなの きろく', short: 'きろく' },
    { id: 'day2', y: 2026, m: 11, d: 15, label: 'みんなの きろく', short: 'きろく' },
  ];
  const TEST_DAY = { id: 'test', label: 'れんしゅう（本番前のテスト）', short: 'れんしゅう' };
  const DAYS = [FEST[0], FEST[1], TEST_DAY];
  const DAY_IDS = ['day1', 'day2', 'test'];

  // 表示を壊す文字（制御文字・方向制御・ゼロ幅）を取り除くための並び。
  // ソースに見えない文字を直接書かないよう、コードポイントから組み立てる。
  const BAD_CHARS = new RegExp(
    '[' +
    '\\u0000-\\u001f' +   // 制御文字
    '\\u007f-\\u009f' +   // 制御文字（後半）
    '\\u061c' +           // アラビア文字マーク
    '\\u180e' +           // モンゴル語の母音区切り
    '\\u200b-\\u200f' +   // ゼロ幅・方向マーク
    '\\u2028\\u2029' +    // 行区切り・段落区切り
    '\\u202a-\\u202e' +   // 方向制御
    '\\u2060-\\u2064' +   // 不可視の結合系
    '\\u2066-\\u2069' +   // 方向分離
    '\\ufeff' +           // BOM
    // 文字の上下に積み上がる記号（いわゆる Zalgo。行の高さが崩れるので消す）
    // ※ 日本語の濁点・半濁点（U+3099 / U+309A）は消さない
    '\\u0300-\\u036f\\u0483-\\u0489\\u0591-\\u05bd\\u0610-\\u061a\\u064b-\\u065f' +
    '\\u06d6-\\u06dc\\u0e31\\u0e34-\\u0e3a\\u0e47-\\u0e4e' +
    '\\u1ab0-\\u1aff\\u1dc0-\\u1dff\\u20d0-\\u20f0\\ufe00-\\ufe0f\\ufe20-\\ufe2f' +
    ']', 'g');

  /* ---------- 保存まわり（localStorage が使えない環境でも落ちない） ---------- */
  const mem = {};               // localStorage に書けなかったときの控え（その場かぎり）
  const memOnly = {};           // 「書けなかったので mem のほうが新しい」キー
  let storageOk = false;        // 本当に保存・読み出しできるか
  let storageErr = '';
  let writeFails = 0;           // 書き込みに失敗した回数（スタッフ画面に出す）

  function rawGet(key) {
    // 書き込みに失敗したキーは、その場の控えのほうが新しい
    if (memOnly[key] && (key in mem)) return mem[key];
    try {
      const v = localStorage.getItem(PREFIX + key);
      if (v === null || v === undefined) return (key in mem) ? mem[key] : null;
      return JSON.parse(v);
    } catch (e) { return (key in mem) ? mem[key] : null; }
  }
  function rawSet(key, val) {
    mem[key] = val;
    try {
      if (val === null || val === undefined) localStorage.removeItem(PREFIX + key);
      else localStorage.setItem(PREFIX + key, JSON.stringify(val));
      delete memOnly[key];
      return true;
    } catch (e) {
      memOnly[key] = 1;
      writeFails++;
      storageErr = String((e && e.message) || e);
      return false;
    }
  }
  // 「本当に書いて読める」かを確かめる（file:// でも保存できるかの確認）
  // スタッフ画面を開くたびに呼び直す（容量いっぱいになった場合に気づけるように）
  function checkStorage() {
    const k = '__probe';
    const v = 'ok' + Date.now();
    try {
      localStorage.setItem(PREFIX + k, JSON.stringify(v));
      const back = JSON.parse(localStorage.getItem(PREFIX + k));
      localStorage.removeItem(PREFIX + k);
      storageOk = (back === v);
      if (storageOk && writeFails === 0) storageErr = '';
      else if (!storageOk) storageErr = storageErr || '書いた値と読んだ値が合いません';
    } catch (e) {
      storageOk = false;
      storageErr = String((e && e.message) || e);
    }
    return storageOk;
  }
  // 「いま記録をちゃんと保存できる状態か」。1回でも書き込みに失敗していたら false
  function healthy() { return storageOk && writeFails === 0; }

  /* ---------- 日付 ---------- */
  function validDay(id) { return DAY_IDS.indexOf(id) >= 0; }
  function dayMode() {
    const m = rawGet('rank2.dayMode');
    return (validDay(m) || m === 'auto') ? m : 'auto';
  }
  function setDayMode(m) {
    if (m !== 'auto' && !validDay(m)) return false;
    return rawSet('rank2.dayMode', m);
  }
  function autoDayId(now) {
    const t = now || new Date();
    const y = t.getFullYear(), mo = t.getMonth() + 1, d = t.getDate();
    for (let i = 0; i < FEST.length; i++) {
      if (FEST[i].y === y && FEST[i].m === mo && FEST[i].d === d) return FEST[i].id;
    }
    return 'day1';   // Web版：いつ遊んでも ひとつの表に まとめる
  }
  function dayId() {
    const m = dayMode();
    const d = (m === 'auto') ? autoDayId() : m;
    // まとめる設定のときは、本番の日はすべて「1日目」の箱へ（れんしゅうはそのまま）
    return foldDay(d);
  }
  // 1日目／2日目を分けない設定のとき、2日目の記録も「1日目」の箱に入れる。
  // 保存キーを作るところで折りたたむので、前の版から引きついだ記録も同じ箱に集まる。
  function foldDay(d) { return (ONE_LIST && d === 'day2') ? 'day1' : d; }
  // スタッフが手で固定していて、しかも今日の自動判定とちがう → 注意を出すため
  function dayMismatch() {
    const m = dayMode();
    return m !== 'auto' && m !== autoDayId();
  }
  function day(id) {
    for (let i = 0; i < DAYS.length; i++) if (DAYS[i].id === id) return DAYS[i];
    return TEST_DAY;
  }
  function dayLabel(id) { return day(id).label; }
  function dayShort(id) { return day(id).short; }

  /* ---------- ボード登録 ---------- */
  const boardList = [];
  const boardMap = {};
  function registerBoard(b) {
    if (!b || !b.id || boardMap[b.id]) return;
    const rec = {
      id: String(b.id),
      label: String(b.label || b.id),
      short: String(b.short || b.label || b.id),
      unit: String(b.unit || ''),
      // 'score'＝点数で競う（既定） / 'clear'＝クリアした順に名前がならぶ
      kind: b.kind === 'clear' ? 'clear' : 'score',
      game: b.game || String(b.id).split('.')[0],
    };
    boardList.push(rec);
    boardMap[rec.id] = rec;
  }
  function board(id) { return boardMap[id] || null; }
  function isClear(boardId) { const b = boardMap[boardId]; return !!(b && b.kind === 'clear'); }
  function limitOf(boardId) { return isClear(boardId) ? MAX_CLEAR : MAX; }
  function boards() { return boardList.slice(); }
  function boardsOf(gameId) { return boardList.filter(function (b) { return b.game === gameId; }); }

  /* ---------- 記録の読み書き ---------- */
  function key(boardId, dId) { return 'rank2.' + boardId + '.' + foldDay(dId); }

  let idSeq = 0;
  function newId() {
    idSeq++;
    return Date.now().toString(36) + '-' + idSeq.toString(36) + '-' + Math.floor(Math.random() * 46656).toString(36);
  }

  // 並べ替えまでして返す（件数は切らない）。merge のときに使う
  // クリア者リスト（kind:'clear'）は点数で並べず、入っている順（＝クリアした順）を保つ
  function normalize(raw, boardId) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const e = raw[i];
      if (!e || typeof e !== 'object') continue;
      let s = Number(e.score);
      if (!isFinite(s)) continue;
      s = Math.round(s);
      if (s < 0 || s > SCORE_MAX) continue;      // 手で書きかえられた変な値を入れない
      const n = sanitizeName(e.name);
      if (!n) continue;
      const rec = {
        name: n,
        score: s,
        at: typeof e.at === 'string' ? e.at.slice(0, 32) : '',
        id: typeof e.id === 'string' && e.id ? e.id.slice(0, 40) : '',
      };
      const ag = sanitizeAge(e.age);
      if (ag) rec.age = ag;
      out.push(rec);
    }
    // 大きい順。同点は配列の前にあるほう（先に登録された記録）を上に保つ
    // クリア者リストは並べ替えない（クリアした順のまま）
    if (!isClear(boardId)) out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }
  /* 同じ名前が いくつも 並ばないようにする（本人の いちばん いい記録だけ 残す）。
     展示で ひとりが 何回も 遊ぶと 上位が 同じ名前で 埋まってしまうため。
     ・点数ランキング … normalize で 大きい順に ならべたあとなので、
       さいしょに 出てきたものが その人の 最高点。あとの ものは 落とす。
     ・クリア者リスト … クリアした順のまま なので、さいしょの 1件（はじめて クリアした回）を 残す。
     名前は そのままの 文字で くらべる（「ノノ」と「のの」は 別の人として あつかう）。 */
  function dedupeByName(l) {
    const seen = Object.create(null);
    const out = [];
    for (let i = 0; i < l.length; i++) {
      const n = l[i].name;
      if (seen[n]) continue;
      seen[n] = 1;
      out.push(l[i]);
    }
    return out;
  }
  function clean(raw, boardId) { return dedupeByName(normalize(raw, boardId)).slice(0, limitOf(boardId)); }

  function list(boardId, dId) {
    const d = validDay(dId) ? dId : (dId ? null : dayId());
    if (!d) return [];
    return clean(rawGet(key(boardId, d)), boardId);
  }

  // この記録が入る位置（1〜上限）。入らないなら 0。
  // 点数ランキング：同点のときは既存の下に入る／クリア者リスト：いちばん後ろに足す
  function rankOf(boardId, score, dId) {
    const s = Math.round(Number(score));
    if (!isFinite(s)) return 0;
    const l = list(boardId, dId);
    if (isClear(boardId)) return l.length < MAX_CLEAR ? l.length + 1 : 0;
    let pos = 0;
    while (pos < l.length && l[pos].score >= s) pos++;
    return pos < MAX ? pos + 1 : 0;
  }
  function qualifies(boardId, score, dId) {
    return score > 0 && rankOf(boardId, score, dId) > 0;
  }

  function sanitizeName(s) {
    if (s === null || s === undefined) return '';
    let t = String(s);
    t = t.replace(BAD_CHARS, '');
    t = t.replace(/\s+/g, ' ').trim();
    // 文字数は「見た目の文字」で数える（絵文字・結合文字で崩れないように）
    const arr = Array.from(t);
    if (arr.length > NAME_MAX) t = arr.slice(0, NAME_MAX).join('');
    return t;
  }

  // 年れい：1〜99 の整数だけ。それ以外（空・0・100以上・文字）は「入れていない」
  function sanitizeAge(a) {
    if (a === null || a === undefined || a === '') return 0;
    const v = Math.round(Number(a));
    if (!isFinite(v) || v < AGE_MIN || v > AGE_MAX) return 0;
    return v;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function stamp() {
    const n = new Date();
    return n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate()) +
      ' ' + pad(n.getHours()) + ':' + pad(n.getMinutes()) + ':' + pad(n.getSeconds());
  }

  // 登録。戻り値 { ok, pos, list, saved }
  function add(boardId, name, score, dId, age) {
    const d = validDay(dId) ? dId : dayId();
    const n = sanitizeName(name);
    const s = Math.round(Number(score));
    if (!boardMap[boardId] || !n || !isFinite(s) || s <= 0 || s > SCORE_MAX) {
      return { ok: false, pos: 0, list: list(boardId, d), saved: false };
    }
    const l = list(boardId, d);
    const lim = limitOf(boardId);
    let pos;
    if (isClear(boardId)) {
      pos = l.length;                                   // クリア者リストは いちばん後ろに足す
    } else {
      pos = 0;
      while (pos < l.length && l[pos].score >= s) pos++;
    }
    if (pos >= lim) return { ok: false, pos: 0, list: l, saved: false };
    const entry = { name: n, score: s, at: stamp(), id: newId() };
    const ag = sanitizeAge(age);
    if (ag) entry.age = ag;
    l.splice(pos, 0, entry);
    // 同じ名前は いちばん いい記録だけ 残す（保存するものからも 落とす）。
    // 自分の 前の記録より ひくいときは、ここで 新しいほうが 落ちる＝最高記録が まもられる。
    const top = dedupeByName(l).slice(0, lim);
    // 出す順位は「その名前が いま 何位か」。自分の 最高記録の 位置を 返す。
    let shown = top.findIndex(function (e) { return e.id === entry.id; });
    if (shown < 0) shown = top.findIndex(function (e) { return e.name === n; });
    if (shown < 0) shown = pos;
    const saved = rawSet(key(boardId, d), top);
    // 書いたあと読み直して、本当に保存されたか確かめる
    let verified = false;
    if (saved) {
      const back = clean(rawGet(key(boardId, d)), boardId);
      verified = !!(back.length === top.length && back[shown] && back[shown].name === n);
    }
    return { ok: true, pos: shown + 1, list: top, saved: saved && verified, entry: entry };
  }

  // スタッフ用：1 件削除。
  // expect（{name,score,at,id}）を渡すと「何行目か」ではなく「その中身」で消す。
  // 画面を描いたあとに保存内容が変わって番号がずれても、ねらった記録を正しく消せる。
  // b（画面に出ていた中身）は一部だけでもよい
  function sameEntry(a, b) {
    if (!a || !b) return false;
    if (a.id && b.id) return a.id === b.id;
    if (a.name !== b.name || a.score !== Math.round(Number(b.score))) return false;
    if (b.at && a.at && a.at !== b.at) return false;
    return true;
  }
  function removeAt(boardId, dId, index, expect) {
    const d = validDay(dId) ? dId : dayId();
    const l = list(boardId, d);
    let at = index;
    if (expect) {
      // まず指定の位置を見て、ちがえば中身で探し直す
      if (!(at >= 0 && at < l.length && sameEntry(l[at], expect))) {
        at = -1;
        for (let i = 0; i < l.length; i++) if (sameEntry(l[i], expect)) { at = i; break; }
      }
      if (at < 0) return { ok: false, saved: false, msg: 'その記録は もうありません（ひらき直してください）' };
    }
    if (at < 0 || at >= l.length) return { ok: false, saved: false, msg: 'その記録は もうありません' };
    snapshot();
    l.splice(at, 1);
    const saved = rawSet(key(boardId, d), l);
    // 保存できなければ「消せた」とは言わない（スタッフが気づけるように）
    return { ok: saved, saved: saved, msg: saved ? '1件 消しました' : '※ 消した結果を保存できませんでした。バックアップを取ってください' };
  }

  /* ---------- 書き出し・読みこみ ---------- */
  function exportAll() {
    const out = { app: 'ousenArcade2026', kind: 'ranking', version: 2, exportedAt: new Date().toISOString(), boards: {} };
    boardList.forEach(function (b) {
      const o = {};
      DAYS.forEach(function (dd) {
        const l = list(b.id, dd.id);
        if (l.length) o[dd.id] = l;
      });
      if (Object.keys(o).length) out.boards[b.id] = o;
    });
    return out;
  }
  function exportText() { return JSON.stringify(exportAll(), null, 2); }

  // 登録されている全ボード・全日を空にする（保存はしない。呼び出し側で上書きする前提）
  function wipeAll() {
    let ok = true;
    boardList.forEach(function (b) {
      DAYS.forEach(function (dd) { if (!rawSet(key(b.id, dd.id), null)) ok = false; });
    });
    return ok;
  }

  function dedupKey(e) { return e.id ? ('i|' + e.id) : ('x|' + e.name + '|' + e.score + '|' + e.at); }

  // obj の中身をそのまま入れる（置きかえ）。先に全部消すので、
  // ファイルに入っていないボード・日も空になる。
  function applyAll(obj) {
    let n = 0, bn = 0, skipped = 0, saved = wipeAll();
    Object.keys(obj.boards || {}).forEach(function (bid) {
      const perDay = obj.boards[bid];
      if (!perDay || typeof perDay !== 'object') return;
      // 知らないボードは書かない（迷子のデータが残って「ぜんぶ消す」でも消えなくなるため）
      if (!boardMap[bid]) { skipped++; return; }
      bn++;
      Object.keys(perDay).forEach(function (did) {
        if (!validDay(did)) return;
        const incoming = clean(perDay[did], bid);
        if (!incoming.length) return;
        if (!rawSet(key(bid, did), incoming)) saved = false;
        n += incoming.length;
      });
    });
    return { boards: bn, entries: n, saved: saved, skipped: skipped };
  }

  // mode: 'merge'（混ぜて上位10件）/ 'replace'（まるごと置きかえ）
  function importText(txt, mode) {
    let obj;
    try { obj = JSON.parse(txt); } catch (e) { return { ok: false, saved: false, msg: 'JSON として読めませんでした' }; }
    if (!obj || obj.kind !== 'ranking' || !obj.boards || typeof obj.boards !== 'object') {
      return { ok: false, saved: false, msg: 'このアプリのランキングデータではありません' };
    }
    snapshot();
    if (mode === 'replace') {
      const r = applyAll(obj);
      return {
        ok: true, saved: r.saved, boards: r.boards, entries: r.entries, skipped: r.skipped,
        msg: r.boards + ' 個のランキング（のべ ' + r.entries + ' 件）に置きかえました' +
             (r.skipped ? '（知らないゲームの ' + r.skipped + ' 個は読みこみませんでした）' : '') +
             (r.saved ? '' : '（※保存できませんでした）'),
      };
    }
    // merge：先に重複をまとめてから 10 件に切る（切ってから消すと件数が減ってしまう）
    let n = 0, bn = 0, skipped = 0, saved = true;
    Object.keys(obj.boards).forEach(function (bid) {
      const perDay = obj.boards[bid];
      if (!perDay || typeof perDay !== 'object') return;
      if (!boardMap[bid]) { skipped++; return; }
      bn++;
      Object.keys(perDay).forEach(function (did) {
        if (!validDay(did)) return;
        const incoming = normalize(perDay[did], bid);
        if (!incoming.length) return;
        const seen = {};
        const merged = normalize(list(bid, did).concat(incoming), bid).filter(function (e) {
          const k = dedupKey(e);
          if (seen[k]) return false;
          seen[k] = 1;
          return true;
        }).slice(0, limitOf(bid));
        if (!rawSet(key(bid, did), merged)) saved = false;
        n += merged.length;
      });
    });
    return {
      ok: true, saved: saved, boards: bn, entries: n, skipped: skipped,
      msg: bn + ' 個のランキング（のべ ' + n + ' 件）を読みこみました' +
           (skipped ? '（知らないゲームの ' + skipped + ' 個は読みこみませんでした）' : '') +
           (saved ? '' : '（※保存できませんでした）'),
    };
  }

  /* ---------- 前の版（ousenArcade2026.*）から引きつぐ ----------
     同じブラウザで開いているときだけ見える（file:// は同じ保存場所を使う）。
     前の版のキーは「読むだけ」。消したり書いたりはしない。
     中身の id で重なりを見るので、2回押しても同じ記録は増えない。 */
  function legacyData() {
    const out = { app: 'ousenArcade2026', kind: 'ranking', version: 2, boards: {} };
    let n = 0;
    boardList.forEach(function (b) {
      const o = {};
      DAYS.forEach(function (dd) {
        let v = null;
        try {
          const raw = localStorage.getItem(OLD_PREFIX + key(b.id, dd.id));
          if (raw) v = JSON.parse(raw);
        } catch (e) { v = null; }
        const l = clean(v, b.id);
        if (l.length) { o[dd.id] = l; n += l.length; }
      });
      if (Object.keys(o).length) out.boards[b.id] = o;
    });
    return { obj: out, count: n };
  }
  function legacyCount() { try { return legacyData().count; } catch (e) { return 0; } }
  function importLegacy() {
    const d = legacyData();
    if (!d.count) return { ok: false, saved: false, entries: 0, msg: '前の版の記録が 見つかりませんでした（同じブラウザで開いていますか？）' };
    const r = importText(JSON.stringify(d.obj), 'merge');
    if (r.ok) r.msg = '前の版の記録 ' + d.count + ' 件を 引きつぎました（いまは のべ ' + r.entries + ' 件）' + (r.saved ? '' : '（※保存できませんでした）');
    return r;
  }

  /* ---------- 取り消し（1世代。もう一度押すと元にもどる＝やり直し） ---------- */
  function snapshot() {
    try { rawSet('rank2.undo', { at: new Date().toISOString(), data: exportAll() }); } catch (e) { /* 無視 */ }
  }
  function hasUndo() { const u = rawGet('rank2.undo'); return !!(u && u.data && u.data.boards); }
  function undo() {
    const u = rawGet('rank2.undo');
    if (!u || !u.data) return { ok: false, saved: false, msg: 'もどせる ひかえが ありません' };
    const cur = exportAll();
    const r = applyAll(u.data);
    // いまの状態をひかえに入れ直す（もう一度押すと、いまの状態にもどせる）
    rawSet('rank2.undo', { at: new Date().toISOString(), data: cur });
    return {
      ok: true, saved: r.saved,
      msg: 'ひとつ前の状態に もどしました（のべ ' + r.entries + ' 件）' + (r.saved ? '' : '（※保存できませんでした）'),
    };
  }

  function clearDay(dId) {
    if (!validDay(dId)) return { ok: false, saved: false, msg: '日の指定がおかしいです' };
    // まとめる設定のときは 1日目と2日目が同じ箱。「2日目だけ消す」はできない
    // （うっかり ぜんぶ消さないように、ここで止める）
    if (ONE_LIST && dId === 'day2') {
      return { ok: false, saved: false, msg: 'いまは 1日目・2日目を まとめています。分けて消すことは できません' };
    }
    snapshot();
    let saved = true;
    boardList.forEach(function (b) { if (!rawSet(key(b.id, dId), null)) saved = false; });
    return { ok: true, saved: saved, msg: dayShort(dId) + 'の記録を消しました' + (saved ? '' : '（※保存できませんでした）') };
  }
  // ホストモード用：このボードのこの日だけ消す
  function clearBoardDay(boardId, dId) {
    if (!boardMap[boardId] || !validDay(dId)) return { ok: false, saved: false, msg: '指定がおかしいです' };
    snapshot();
    const saved = rawSet(key(boardId, dId), null);
    return { ok: saved, saved: saved, msg: dayShort(dId) + '／' + boardMap[boardId].label + ' を消しました' + (saved ? '' : '（※保存できませんでした）') };
  }
  function clearAll() {
    snapshot();
    const saved = wipeAll();
    return { ok: true, saved: saved, msg: 'ランキングを すべて消しました' + (saved ? '' : '（※保存できませんでした）') };
  }

  /* ---------- 件数の集計（スタッフ画面用） ---------- */
  function counts() {
    const out = {};
    DAYS.forEach(function (dd) {
      out[dd.id] = 0;
      // まとめる設定のとき、2日目は1日目と同じ箱なので 二重に数えない
      if (ONE_LIST && dd.id === 'day2') return;
      boardList.forEach(function (b) { out[dd.id] += list(b.id, dd.id).length; });
    });
    return out;
  }

  function format(boardId, score) {
    const b = board(boardId);
    return String(score) + (b ? b.unit : '');
  }

  checkStorage();

  window.ArcadeRank = {
    MAX: MAX,
    MAX_CLEAR: MAX_CLEAR,
    ONE_LIST: ONE_LIST,
    NAME_MAX: NAME_MAX,
    DAYS: DAYS,
    isClear: isClear,
    limitOf: limitOf,
    get storageOk() { return storageOk; },
    get storageError() { return storageErr; },
    get writeFails() { return writeFails; },
    healthy: healthy,
    checkStorage: checkStorage,
    registerBoard: registerBoard,
    board: board,
    boards: boards,
    boardsOf: boardsOf,
    dayMode: dayMode,
    setDayMode: setDayMode,
    dayId: dayId,
    autoDayId: autoDayId,
    dayMismatch: dayMismatch,
    dayLabel: dayLabel,
    dayShort: dayShort,
    list: list,
    rankOf: rankOf,
    qualifies: qualifies,
    add: add,
    removeAt: removeAt,
    sanitizeName: sanitizeName,
    exportAll: exportAll,
    exportText: exportText,
    importText: importText,
    hasUndo: hasUndo,
    undo: undo,
    clearDay: clearDay,
    clearAll: clearAll,
    clearBoardDay: clearBoardDay,
    legacyCount: legacyCount,
    importLegacy: importLegacy,
    sanitizeAge: sanitizeAge,
    AGE_MAX: AGE_MAX,
    counts: counts,
    format: format,
  };
})();
