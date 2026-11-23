/* =========================================================
   ArcadeAudio : WebAudio で効果音と BGM をその場で合成する。
   外部の音源ファイルは使わない（すべてオリジナル）。
   ========================================================= */
(function () {
  'use strict';

  const MASTER_VOL = 0.55;   // 全体
  const SFX_VOL = 0.75;      // 効果音
  const BGM_VOL = 0.16;      // BGM（控えめ）

  let ctx = null;
  let sfxScale = 1;          // api.sfx(name, {vol}) の音量倍率
  let master, sfxBus, bgmBus, comp, noiseBuf;
  let sfxOn = true;
  let bgmOn = true;
  let ducked = false;

  function now() { return ctx ? ctx.currentTime : 0; }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try { ctx = new AC(); } catch (e) { return false; }
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 12;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      master = ctx.createGain();
      master.gain.value = MASTER_VOL;
      sfxBus = ctx.createGain();
      sfxBus.gain.value = sfxOn ? SFX_VOL : 0;
      bgmBus = ctx.createGain();
      bgmBus.gain.value = bgmOn ? BGM_VOL : 0;
      sfxBus.connect(comp);
      bgmBus.connect(comp);
      comp.connect(master);
      master.connect(ctx.destination);
      // ノイズ用バッファ（1秒）
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') { ctx.resume().catch(function () {}); }
    return true;
  }

  function ready() { return !!ctx && ctx.state === 'running'; }

  /* ---------- 基本の音づくり ---------- */
  // tone({f, f2, dur, type, vol, attack, delay, bus})
  function tone(o) {
    if (!ctx || !sfxOn && (!o.bus || o.bus === 'sfx')) return;
    const bus = o.bus === 'bgm' ? bgmBus : sfxBus;
    const t0 = (o.at != null ? o.at : now()) + (o.delay || 0);
    const dur = o.dur || 0.15;
    const vol = (o.vol == null ? 0.3 : o.vol) * (o.bus === 'bgm' ? 1 : sfxScale);
    const attack = o.attack == null ? 0.006 : o.attack;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(20, o.f || 440), t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(bus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // noise({dur, vol, f, f2, q, filter, delay})
  function noise(o) {
    if (!ctx || !sfxOn && (!o.bus || o.bus === 'sfx')) return;
    const bus = o.bus === 'bgm' ? bgmBus : sfxBus;
    const t0 = (o.at != null ? o.at : now()) + (o.delay || 0);
    const dur = o.dur || 0.2;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = o.filter || 'bandpass';
    filt.frequency.setValueAtTime(o.f || 1500, t0);
    if (o.f2) filt.frequency.exponentialRampToValueAtTime(o.f2, t0 + dur);
    filt.Q.value = o.q == null ? 1 : o.q;
    const g = ctx.createGain();
    const vol = (o.vol == null ? 0.25 : o.vol) * (o.bus === 'bgm' ? 1 : sfxScale);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(bus);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.05);
  }

  function note(n) { return 440 * Math.pow(2, (n - 69) / 12); }

  /* ---------- 効果音ライブラリ ---------- */
  const SFX = {
    select() { tone({ f: 660, f2: 880, dur: 0.08, type: 'triangle', vol: 0.18 }); },
    decide() {
      tone({ f: 784, dur: 0.1, type: 'triangle', vol: 0.22 });
      tone({ f: 1175, dur: 0.16, type: 'triangle', vol: 0.2, delay: 0.07 });
    },
    back() { tone({ f: 600, f2: 380, dur: 0.14, type: 'triangle', vol: 0.18 }); },
    count() { tone({ f: 740, dur: 0.16, type: 'square', vol: 0.09 }); tone({ f: 740, dur: 0.16, type: 'sine', vol: 0.15 }); },
    go() {
      tone({ f: 1480, dur: 0.4, type: 'square', vol: 0.08 });
      tone({ f: 1480, dur: 0.45, type: 'sine', vol: 0.18 });
    },
    pop() { tone({ f: 380, f2: 900, dur: 0.1, type: 'sine', vol: 0.3 }); },
    hit() {
      tone({ f: 520, f2: 260, dur: 0.09, type: 'triangle', vol: 0.35 });
      noise({ dur: 0.05, vol: 0.12, f: 2500, q: 0.8 });
    },
    bonk() {
      tone({ f: 300, f2: 120, dur: 0.16, type: 'sine', vol: 0.45 });
      noise({ dur: 0.07, vol: 0.18, f: 1200, q: 0.7 });
    },
    coin() {
      tone({ f: 988, dur: 0.08, type: 'square', vol: 0.08 });
      tone({ f: 1319, dur: 0.3, type: 'square', vol: 0.08, delay: 0.07 });
      tone({ f: 1319, dur: 0.3, type: 'sine', vol: 0.18, delay: 0.07 });
    },
    sparkle() {
      [1568, 2093, 2637, 3136].forEach(function (f, i) { tone({ f: f, dur: 0.18, type: 'sine', vol: 0.1, delay: i * 0.045 }); });
    },
    bad() {
      tone({ f: 220, f2: 110, dur: 0.35, type: 'sawtooth', vol: 0.09 });
      tone({ f: 233, f2: 116, dur: 0.35, type: 'square', vol: 0.06 });
      noise({ dur: 0.25, vol: 0.18, f: 500, f2: 150, q: 0.6, filter: 'lowpass' });
    },
    wall() { tone({ f: 330, f2: 300, dur: 0.06, type: 'triangle', vol: 0.18 }); },
    goal() {
      const seq = [72, 76, 79, 84];
      seq.forEach(function (n, i) { tone({ f: note(n), dur: 0.22, type: 'triangle', vol: 0.22, delay: i * 0.09 }); });
      noise({ dur: 0.5, vol: 0.08, f: 6000, q: 0.5, filter: 'highpass', delay: 0.05 });
    },
    win() {
      const seq = [[72, 0], [76, 0.12], [79, 0.24], [84, 0.36], [79, 0.52], [84, 0.64]];
      seq.forEach(function (s) { tone({ f: note(s[0]), dur: 0.3, type: 'triangle', vol: 0.22, delay: s[1] }); tone({ f: note(s[0] - 12), dur: 0.3, type: 'sine', vol: 0.12, delay: s[1] }); });
    },
    finish() {
      tone({ f: note(79), dur: 0.25, type: 'triangle', vol: 0.22 });
      tone({ f: note(74), dur: 0.25, type: 'triangle', vol: 0.2, delay: 0.15 });
      tone({ f: note(79), dur: 0.5, type: 'triangle', vol: 0.22, delay: 0.3 });
    },
    newrecord() {
      const seq = [76, 79, 84, 88, 91];
      seq.forEach(function (n, i) { tone({ f: note(n), dur: 0.25, type: 'sine', vol: 0.18, delay: i * 0.07 }); });
      SFX.sparkle();
    },
    bubble() { tone({ f: 500 + Math.random() * 300, f2: 1300 + Math.random() * 400, dur: 0.07, type: 'sine', vol: 0.12 }); },
    splash() { noise({ dur: 0.35, vol: 0.2, f: 1800, f2: 500, q: 0.7 }); },
    crash() {
      tone({ f: 200, f2: 70, dur: 0.4, type: 'sine', vol: 0.45 });
      noise({ dur: 0.35, vol: 0.2, f: 900, f2: 200, q: 0.7, filter: 'lowpass' });
      tone({ f: note(67), dur: 0.2, type: 'triangle', vol: 0.12, delay: 0.25 });
      tone({ f: note(64), dur: 0.2, type: 'triangle', vol: 0.12, delay: 0.38 });
      tone({ f: note(60), dur: 0.4, type: 'triangle', vol: 0.12, delay: 0.51 });
    },
    whoosh() { noise({ dur: 0.3, vol: 0.12, f: 400, f2: 2400, q: 1.2 }); },
    tick() { tone({ f: 1200, dur: 0.04, type: 'square', vol: 0.05 }); },
    pause() { tone({ f: 700, f2: 500, dur: 0.12, type: 'sine', vol: 0.18 }); },
  };

  function sfx(name, opts) {
    if (!ctx || !sfxOn) return;
    const fn = SFX[name];
    if (!fn) return;
    sfxScale = opts && typeof opts.vol === 'number' ? Math.max(0, Math.min(2, opts.vol)) : 1;
    try { fn(opts || {}); } catch (e) { /* ignore */ }
    sfxScale = 1;
  }

  /* ---------- BGM（ステップシーケンサ） ---------- */
  // 楽譜表記: 1トークン = 8分音符。"." = 休み, "-" = のばす, 例 "C5"
  const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function parseNote(s) {
    const m = /^([A-G])(#|b)?(\d)$/.exec(s);
    if (!m) return null;
    let n = NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return n + (parseInt(m[3], 10) + 1) * 12;
  }
  function parseTrack(str) {
    const toks = str.replace(/\|/g, ' ').trim().split(/\s+/);
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t === '.') out.push(null);
      else if (t === '-') { out.push(null); for (let j = out.length - 2; j >= 0; j--) { if (out[j]) { out[j].len++; break; } if (toks[j] !== '-') break; } }
      else out.push({ n: parseNote(t), len: 1 });
    }
    return out;
  }

  const SONGS = {
    menu: {
      bpm: 112, lead: 'triangle', leadVol: 0.5, bassVol: 0.55, drums: true,
      melody:
        'C5 . E5 . G5 . E5 . | F5 . A5 . G5 - - . | E5 . G5 . C6 . G5 . | A5 G5 F5 E5 D5 - - . |' +
        'C5 . E5 . G5 . E5 . | F5 . A5 . C6 - A5 . | G5 . E5 . D5 . G4 . | C5 - - - . . . .',
      bass:
        'C3 . G3 . C3 . G3 . | F2 . C3 . F2 . C3 . | C3 . G3 . E3 . G3 . | G2 . D3 . G2 . B2 . |' +
        'C3 . G3 . C3 . G3 . | F2 . C3 . F2 . A2 . | G2 . D3 . G2 . B2 . | C3 . G2 . C3 . . .',
    },
    hockey: {
      bpm: 138, lead: 'square', leadVol: 0.22, bassVol: 0.6, drums: true,
      melody:
        'G4 . B4 D5 . B4 G4 . | A4 . C5 E5 . C5 A4 . | B4 . D5 G5 . D5 B4 . | C5 . B4 . A4 - . . |' +
        'G4 . B4 D5 . B4 G4 . | E5 . D5 C5 . B4 A4 . | B4 . A4 G4 . F#4 E4 . | D4 . F#4 . G4 - . .',
      bass:
        'G2 . G2 . G2 . G2 . | A2 . A2 . A2 . A2 . | B2 . B2 . B2 . B2 . | C3 . C3 . D3 . D3 . |' +
        'G2 . G2 . G2 . G2 . | C3 . C3 . A2 . A2 . | E2 . E2 . E2 . B2 . | D2 . D2 . G2 . . .',
    },
    mole: {
      bpm: 126, lead: 'triangle', leadVol: 0.5, bassVol: 0.55, drums: true,
      melody:
        'F5 . C5 . F5 . A5 . | G5 . E5 . C5 - . . | D5 . F5 . A5 . D6 . | C6 . A5 . F5 - . . |' +
        'Bb5 . A5 . G5 . F5 . | G5 . A5 . C6 - . . | A5 . G5 . F5 . E5 . | F5 - - . . . . .',
      bass:
        'F2 . C3 . F2 . C3 . | C3 . G2 . C3 . G2 . | D3 . A2 . D3 . A2 . | F2 . C3 . F2 . C3 . |' +
        'Bb2 . F2 . Bb2 . F2 . | C3 . G2 . C3 . E3 . | F2 . A2 . C3 . C3 . | F2 . C3 . F2 . . .',
    },
    // R5：おやつをパクッ！（明るく はずむ感じ）
    snack: {
      bpm: 124, lead: 'square', leadVol: 0.3, bassVol: 0.55, drums: true,
      melody:
        'G4 . C5 . E5 . C5 . | D5 . F5 . A5 - . . | G4 . C5 . E5 . G5 . | F5 E5 D5 . C5 - . . |' +
        'A4 . C5 . F5 . C5 . | B4 . D5 . G5 - . . | C5 . E5 . G5 . C6 . | G5 - E5 - C5 - . .',
      bass:
        'C3 . G2 . C3 . G2 . | D3 . A2 . D3 . A2 . | C3 . G2 . C3 . E3 . | F2 . C3 . G2 . G2 . |' +
        'F2 . C3 . F2 . C3 . | G2 . D3 . G2 . D3 . | C3 . G2 . E3 . G2 . | C3 - G2 - C3 - . .',
    },
    // R5：ふわふわ！風船バレー（ゆったり はずむ）
    balloon: {
      bpm: 112, lead: 'triangle', leadVol: 0.42, bassVol: 0.5, drums: true,
      melody:
        'D5 . F#5 . A5 - F#5 . | E5 . G5 . B5 - . . | A5 . F#5 . D5 . F#5 . | E5 - D5 - . . . . |' +
        'G5 . B5 . D6 - B5 . | A5 . F#5 . E5 - . . | D5 . E5 . F#5 . A5 . | D5 - - - . . . .',
      bass:
        'D3 . A2 . D3 . A2 . | E3 . B2 . E3 . B2 . | D3 . A2 . D3 . F#3 . | A2 . E3 . A2 . A2 . |' +
        'G2 . D3 . G2 . D3 . | A2 . E3 . A2 . E3 . | D3 . A2 . D3 . A2 . | D3 - A2 - D3 - . .',
    },
    // R5：なんびきパレード（行進っぽく）
    parade: {
      bpm: 118, lead: 'square', leadVol: 0.26, bassVol: 0.6, drums: true,
      melody:
        'C5 C5 . E5 . G5 - . | F5 . E5 . D5 - . . | G5 G5 . B5 . D6 - . | C6 - - . G5 - . . |' +
        'A5 . G5 . F5 . E5 . | D5 . E5 . F5 - . . | E5 . D5 . C5 . G4 . | C5 - - - . . . .',
      bass:
        'C3 . C3 . G2 . G2 . | F2 . F2 . G2 . G2 . | G2 . G2 . D3 . D3 . | C3 . C3 . G2 . G2 . |' +
        'F2 . C3 . F2 . C3 . | G2 . D3 . G2 . D3 . | C3 . G2 . C3 . G2 . | C3 - - - . . . .',
    },
    sub: {
      bpm: 92, lead: 'sine', leadVol: 0.55, bassVol: 0.5, drums: false, arp: true,
      melody:
        'D5 - - . F#5 - A5 - | G5 - - . E5 - - . | F#5 - - . A5 - D6 - | C#6 - - . A5 - - . |' +
        'B5 - - . A5 - F#5 - | G5 - - . E5 - - . | F#5 - E5 - D5 - C#5 - | D5 - - - . . . .',
      bass:
        'D3 - - - - - - - | G2 - - - - - - - | D3 - - - - - - - | A2 - - - - - - - |' +
        'B2 - - - - - - - | G2 - - - - - - - | A2 - - - - - - - | D3 - - - - - - -',
    },
  };
  Object.keys(SONGS).forEach(function (k) {
    SONGS[k].mel = parseTrack(SONGS[k].melody);
    SONGS[k].bas = parseTrack(SONGS[k].bass);
  });

  let song = null, songName = null, step = 0, nextTime = 0, timer = null;

  function schedule() {
    if (!ctx || !song) return;
    const stepDur = 60 / song.bpm / 2;
    // ページが固まったあと（確認ダイアログなど）に、遅れた音符をまとめて鳴らさない
    if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.05;
    while (nextTime < ctx.currentTime + 0.15) {
      const i = step % song.mel.length;
      const m = song.mel[i];
      if (m && m.n != null) {
        const d = stepDur * m.len * 0.92;
        tone({ f: note(m.n), dur: d + 0.06, type: song.lead, vol: 0.32 * song.leadVol, attack: 0.012, at: nextTime, bus: 'bgm' });
        if (song.lead !== 'sine') tone({ f: note(m.n), dur: d + 0.04, type: 'sine', vol: 0.12, attack: 0.01, at: nextTime, bus: 'bgm', detune: 6 });
      }
      const b = song.bas[i % song.bas.length];
      if (b && b.n != null) {
        tone({ f: note(b.n), dur: stepDur * b.len * 0.95 + 0.05, type: 'triangle', vol: 0.42 * song.bassVol, attack: 0.01, at: nextTime, bus: 'bgm' });
      }
      if (song.arp) {
        // 泡のようなきらきらアルペジオ
        const bar = Math.floor(i / 8);
        const roots = [62, 55, 62, 57, 59, 55, 57, 62];
        const r = roots[bar % roots.length] + 12;
        const arp = [0, 7, 12, 16, 12, 7, 4, 7];
        tone({ f: note(r + arp[i % 8]), dur: 0.22, type: 'sine', vol: 0.09, attack: 0.01, at: nextTime, bus: 'bgm' });
      }
      if (song.drums) {
        const s8 = i % 8;
        if (s8 === 0 || s8 === 4) tone({ f: 120, f2: 45, dur: 0.14, type: 'sine', vol: 0.5, attack: 0.002, at: nextTime, bus: 'bgm' });
        if (s8 === 2 || s8 === 6) noise({ dur: 0.1, vol: 0.12, f: 2200, q: 0.8, at: nextTime, bus: 'bgm' });
        noise({ dur: 0.035, vol: 0.05, f: 8000, q: 0.6, filter: 'highpass', at: nextTime, bus: 'bgm' });
      }
      nextTime += stepDur;
      step++;
    }
  }

  function playBgm(name) {
    if (name === songName) return;
    stopBgm();
    songName = name || null;
    if (!name || !SONGS[name]) { songName = null; return; }
    song = SONGS[name];
    if (!ensure()) return;
    step = 0;
    nextTime = ctx.currentTime + 0.1;
    timer = setInterval(schedule, 40);
    schedule();
  }
  function stopBgm() {
    if (timer) clearInterval(timer);
    timer = null;
    song = null;
    songName = null;
  }

  function applyBus() {
    if (!ctx) return;
    const t = ctx.currentTime;
    sfxBus.gain.setTargetAtTime(sfxOn ? SFX_VOL : 0, t, 0.02);
    bgmBus.gain.setTargetAtTime(bgmOn ? (ducked ? BGM_VOL * 0.35 : BGM_VOL) : 0, t, 0.08);
  }

  window.ArcadeAudio = {
    unlock: function () { ensure(); },
    ready: ready,
    sfx: sfx,
    tone: function (o) { tone(o); },
    noise: function (o) { noise(o); },
    note: note,
    playBgm: function (name) {
      // ユーザー操作前は AudioContext が止まっているため、名前だけ覚えておく
      if (!ctx) { songName = null; pendingBgm = name; return; }
      playBgm(name);
    },
    resumePending: function () { if (pendingBgm !== undefined) { const n = pendingBgm; pendingBgm = undefined; playBgm(n); } },
    stopBgm: stopBgm,
    get currentBgm() { return songName; },
    setSfxOn: function (v) { sfxOn = !!v; applyBus(); },
    setBgmOn: function (v) { bgmOn = !!v; applyBus(); },
    get sfxOn() { return sfxOn; },
    get bgmOn() { return bgmOn; },
    duck: function (v) { ducked = !!v; applyBus(); },
    names: Object.keys(SFX),
  };
  let pendingBgm;
})();
