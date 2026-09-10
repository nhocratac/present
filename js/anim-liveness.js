/* Slide: hai liveness channel.
   A live signal trace — heartbeat thread vs main thread poll loop — with the two
   timers (session.timeout.ms, max.poll.interval.ms) as gauges underneath.
   Three scenarios: normal, xử lý treo (stall), kill -9. */
(function () {
  'use strict';
  window.DeckAnim = window.DeckAnim || {};

  var PX_PER_SEC = 4;      // trace pixels per virtual second
  var HB_INT     = 3;      // heartbeat.interval.ms  = 3s
  var SESSION    = 45;     // session.timeout.ms     = 45s
  var MAX_POLL   = 300;    // max.poll.interval.ms   = 5 min
  var POLL_DUR   = 0.6;    // poll() itself
  var PROC_DUR   = 6;      // normal processing per batch

  var root, hbCv, mtCv, hbCtx, mtCtx, clockEl, narrEl;
  var gSession, gPoll, pillBroker, pillClient, btns = {};
  var raf = null, running = false;

  var st = null;
  function fresh() {
    return {
      vt: 0, speed: 4, mode: 'normal',
      hbs: [],                       // heartbeat timestamps
      polls: [],                     // {t, dur}
      procs: [],                     // {t, dur}  (dur = Infinity while stalled)
      lastHb: 0, lastPoll: 0,
      nextHb: HB_INT, nextPollAt: 0,
      hbAlive: true, left: false, kicked: false
    };
  }

  function fmt(s) {
    s = Math.max(0, s);
    var m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m > 0 ? m + 'm ' + String(r).padStart(2, '0') + 's' : r + 's';
  }

  window.DeckAnim.liveness = {
    mount: function (body) {
      root = body;
      root.innerHTML =
        '<div class="fig" style="display:flex;gap:22px;align-items:flex-start">' +
          '<div style="flex:1 1 auto;min-width:0">' +

            '<div class="ctl" style="margin-bottom:16px">' +
              '<button class="b primary" data-a="normal">Chạy bình thường</button>' +
              '<button class="b warn" data-a="stall">Giả lập: xử lý treo</button>' +
              '<button class="b warn" data-a="kill">Giả lập: kill -9</button>' +
              '<button class="b" data-a="reset">Reset</button>' +
              '<span class="step-label" id="lv-clock">t = 0s</span>' +
            '</div>' +

            '<div class="lane ch1">' +
              '<div class="lane-name"><b>heartbeat thread</b>mỗi 3s, độc lập</div>' +
              '<div class="track" style="height:46px"><canvas id="lv-hb"></canvas></div>' +
            '</div>' +
            '<div class="lane ch2" style="margin-bottom:18px">' +
              '<div class="lane-name"><b>main thread</b>poll → xử lý → poll</div>' +
              '<div class="track" style="height:64px"><canvas id="lv-mt"></canvas></div>' +
            '</div>' +

            '<div class="gauge ch1" id="lv-g-session">' +
              '<div class="gauge-head"><span class="lab">channel 1 · thời gian từ heartbeat cuối</span>' +
              '<span class="val" id="lv-v-session">0s / 45s</span></div>' +
              '<div class="gauge-bar"><div class="gauge-fill"></div></div>' +
            '</div>' +
            '<div class="gauge ch2" id="lv-g-poll">' +
              '<div class="gauge-head"><span class="lab">channel 2 · thời gian từ poll() cuối</span>' +
              '<span class="val" id="lv-v-poll">0s / 5m</span></div>' +
              '<div class="gauge-bar"><div class="gauge-fill"></div></div>' +
            '</div>' +

            '<div class="narr" id="lv-narr" style="margin-top:16px;min-height:62px">Bấm <b>Chạy bình thường</b> để bắt đầu. Hai channel chạy song song và không biết gì về nhau.</div>' +
          '</div>' +

          '<div style="flex:0 0 268px">' +
            '<div class="panel chc accented" style="margin-bottom:10px">' +
              '<p class="panel-t">Group coordinator</p>' +
              '<p class="panel-d">Chỉ nhìn heartbeat. Không nhận trong <span class="mono">session.timeout.ms</span> → kick member ra khỏi group.</p>' +
              '<div style="margin-top:10px"><span class="pill" id="lv-pill-broker"><span class="dot"></span>chờ</span></div>' +
            '</div>' +
            '<div class="panel ch2 accented" style="margin-bottom:10px">' +
              '<p class="panel-t">Poll-interval timer</p>' +
              '<p class="panel-d">Nằm trong chính consumer. Quá <span class="mono">max.poll.interval.ms</span> → consumer tự gửi LeaveGroup.</p>' +
              '<div style="margin-top:10px"><span class="pill" id="lv-pill-client"><span class="dot"></span>chờ</span></div>' +
            '</div>' +
            '<p class="note" style="border-left-color:var(--paper-3);font-size:13px">Heartbeat thread chạy nền, không dính gì tới business logic — đó là lý do nó vẫn đều khi xử lý đã treo.</p>' +
          '</div>' +
        '</div>';

      hbCv = root.querySelector('#lv-hb');
      mtCv = root.querySelector('#lv-mt');
      hbCtx = hbCv.getContext('2d');
      mtCtx = mtCv.getContext('2d');
      clockEl = root.querySelector('#lv-clock');
      narrEl  = root.querySelector('#lv-narr');
      gSession = root.querySelector('#lv-g-session');
      gPoll    = root.querySelector('#lv-g-poll');
      pillBroker = root.querySelector('#lv-pill-broker');
      pillClient = root.querySelector('#lv-pill-client');

      root.querySelectorAll('[data-a]').forEach(function (b) {
        btns[b.getAttribute('data-a')] = b;
        b.addEventListener('click', function () { action(b.getAttribute('data-a')); });
      });

      reset();
    },

    enter: function () { sizeCanvas(); draw(); },
    leave: function () { stop(); }
  };

  function sizeCanvas() {
    var dpr = window.devicePixelRatio || 1;
    [hbCv, mtCv].forEach(function (c) {
      // clientWidth/Height are unscaled CSS px; getBoundingClientRect is not,
      // because the whole stage carries a CSS transform: scale().
      c.style.width = '100%'; c.style.height = '100%';
      var w = c.clientWidth || 600, h = c.clientHeight || 34;
      c.width  = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  }
  window.addEventListener('resize', function () { if (hbCv) { sizeCanvas(); draw(); } });

  function action(a) {
    if (a === 'reset')  { reset(); return; }
    if (a === 'normal') { reset(); st.mode = 'normal'; st.speed = 4;  start(); say('Poll loop chạy đều. Mỗi <b>poll()</b> reset timer channel 2; mỗi <span class="tick">heartbeat</span> reset timer channel 1. Cả hai gauge đều ở gần 0.'); return; }
    if (a === 'stall')  {
      if (!running) { reset(); st.mode = 'normal'; st.speed = 4; start(); }
      st.mode = 'stall'; st.speed = 40;
      // freeze the processing block that is running right now
      var p = st.procs[st.procs.length - 1];
      if (p) p.dur = Infinity; else st.procs.push({ t: st.vt, dur: Infinity });
      say('Batch này gọi một downstream đang treo. Main thread <b>không quay lại poll()</b> nữa — nhưng heartbeat thread vẫn gửi đều, coordinator vẫn thấy member này alive.');
      return;
    }
    if (a === 'kill') {
      if (!running) { reset(); st.mode = 'normal'; st.speed = 4; start(); }
      st.mode = 'kill'; st.speed = 40; st.hbAlive = false;
      var q = st.procs[st.procs.length - 1];
      if (q) q.dur = Infinity;
      say('Process bị <b>kill -9</b>. Không ai gửi LeaveGroup, không còn heartbeat. Chỉ channel 1 phát hiện được — sau <span class="mono">session.timeout.ms</span>.');
      return;
    }
  }

  function say(html) { narrEl.innerHTML = html; }

  function reset() {
    stop();
    st = fresh();
    gSession.classList.remove('over');
    gPoll.classList.remove('over');
    setPill(pillBroker, '', 'chờ');
    setPill(pillClient, '', 'chờ');
    say('Bấm <b>Chạy bình thường</b> để bắt đầu. Hai channel chạy song song và không biết gì về nhau.');
    sizeCanvas(); render();
  }

  function setPill(el, cls, text) {
    el.className = 'pill' + (cls ? ' ' + cls : '');
    el.innerHTML = '<span class="dot"></span>' + text;
  }

  function start() { if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(loop); } }
  function stop()  { running = false; if (raf) cancelAnimationFrame(raf); raf = null; }

  var last = 0;
  function loop(now) {
    if (!running) return;
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt * st.speed);
    render();
    raf = requestAnimationFrame(loop);
  }

  function step(dv) {
    st.vt += dv;

    // heartbeat thread
    while (st.hbAlive && st.vt >= st.nextHb) {
      st.hbs.push(st.nextHb);
      st.lastHb = st.nextHb;
      st.nextHb += HB_INT;
    }

    // main thread: poll -> process -> poll ...
    if (!st.left && !st.kicked) {
      var lastProc = st.procs[st.procs.length - 1];
      var busy = lastProc && (st.vt < lastProc.t + lastProc.dur);
      if (!busy && st.vt >= st.nextPollAt) {
        st.polls.push({ t: st.vt, dur: POLL_DUR });
        st.lastPoll = st.vt;
        st.procs.push({ t: st.vt + POLL_DUR, dur: st.mode === 'normal' ? PROC_DUR : Infinity });
        st.nextPollAt = st.vt + POLL_DUR;
      }
    }

    // channel 2 fires: consumer leaves on its own
    if (!st.left && !st.kicked && st.vt - st.lastPoll >= MAX_POLL) {
      st.left = true; st.hbAlive = false;
      gPoll.classList.add('over');
      setPill(pillClient, 'deadp', 'LeaveGroup gửi đi');
      setPill(pillBroker, 'warnp', 'nhận LeaveGroup → rebalance');
      say('Timer channel 2 vượt <span class="mono">max.poll.interval.ms</span>. Consumer <b class="bad">tự gửi LeaveGroup</b> — coordinator không hề kick. ' +
          'Partition được assign cho member khác. Khi batch xử lý xong và gọi commit → <span class="mono">CommitFailedException</span>. Đúng dòng log ở đầu bài.');
      stop();
    }

    // channel 1 fires: coordinator kicks
    if (!st.left && !st.kicked && st.vt - st.lastHb >= SESSION) {
      st.kicked = true;
      gSession.classList.add('over');
      setPill(pillBroker, 'deadp', 'kick member → rebalance');
      setPill(pillClient, '', 'im lặng');
      say('Không có heartbeat trong <span class="mono">session.timeout.ms</span>. Coordinator <b class="bad">kick member ra khỏi group</b> và mở rebalance. Đây là channel duy nhất bắt được crash — vì process chết thì không ai gửi được gì.');
      stop();
    }
  }

  function render() {
    clockEl.textContent = 't = ' + fmt(st.vt) + (st.mode !== 'normal' ? '   ·   ' + st.speed + 'x' : '');

    var sinceHb   = st.hbAlive || st.hbs.length ? st.vt - st.lastHb : st.vt;
    var sincePoll = st.vt - st.lastPoll;

    setGauge(gSession, sinceHb / SESSION, fmt(sinceHb) + ' / 45s');
    setGauge(gPoll,    sincePoll / MAX_POLL, fmt(sincePoll) + ' / 5m');

    if (!st.left && !st.kicked && running) {
      setPill(pillBroker, 'alive', 'member alive');
      setPill(pillClient, sincePoll > MAX_POLL * 0.6 ? 'warnp' : 'alive',
              sincePoll > MAX_POLL * 0.6 ? 'sắp hết hạn' : 'đang poll đều');
    }
    draw();
  }

  function setGauge(g, ratio, text) {
    g.querySelector('.gauge-fill').style.width = Math.min(100, ratio * 100) + '%';
    g.querySelector('.val').textContent = text;
    g.classList.toggle('over', ratio >= 1);
  }

  function draw() {
    if (!hbCtx) return;
    var W = hbCv.clientWidth, H = hbCv.clientHeight;
    var W2 = mtCv.clientWidth, H2 = mtCv.clientHeight;
    // grow from the left while the history still fits, then scroll
    var span = st.vt * PX_PER_SEC;
    var x0 = function (t) {
      return span < W ? t * PX_PER_SEC : W - (st.vt - t) * PX_PER_SEC;
    };

    // ---- heartbeat lane ----
    hbCtx.clearRect(0, 0, W, H);
    hbCtx.strokeStyle = '#163a48'; hbCtx.lineWidth = 1;
    hbCtx.beginPath(); hbCtx.moveTo(0, H - 8); hbCtx.lineTo(W, H - 8); hbCtx.stroke();

    hbCtx.strokeStyle = '#3fd6c4'; hbCtx.lineWidth = 1.6;
    hbCtx.beginPath();
    for (var i = 0; i < st.hbs.length; i++) {
      var x = x0(st.hbs[i]);
      if (x < -6 || x > W + 6) continue;
      hbCtx.moveTo(x, H - 8); hbCtx.lineTo(x, 7);
    }
    hbCtx.stroke();
    if (!st.hbAlive && st.hbs.length) {
      var xl = x0(st.lastHb);
      hbCtx.strokeStyle = '#ff5f56'; hbCtx.setLineDash([3, 3]);
      hbCtx.beginPath(); hbCtx.moveTo(Math.max(0, xl), H - 8); hbCtx.lineTo(W, H - 8); hbCtx.stroke();
      hbCtx.setLineDash([]);
    }

    // ---- main thread lane ----
    mtCtx.clearRect(0, 0, W2, H2);
    var top = 9, hgt = H2 - 20;
    st.procs.forEach(function (p) {
      var a = x0(p.t);
      var b = isFinite(p.dur) ? x0(p.t + p.dur) : W2;
      if (b < 0 || a > W2) return;
      mtCtx.fillStyle = isFinite(p.dur) ? 'rgba(245,165,36,.20)' : 'rgba(255,95,86,.20)';
      mtCtx.fillRect(Math.max(0, a), top, Math.min(W2, b) - Math.max(0, a), hgt);
      mtCtx.strokeStyle = isFinite(p.dur) ? 'rgba(245,165,36,.45)' : 'rgba(255,95,86,.55)';
      mtCtx.lineWidth = 1;
      mtCtx.strokeRect(Math.max(0, a) + .5, top + .5, Math.max(1, Math.min(W2, b) - Math.max(0, a) - 1), hgt - 1);
    });
    st.polls.forEach(function (p) {
      var a = x0(p.t);
      if (a < -8 || a > W2) return;
      mtCtx.fillStyle = '#f5a524';
      mtCtx.fillRect(a, top - 3, Math.max(3, p.dur * PX_PER_SEC), hgt + 6);
    });

    // "processing…" label inside a stalled block
    var lastP = st.procs[st.procs.length - 1];
    if (lastP && !isFinite(lastP.dur)) {
      var sx = Math.max(8, x0(lastP.t) + 10);
      if (sx < W2 - 240) {
        mtCtx.fillStyle = '#ff9d97';
        mtCtx.font = '11px "IBM Plex Mono", monospace';
        mtCtx.fillText('processing… không quay lại poll()', sx, top + hgt / 2 + 4);
      }
    }
  }
})();
