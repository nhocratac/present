/* Slide: eager vs cooperative trên cùng một trục thời gian.
   Hai group giống hệt nhau nhận cùng một sự kiện (C3 join) tại t=1s.
   Thứ được đo không phải "rebalance xong lúc nào" mà là "bao nhiêu
   partition-giây xử lý bị mất" — cooperative lâu hơn nhưng mất ít hơn nhiều. */
(function () {
  'use strict';
  window.DeckAnim = window.DeckAnim || {};

  var ALL = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'];
  var T_END = 7;          // virtual seconds on the axis
  var SPEED = 1.45;       // virtual seconds per real second

  // stopped[p] = [start, end) — khi partition đó không được xử lý
  var PLAN = {
    eager: {
      label: 'Eager',
      sub: 'revoke toàn bộ rồi assign lại',
      stop: { P0: [1, 5], P1: [1, 5], P2: [1, 5], P3: [1, 5], P4: [1, 5], P5: [1, 5] },
      done: 5,
      phases: [[1, 2, 'revoke all', 6], [2, 3, 'join', 6], [3, 4, 'assignor', 6], [4, 5, 'sync', 6]]
    },
    coop: {
      label: 'Cooperative',
      sub: 'chỉ revoke P2, P5',
      stop: { P2: [1, 5.5], P5: [1, 5.5] },
      done: 5.5,
      phases: [[1, 3, 'round 1', 2], [3, 5.5, 'round 2', 2]]
    }
  };

  var root, lanes = {}, clockEl, narr, btnRun, btnReset, raf = null, t = 0, running = false;

  function stoppedAt(plan, p, tt) {
    var w = plan.stop[p];
    return !!w && tt >= w[0] && tt < w[1];
  }

  // partition-giây đã mất tính tới thời điểm tt
  function lostAt(plan, tt) {
    var sum = 0;
    ALL.forEach(function (p) {
      var w = plan.stop[p];
      if (!w) return;
      sum += Math.max(0, Math.min(tt, w[1]) - w[0]);
    });
    return sum;
  }

  window.DeckAnim.race = {
    mount: function (body) {
      root = body;
      root.innerHTML =
        '<div class="ctl" style="margin-bottom:14px">' +
          '<button class="b primary" data-b="run">Chạy cả hai</button>' +
          '<button class="b" data-b="reset">Reset</button>' +
          '<span class="step-label" data-el="clock">t = 0.0s</span>' +
          '<span class="step-label" style="margin-left:auto">C3 join lúc t = 1.0s &nbsp;·&nbsp; chiều cao band = số partition đang dừng, nên <b style="color:#ffd0cd">diện tích đỏ = partition-giây mất</b></span>' +
        '</div>' +
        lane('eager', 'chd') + lane('coop', 'ch1') +
        '<div class="narr" data-el="narr" style="margin-top:12px;min-height:50px">' +
          'Hai group giống hệt nhau, cùng nhận một member mới. Bấm <b>Chạy cả hai</b> để xem chúng khác nhau ở đâu.' +
        '</div>';

      ['eager', 'coop'].forEach(function (k) {
        lanes[k] = {
          cells: {},
          veil:  root.querySelector('[data-veil="' + k + '"]'),
          live:  root.querySelector('[data-live="' + k + '"]'),
          lost:  root.querySelector('[data-lost="' + k + '"]'),
          state: root.querySelector('[data-state="' + k + '"]')
        };
        ALL.forEach(function (p) {
          lanes[k].cells[p] = root.querySelector('[data-cell="' + k + '-' + p + '"]');
        });
      });

      clockEl  = root.querySelector('[data-el="clock"]');
      narr     = root.querySelector('[data-el="narr"]');
      btnRun   = root.querySelector('[data-b="run"]');
      btnReset = root.querySelector('[data-b="reset"]');
      btnRun.addEventListener('click', run);
      btnReset.addEventListener('click', reset);
      reset();
    },
    enter: function () {},
    leave: function () { halt(); }
  };

  function lane(key, cls) {
    var plan = PLAN[key];
    var cells = ALL.map(function (p) {
      return '<span class="chip owned" data-cell="' + key + '-' + p + '">' + p + '</span>';
    }).join('');

    // các đoạn nền của timeline: đỏ ở khoảng có partition bị dừng
    // chiều cao mỗi band = tỉ lệ partition đang bị dừng, nên diện tích đỏ
    // chính là số partition-giây bị mất
    var segs = plan.phases.map(function (ph) {
      var l = ph[0] / T_END * 100, w = (ph[1] - ph[0]) / T_END * 100;
      var h = ph[3] / ALL.length * 100;
      return '<div class="tl-seg" style="left:' + l + '%;width:' + w + '%;height:' + h + '%">' +
             '<span>' + ph[2] + ' · ' + ph[3] + '/6</span></div>';
    }).join('');

    return '<div class="panel ' + cls + '" style="margin-bottom:11px">' +
             '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:9px">' +
               '<p class="panel-t" style="margin:0">' + plan.label + '</p>' +
               '<span class="mono" style="font-size:11.5px;color:var(--paper-3)">' + plan.sub + '</span>' +
               '<span class="mono" style="font-size:11.5px;margin-left:auto" data-state="' + key + '">—</span>' +
             '</div>' +
             '<div style="display:flex;gap:14px;align-items:center">' +
               '<div class="slots" style="flex:0 0 auto;min-height:0">' + cells + '</div>' +
               '<div class="tl" style="flex:1 1 auto">' + segs +
                 '<div class="tl-veil" data-veil="' + key + '"></div>' +
               '</div>' +
             '</div>' +
             '<div style="display:flex;gap:26px;margin-top:9px">' +
               '<span class="mono" style="font-size:12px;color:var(--paper-3)">đang xử lý <b data-live="' + key + '" style="color:var(--hb);font-size:14px">6</b> / 6</span>' +
               '<span class="mono" style="font-size:12px;color:var(--paper-3)">đã mất <b data-lost="' + key + '" style="color:var(--dead);font-size:14px">0.0</b> partition-giây</span>' +
             '</div>' +
           '</div>';
  }

  function halt() { running = false; if (raf) cancelAnimationFrame(raf); raf = null; }

  function reset() {
    halt(); t = 0;
    btnRun.disabled = false;
    narr.innerHTML = 'Hai group giống hệt nhau, cùng nhận một member mới. Bấm <b>Chạy cả hai</b> để xem chúng khác nhau ở đâu.';
    render();
  }

  var last = 0;
  function run() {
    if (running) return;
    t = 0; running = true; btnRun.disabled = true;
    narr.innerHTML = 'C3 join lúc <span class="mono">t = 1.0s</span>. Từ đây hai protocol rẽ hướng.';
    last = performance.now();
    raf = requestAnimationFrame(step);
  }

  function step(now) {
    if (!running) return;
    t = Math.min(T_END, t + (now - last) / 1000 * SPEED);
    last = now;
    render();

    if (t >= 2 && t < 3.4) {
      narr.innerHTML = '<b>Eager</b> đã revoke sạch — <span class="bad">0/6 partition được xử lý</span>. <b>Cooperative</b> vẫn chạy 4/6, chỉ P2 và P5 dừng.';
    } else if (t >= 5 && t < 5.6) {
      narr.innerHTML = 'Eager xong ở <span class="mono">t=5.0s</span>, cooperative còn đang ở round 2 — <b>cooperative kết thúc muộn hơn</b>. Nhưng nhìn con số bên phải.';
    } else if (t >= T_END - 0.05) {
      narr.innerHTML = 'Kết: cooperative mất <b class="tick">9.0</b> partition-giây, eager mất <b class="bad">24.0</b> — <b>gấp 2.7 lần</b>, dù eager &ldquo;xong&rdquo; sớm hơn 0.5s. ' +
                       'Cái cần tối ưu là <b>thời gian xử lý bị mất</b>, không phải thời gian rebalance.';
    }

    if (t >= T_END) { halt(); btnRun.disabled = false; return; }
    raf = requestAnimationFrame(step);
  }

  function render() {
    clockEl.textContent = 't = ' + t.toFixed(1) + 's';

    ['eager', 'coop'].forEach(function (k) {
      var plan = PLAN[k], L = lanes[k], live = 0;
      ALL.forEach(function (p) {
        var off = stoppedAt(plan, p, t);
        L.cells[p].className = 'chip ' + (off ? 'orphan' : 'owned');
        if (!off) live++;
      });
      L.live.textContent = live;
      L.live.style.color = live === 6 ? 'var(--hb)' : (live === 0 ? 'var(--dead)' : 'var(--poll)');
      L.lost.textContent = lostAt(plan, t).toFixed(1);
      L.veil.style.left = (t / T_END * 100) + '%';
      L.state.textContent = t === 0 ? '—' : (t < 1 ? 'ổn định' : (t < plan.done ? 'đang rebalance' : 'xong'));
      L.state.style.color = t >= plan.done && t > 0 ? 'var(--hb)' : 'var(--paper-3)';
    });
  }
})();
