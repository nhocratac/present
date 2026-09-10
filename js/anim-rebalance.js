/* Slides: eager vs cooperative rebalance.
   Same engine, two frame scripts. Partition chips physically move between
   members using a FLIP transition, and a counter tracks how many partitions
   stop being processed — which is the whole difference between the two. */
(function () {
  'use strict';
  window.DeckAnim = window.DeckAnim || {};

  var ALL = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'];

  /* ---------- frame scripts ---------- */
  var EAGER = [
    { a: { C1: ['P0','P1','P2'], C2: ['P3','P4','P5'], C3: [] }, pool: [],
      s: { C1:'active', C2:'active', C3:'joining' }, poolT: 'chưa có partition nào bị revoke', hot: false,
      n: 'Assignment đang cân bằng cho 2 member. <b>C3</b> mới lên và gửi <span class="mono">JoinGroup</span>.' },

    { a: { C1: [], C2: [], C3: [] }, pool: ALL.slice(),
      s: { C1:'stopped', C2:'stopped', C3:'joining' }, poolT: 'đã revoke — chưa thuộc về ai', hot: true, stw: true,
      n: '<b>Revoke toàn bộ.</b> <span class="mono">onPartitionsRevoked</span> được gọi cho mọi partition đang giữ. Từ giây này không member nào xử lý gì — <b class="bad">stop-the-world</b>.' },

    { a: { C1: [], C2: [], C3: [] }, pool: ALL.slice(),
      s: { C1:'joining', C2:'joining', C3:'joining' }, poolT: 'đã revoke — chưa thuộc về ai', hot: true, stw: true,
      n: 'Cả group gửi <span class="mono">JoinGroup</span>. Coordinator chờ tới <span class="mono">rebalance.timeout</span> rồi chọn một member làm <b>leader</b>.' },

    { a: { C1: [], C2: [], C3: [] }, pool: ALL.slice(),
      s: { C1:'joining', C2:'joining', C3:'joining' }, poolT: 'leader đang tính assignment', hot: true, stw: true,
      n: 'Leader chạy assignor — <span class="mono">RangeAssignor</span> / <span class="mono">RoundRobin</span> / <span class="mono">StickyAssignor</span> — và tính assignment cho <b>cả group</b>. Coordinator chỉ chuyển tiếp bytes, không hiểu nội dung.' },

    { a: { C1: ['P0','P1'], C2: ['P2','P3'], C3: ['P4','P5'] }, pool: [],
      s: { C1:'joining', C2:'joining', C3:'joining' }, poolT: '', hot: false, stw: true, moving: true,
      n: '<span class="mono">SyncGroup</span> phát assignment mới về từng member. Partition vẫn chưa được xử lý — mới chỉ là được gán.' },

    { a: { C1: ['P0','P1'], C2: ['P2','P3'], C3: ['P4','P5'] }, pool: [],
      s: { C1:'active', C2:'active', C3:'active' }, poolT: '', hot: false,
      n: '<span class="mono">onPartitionsAssigned</span> → xử lý trở lại. Chú ý: <b>C1 đã phải revoke cả P0 và P1 rồi nhận lại y nguyên</b> — gián đoạn hoàn toàn vô ích.' }
  ];

  var COOP = [
    { a: { C1: ['P0','P1','P2'], C2: ['P3','P4','P5'], C3: [] }, pool: [],
      s: { C1:'active', C2:'active', C3:'joining' }, poolT: 'chưa có partition nào bị revoke', hot: false,
      n: 'Điểm xuất phát giống hệt eager. <b>C3</b> gửi <span class="mono">JoinGroup</span>.' },

    { a: { C1: ['P0','P1'], C2: ['P3','P4'], C3: [] }, pool: ['P2','P5'],
      s: { C1:'active', C2:'active', C3:'joining' }, poolT: 'orphaned — tạm thời không ai giữ', hot: true, round: 'ROUND 1',
      n: '<b>Round 1.</b> Assignor tính assignment mới nhưng <b>chỉ trả về partition mà member đã giữ và vẫn giữ</b>. P2 và P5 rơi ra ngoài, thành <b>orphaned</b>. C1 và C2 <span class="tick">vẫn đang xử lý</span> P0 P1 P3 P4.' },

    { a: { C1: ['P0','P1'], C2: ['P3','P4'], C3: [] }, pool: ['P2','P5'],
      s: { C1:'active', C2:'active', C3:'joining' }, poolT: 'orphaned — chờ round 2', hot: true, round: 'ROUND 1',
      n: 'C1 và C2 gọi <span class="mono">onPartitionsRevoked</span> <b>chỉ cho P2 và P5</b>, rồi join lại. Chỉ 2 trong 6 partition bị gián đoạn — 4 cái còn lại không hề dừng.' },

    { a: { C1: ['P0','P1'], C2: ['P3','P4'], C3: ['P2','P5'] }, pool: [],
      s: { C1:'active', C2:'active', C3:'active' }, poolT: '', hot: false, round: 'ROUND 2', moving: true,
      n: '<b>Round 2.</b> Assignor gán P2 và P5 cho C3. Hai vòng rebalance thay vì một — nhưng chỉ partition <b>thực sự phải di chuyển</b> mới bị gián đoạn.' }
  ];

  /* ---------- engine ---------- */
  function build(name, frames, extra) {
    var root, chips = {}, boxes = {}, poolEl, poolHead, narr, stepLabel;
    var btnNext, btnPrev, btnReset, scoreAct, scorePeak, stwEl, roundEl;
    var idx = 0, peak = 0;

    function html() {
      var members = ['C1', 'C2', 'C3'].map(function (id) {
        return '<div class="member" data-m="' + id + '">' +
                 '<div class="member-h"><span class="id">' + id + '</span><span class="st">—</span></div>' +
                 '<div class="slots" data-slots="' + id + '"></div>' +
               '</div>';
      }).join('');

      return '<div class="ctl" style="margin-bottom:16px">' +
               '<button class="b primary" data-b="next">Bước tiếp</button>' +
               '<button class="b" data-b="prev">Lùi</button>' +
               '<button class="b" data-b="reset">Reset</button>' +
               '<span class="step-label" data-el="step"></span>' +
               '<span class="pill deadp" data-el="stw" style="margin-left:auto;display:none">stop-the-world</span>' +
               '<span class="pill" data-el="round" style="margin-left:auto;display:none"><span class="dot"></span></span>' +
             '</div>' +

             '<div class="members" style="margin-bottom:14px">' + members + '</div>' +

             '<div style="display:flex;gap:18px;align-items:stretch">' +
               '<div class="pool" data-el="pool" style="flex:1 1 auto">' +
                 '<div class="pool-h" data-el="poolh"></div>' +
                 '<div class="slots" data-slots="pool"></div>' +
               '</div>' +
               '<div class="panel tight" style="flex:0 0 250px;display:flex;align-items:center">' +
                 '<div class="score">' +
                   '<div class="item"><span class="v good" data-el="act">6</span><span class="l">đang xử lý</span></div>' +
                   '<div class="item"><span class="v bad" data-el="peak">0</span><span class="l">đỉnh gián đoạn</span></div>' +
                 '</div>' +
               '</div>' +
             '</div>' +

             '<div class="narr" data-el="narr" style="margin-top:14px;min-height:52px"></div>' +
             (extra || '');
    }

    return {
      mount: function (body) {
        root = body;
        root.innerHTML = html();

        ['C1', 'C2', 'C3'].forEach(function (id) { boxes[id] = root.querySelector('[data-m="' + id + '"]'); });
        poolEl    = root.querySelector('[data-el="pool"]');
        poolHead  = root.querySelector('[data-el="poolh"]');
        narr      = root.querySelector('[data-el="narr"]');
        stepLabel = root.querySelector('[data-el="step"]');
        scoreAct  = root.querySelector('[data-el="act"]');
        scorePeak = root.querySelector('[data-el="peak"]');
        stwEl     = root.querySelector('[data-el="stw"]');
        roundEl   = root.querySelector('[data-el="round"]');

        ALL.forEach(function (p) {
          var c = document.createElement('span');
          c.className = 'chip owned'; c.textContent = p;
          chips[p] = c;
        });

        btnNext  = root.querySelector('[data-b="next"]');
        btnPrev  = root.querySelector('[data-b="prev"]');
        btnReset = root.querySelector('[data-b="reset"]');
        btnNext.addEventListener('click', function () { if (idx < frames.length - 1) show(idx + 1); });
        btnPrev.addEventListener('click', function () { if (idx > 0) show(idx - 1, true); });
        btnReset.addEventListener('click', function () { peak = 0; show(0, true); });

        show(0, true);
      },
      enter: function () {},
      leave: function () {}
    };

    function slot(key) { return root.querySelector('[data-slots="' + key + '"]'); }

    function show(k, hard) {
      idx = k;
      var f = frames[k];

      // FLIP: record where every chip is now
      var before = {};
      ALL.forEach(function (p) {
        if (chips[p].parentNode) before[p] = chips[p].getBoundingClientRect();
      });

      // re-parent
      ['C1', 'C2', 'C3'].forEach(function (id) {
        f.a[id].forEach(function (p) { slot(id).appendChild(chips[p]); });
      });
      f.pool.forEach(function (p) { slot('pool').appendChild(chips[p]); });

      // chip appearance
      ALL.forEach(function (p) {
        var inPool = f.pool.indexOf(p) >= 0;
        chips[p].className = 'chip ' + (inPool ? 'orphan' : (f.moving ? 'moving' : 'owned'));
      });

      // member states
      var active = 0;
      ['C1', 'C2', 'C3'].forEach(function (id) {
        var s = f.s[id];
        boxes[id].className = 'member ' + s;
        boxes[id].querySelector('.st').textContent =
          s === 'active' ? 'đang xử lý' : (s === 'stopped' ? 'đã revoke hết' : 'joining');
        if (s === 'active') active += f.a[id].length;
      });

      var interrupted = ALL.length - active;
      peak = Math.max(peak, interrupted);
      scoreAct.textContent  = active;
      scorePeak.textContent = peak;
      scoreAct.className  = 'v ' + (active === 6 ? 'good' : (active === 0 ? 'bad' : ''));

      poolEl.classList.toggle('hot', !!f.hot);
      poolEl.style.visibility = (f.pool.length || f.poolT) ? 'visible' : 'hidden';
      poolHead.textContent = f.poolT || '';

      stwEl.style.display   = f.stw ? '' : 'none';
      roundEl.style.display = f.round ? '' : 'none';
      if (f.round) roundEl.innerHTML = '<span class="dot"></span>' + f.round;

      narr.innerHTML = f.n;
      stepLabel.textContent = 'bước ' + (k + 1) + ' / ' + frames.length;
      btnNext.disabled = k >= frames.length - 1;
      btnPrev.disabled = k <= 0;

      // FLIP: play the inverse
      if (!hard) {
        // the stage is CSS-scaled; convert measured deltas back to local px
        var stageEl = document.getElementById('stage');
        var sc = stageEl ? (stageEl.getBoundingClientRect().width / 1280) : 1;
        if (!sc) sc = 1;
        ALL.forEach(function (p) {
          var b = before[p]; if (!b) return;
          var a = chips[p].getBoundingClientRect();
          var dx = (b.left - a.left) / sc, dy = (b.top - a.top) / sc;
          if (Math.abs(dx) < .5 && Math.abs(dy) < .5) return;
          var el = chips[p];
          el.style.transition = 'none';
          el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
          requestAnimationFrame(function () {
            el.style.transition = 'transform .42s cubic-bezier(.22,.75,.3,1)';
            el.style.transform = '';
          });
        });
      }
    }
  }

  window.DeckAnim.eager = build('eager', EAGER, '<div class="grid g2" style="margin-top:14px">' +
      '<div class="panel tight">' +
        '<p class="panel-t">Assignor chạy ở phía client</p>' +
        '<p class="panel-d" style="font-size:12.5px">Coordinator chọn một member làm leader; leader chạy <span class="mono">RangeAssignor</span> / <span class="mono">RoundRobinAssignor</span> / <span class="mono">StickyAssignor</span>. Coordinator chỉ chuyển tiếp bytes, không hiểu nội dung assignment.</p>' +
      '</div>' +
      '<div class="panel tight chd accented">' +
        '<p class="panel-t">Cái giá của eager</p>' +
        '<p class="panel-d" style="font-size:12.5px">Chỉ vì C3 mới join, C1 cũng phải revoke hết — dù cuối cùng nhận lại gần như y nguyên. Toàn bộ group dừng trong suốt 5 bước.</p>' +
      '</div>' +
    '</div>');
  window.DeckAnim.coop  = build('coop',  COOP, '<div class="grid g2" style="margin-top:14px">' +
      '<div class="panel tight">' +
        '<p class="panel-t">Đánh đổi</p>' +
        '<p class="panel-d" style="font-size:12.5px">Hai round rebalance thay vì một. Group nhỏ có thể tổng thời gian dài hơn eager — nhưng thời gian <b>gián đoạn xử lý</b> thì nhỏ hơn hẳn.</p>' +
      '</div>' +
      '<div class="panel tight chd accented">' +
        '<p class="panel-t">Migration — không đổi thẳng</p>' +
        '<p class="panel-d" style="font-size:12.5px">Không chuyển eager → cooperative khi group đang chạy. Rolling 2 lần: <span class="mono">[Range, CooperativeSticky]</span> → <span class="mono">[CooperativeSticky]</span>. Mặc định từ 3.0 là cặp đầu.</p>' +
      '</div>' +
    '</div>');
})();
