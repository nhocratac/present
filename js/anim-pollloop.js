/* Slide: poll loop.
   Walk the six things one poll() call does, with the fetch buffer and the
   max.poll.interval timer reacting at the steps that actually touch them. */
(function () {
  'use strict';
  window.DeckAnim = window.DeckAnim || {};

  var STEPS = [
    { l: 'Đảm bảo đã join group',        d: 'JoinGroup / SyncGroup nếu cần',
      n: 'Nếu consumer chưa thuộc group, poll() là nơi nó join. Không gọi poll() thì không bao giờ vào được group.' },
    { l: 'Xử lý rebalance đang chờ',      d: 'gọi ConsumerRebalanceListener',
      n: 'Đây là điểm quan trọng: <b>rebalance chỉ hoàn tất khi consumer gọi poll()</b>. Group chờ member chậm tới <span class="mono">rebalance.timeout.ms</span> — mà trong Java consumer con số đó <b>chính là</b> <span class="mono">max.poll.interval.ms</span>.' },
    { l: 'Auto-commit nếu đang bật',      d: 'chỉ khi enable.auto.commit=true',
      n: 'Chỉ chạy khi <span class="mono">enable.auto.commit=true</span> (checklist cuối bài tắt nó đi). Khi bật, nó commit offset của batch <b>trước</b>, không phải batch sắp trả về. Ném vào thread pool rồi poll() ngay → commit record chưa xử lý → mất message khi crash.' },
    { l: 'Reset timer max.poll.interval', d: 'channel 2 được gia hạn ở đây',
      n: 'Chính bước này là toàn bộ channel 2. Gọi poll() = hứa &ldquo;tôi vẫn đang làm việc&rdquo;. Không gọi = tự nhận mình đã treo.' },
    { l: 'Gửi FetchRequest',              d: 'cho partition chưa có data trong buffer',
      n: 'Fetch đi ra network và đổ vào buffer nội bộ, giới hạn bởi <span class="mono">fetch.max.bytes</span>. Partition đang <span class="mono">paused</span> thì bước này bị bỏ qua.' },
    { l: 'Trả record từ buffer',          d: 'tối đa max.poll.records',
      n: '<b>Fetch ≠ poll.</b> Fetch: network → buffer. Poll: buffer → app, tối đa <span class="mono">max.poll.records</span>. Một fetch nuôi nhiều poll — giảm max.poll.records không giảm số lần đi network.' }
  ];

  var root, stations, narr, bufEl, gauge, stepLabel, btnNext, btnReset;
  var i = -1, bufIn = 0, bufOut = 0, timerVal = 240;

  window.DeckAnim.pollloop = {
    mount: function (body) {
      root = body;
      var st = STEPS.map(function (s, k) {
        return '<div class="station" data-i="' + k + '">' +
                 '<span class="sn">' + (k + 1) + '</span>' +
                 '<span><span class="sl">' + s.l + '</span><span class="sd">' + s.d + '</span></span>' +
               '</div>';
      }).join('');

      root.innerHTML =
        '<div class="ctl" style="margin-bottom:16px">' +
          '<button class="b primary" id="pl-next">Bước tiếp</button>' +
          '<button class="b" id="pl-reset">Reset</button>' +
          '<span class="step-label" id="pl-step">chưa gọi poll()</span>' +
        '</div>' +
        '<div class="circuit">' +
          '<div class="stations">' + st + '</div>' +
          '<div style="flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:12px">' +

            '<div class="panel ch2">' +
              '<p class="panel-t">Fetch buffer (nội bộ consumer)</p>' +
              '<div class="buf" id="pl-buf" style="margin:10px 0 8px;max-width:none"></div>' +
              '<p class="panel-d" style="font-size:12.5px" id="pl-buf-l">buffer rỗng</p>' +
            '</div>' +

            '<div class="panel ch2">' +
              '<div class="gauge" id="pl-gauge" style="margin:0">' +
                '<div class="gauge-head"><span class="lab">timer max.poll.interval.ms</span>' +
                '<span class="val" id="pl-gv">240s / 300s</span></div>' +
                '<div class="gauge-bar"><div class="gauge-fill"></div></div>' +
              '</div>' +
            '</div>' +

            '<div class="narr ch2" id="pl-narr" style="min-height:82px">' +
              'Consumer đã xử lý 4 phút kể từ poll() trước — timer gần chạm threshold. Bấm <b>Bước tiếp</b> để đi qua một lần gọi poll().' +
            '</div>' +
            '<div class="grid g2" style="gap:12px">' +
              '<div class="panel tight chd accented">' +
                '<p class="panel-t">rebalance.timeout.ms = max.poll.interval.ms</p>' +
                '<p class="panel-d" style="font-size:12.5px">Java consumer không cho set riêng — <span class="mono">GroupRebalanceConfig</span> gán thẳng. Đặt 15 phút nghĩa là <b>mọi</b> rebalance của group đều có thể phải chờ một member chậm tới 15 phút.</p>' +
              '</div>' +
              '<div class="panel tight">' +
                '<p class="panel-t">Auto-commit là của batch trước</p>' +
                '<p class="panel-d" style="font-size:12.5px">Xử lý đồng bộ trong loop → at-least-once. Ném vào thread pool rồi poll() ngay → commit record chưa xử lý → mất message khi crash.</p>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';

      stations  = Array.prototype.slice.call(root.querySelectorAll('.station'));
      narr      = root.querySelector('#pl-narr');
      bufEl     = root.querySelector('#pl-buf');
      gauge     = root.querySelector('#pl-gauge');
      stepLabel = root.querySelector('#pl-step');
      btnNext   = root.querySelector('#pl-next');
      btnReset  = root.querySelector('#pl-reset');

      for (var k = 0; k < 60; k++) bufEl.appendChild(document.createElement('i'));

      btnNext.addEventListener('click', next);
      btnReset.addEventListener('click', reset);
      stations.forEach(function (s) {
        s.addEventListener('click', function () { goTo(parseInt(s.getAttribute('data-i'), 10)); });
      });
      reset();
    },
    enter: function () {},
    leave: function () {}
  };

  function reset() { i = -1; bufIn = 0; bufOut = 0; timerVal = 240; render(); 
    narr.innerHTML = 'Consumer đã xử lý 4 phút kể từ poll() trước — timer gần chạm threshold. Bấm <b>Bước tiếp</b> để đi qua một lần gọi poll().';
  }

  function next() { if (i < STEPS.length - 1) goTo(i + 1); }

  function goTo(k) {
    i = k;
    // recompute derived state for the step we jumped to
    timerVal = (i >= 3) ? 0 : 240;
    bufIn    = (i >= 4) ? 50 : 0;
    bufOut   = (i >= 5) ? 10 : 0;
    render();
    narr.innerHTML = STEPS[i].n;
  }

  function render() {
    stations.forEach(function (s, k) {
      s.classList.toggle('on', k === i);
      s.classList.toggle('done', k < i);
    });
    stepLabel.textContent = i < 0 ? 'chưa gọi poll()' : 'bước ' + (i + 1) + ' / 6';
    btnNext.disabled = i >= STEPS.length - 1;

    var cells = bufEl.children;
    for (var k = 0; k < cells.length; k++) {
      cells[k].className = k < bufOut ? 'out' : (k < bufIn ? 'in' : '');
    }
    root.querySelector('#pl-buf-l').innerHTML =
      bufIn === 0 ? 'buffer rỗng — chưa fetch'
      : (bufOut === 0
          ? '<span style="color:var(--coord)">500 record</span> vừa fetch về buffer'
          : '<span style="color:var(--poll)">100 record</span> trả cho app · <span style="color:var(--coord)">400</span> còn nằm trong buffer cho các poll() sau');

    var ratio = timerVal / 300;
    gauge.querySelector('.gauge-fill').style.width = (ratio * 100) + '%';
    gauge.querySelector('.gauge-fill').style.background = ratio > .7 ? 'var(--dead)' : 'var(--hb)';
    gauge.querySelector('#pl-gv').textContent = Math.round(timerVal) + 's / 300s';
  }
})();
