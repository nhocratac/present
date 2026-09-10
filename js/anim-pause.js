/* Slide: pause() / resume().
   Watch the poll loop keep its promise to channel 2 while a worker thread
   spends four minutes on the batch. The timer gauge is the point: it never rises. */
(function () {
  'use strict';
  window.DeckAnim = window.DeckAnim || {};

  var root, narr, chip, worker, wbar, wlab, gauge, gval, pollCount, stepLabel;
  var btnNext, btnReset, raf = null;
  var i = -1;

  var STEPS = [
    { n: 'Container gọi <span class="mono">poll()</span> rồi giao batch của <b>P0</b> cho <span class="mono">@KafkaListener</span>. Listener chạy trên <b>container thread</b> — chính thread đang giữ poll loop.' },
    { n: '<span class="mono">container.pausePartition(P0)</span> chỉ thêm P0 vào một <span class="mono">ConcurrentHashMap.newKeySet()</span>; container thread đọc set đó ở <span class="mono">poll()</span> kế tiếp. Consumer <b>vẫn giữ</b> P0.' },
    { n: '<span class="mono">pool.submit(...)</span> — batch rời container thread, listener return ngay nên container quay lại <span class="mono">poll()</span> liền. Thời gian xử lý không còn dính tới <span class="mono">max.poll.interval.ms</span>.' },
    { n: 'Container <b>vẫn poll() đều</b> trong lúc worker chạy — P0 đang pause nên poll không trả record mới của nó. Mỗi lần poll là một lần reset timer channel 2.', run: true },
    { n: 'Worker xong sau 4 phút, gọi <span class="mono">ack.acknowledge()</span>. Cần <span class="mono">AckMode.MANUAL_IMMEDIATE</span> + <span class="mono">asyncAcks=true</span> — Spring hoãn commit lệch thứ tự tới khi mọi offset trước đó trong partition đã commit xong.' },
    { n: '<span class="mono">resumePartition(P0)</span> trong <span class="mono">finally</span> — gọi thẳng từ worker thread được, vì nó chỉ xoá khỏi concurrent set. Nhánh <span class="mono">catch</span> phải <span class="mono">seek()</span> về đầu batch: position đã nhảy qua hết batch ngay lúc poll(), không seek là <b class="bad">mất message</b>.' }
  ];

  window.DeckAnim.pause = {
    mount: function (body) {
      root = body;
      root.innerHTML =
        '<div style="display:flex;gap:22px;align-items:flex-start">' +

          '<div style="flex:0 0 505px">' +
            '<pre class="code" style="font-size:11.5px;line-height:1.55">@KafkaListener(id = "orders", topics = "orders")\n' +
            'public void onBatch(List&lt;ConsumerRecord&lt;String, Order&gt;&gt; recs,\n' +
            '                    Acknowledgment ack) {\n' +
            '  for (TopicPartition tp : partitionsOf(recs)) {\n' +
            '    container.<span class="kw">pausePartition</span>(tp);   <span class="c">// hiệu lực ở poll() kế</span>\n' +
            '    pool.submit(() -&gt; {\n' +
            '      try { process(recordsOf(recs, tp));\n' +
            '            ack.acknowledge(); }      <span class="c">// asyncAcks = true</span>\n' +
            '      catch (Exception e) {\n' +
            '            <span class="kw">seekToBatchStart</span>(tp); }   <span class="c">// thiếu = MẤT message</span>\n' +
            '      finally {\n' +
            '            container.<span class="kw">resumePartition</span>(tp); }\n' +
            '    });\n' +
            '  }\n}</pre>' +
            '<div class="grid g2" style="margin-top:12px;gap:10px">' +
              '<div class="panel tight ch1 accented">' +
                '<p class="panel-t">pause là client-side thuần</p>' +
                '<p class="panel-d" style="font-size:12.5px">Không request nào lên broker. Offset không nhích (lag tăng — đúng ý). Consumer vẫn giữ partition.</p>' +
              '</div>' +
              '<div class="panel tight chd accented">' +
                '<p class="panel-t">Sao không chỉ tăng max.poll.interval.ms?</p>' +
                '<p class="panel-d" style="font-size:12.5px">Vì nó <b>đồng thời</b> là <span class="mono">rebalance.timeout.ms</span>. Đặt 15 phút = mọi rebalance của group đều có thể chờ member chậm tới 15 phút.</p>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div style="flex:1 1 auto;min-width:0">' +
            '<div class="ctl" style="margin-bottom:14px">' +
              '<button class="b primary" data-b="next">Bước tiếp</button>' +
              '<button class="b" data-b="reset">Reset</button>' +
              '<span class="step-label" data-el="step">chưa bắt đầu</span>' +
            '</div>' +

            '<div class="panel ch2" style="margin-bottom:10px">' +
              '<p class="panel-t" style="margin-bottom:9px">Container thread</p>' +
              '<div style="display:flex;gap:9px;align-items:center;margin-bottom:11px">' +
                '<span class="chip owned" data-el="chip">P0</span>' +
                '<span class="mono" style="font-size:12px;color:var(--paper-3)" data-el="polls">poll() đã gọi: 0</span>' +
              '</div>' +
              '<div class="gauge ch2" data-el="gauge" style="margin:0">' +
                '<div class="gauge-head"><span class="lab">timer max.poll.interval.ms</span>' +
                '<span class="val" data-el="gval">0s / 300s</span></div>' +
                '<div class="gauge-bar"><div class="gauge-fill"></div></div>' +
              '</div>' +
            '</div>' +

            '<div class="worker" data-el="worker" style="margin-bottom:10px">' +
              '<div class="worker-h" data-el="wlab">worker pool — rảnh</div>' +
              '<div class="gauge-bar"><div class="gauge-fill" data-el="wbar" style="background:var(--poll)"></div></div>' +
            '</div>' +

            '<div class="panel tight" style="margin-bottom:10px">' +
              '<p class="panel-d" style="font-size:13px">poll() trên partition đã pause <b style="color:var(--hb)">vẫn chạy</b>: join group · xử lý rebalance · commit · reset timer.<br>' +
              'Chỉ <b style="color:var(--dead)">không</b> fetch và không trả record của partition đó.</p>' +
            '</div>' +

            '<div class="narr ch2" data-el="narr">Bấm <b>Bước tiếp</b> để đi qua một vòng pause → xử lý → resume.</div>' +
          '</div>' +
        '</div>';

      narr      = root.querySelector('[data-el="narr"]');
      chip      = root.querySelector('[data-el="chip"]');
      worker    = root.querySelector('[data-el="worker"]');
      wbar      = root.querySelector('[data-el="wbar"]');
      wlab      = root.querySelector('[data-el="wlab"]');
      gauge     = root.querySelector('[data-el="gauge"]');
      gval      = root.querySelector('[data-el="gval"]');
      pollCount = root.querySelector('[data-el="polls"]');
      stepLabel = root.querySelector('[data-el="step"]');
      btnNext   = root.querySelector('[data-b="next"]');
      btnReset  = root.querySelector('[data-b="reset"]');

      btnNext.addEventListener('click', function () { if (i < STEPS.length - 1) go(i + 1); });
      btnReset.addEventListener('click', reset);
      reset();
    },
    enter: function () {},
    leave: function () { halt(); }
  };

  function halt() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

  function reset() {
    halt(); i = -1;
    chip.className = 'chip owned'; chip.textContent = 'P0';
    worker.className = 'worker'; wlab.textContent = 'worker pool — rảnh';
    wbar.style.width = '0%';
    setGauge(0); pollCount.textContent = 'poll() đã gọi: 0';
    stepLabel.textContent = 'chưa bắt đầu';
    btnNext.disabled = false;
    narr.innerHTML = 'Bấm <b>Bước tiếp</b> để đi qua một vòng pause → xử lý → resume.';
  }

  function setGauge(sec) {
    gauge.querySelector('.gauge-fill').style.width = (sec / 300 * 100) + '%';
    gval.textContent = Math.round(sec) + 's / 300s';
  }

  function go(k) {
    halt();
    i = k;
    stepLabel.textContent = 'bước ' + (i + 1) + ' / ' + STEPS.length;
    narr.innerHTML = STEPS[i].n;
    btnNext.disabled = STEPS[i].run || i >= STEPS.length - 1;

    if (i === 0) { chip.className = 'chip owned'; chip.textContent = 'P0'; setGauge(0); }
    if (i === 1) { chip.className = 'chip moving'; chip.textContent = 'P0 · paused'; }
    if (i === 2) { worker.className = 'worker busy'; wlab.textContent = 'worker pool — process(batch P0)'; wbar.style.width = '2%'; }
    if (i === 3) runLoop();
    if (i === 4) {
      worker.className = 'worker done';
      wlab.textContent = 'worker pool — xong, ack.acknowledge()';
      wbar.style.width = '100%'; wbar.style.background = 'var(--hb)';
    }
    if (i === 5) {
      chip.className = 'chip owned'; chip.textContent = 'P0 · resumed';
      worker.className = 'worker'; wlab.textContent = 'worker pool — rảnh';
      wbar.style.width = '0%'; wbar.style.background = 'var(--poll)';
    }
  }

  /* step 3: main thread keeps polling while the worker burns four minutes */
  function runLoop() {
    var t0 = performance.now();
    var DUR = 5200;          // real ms representing 4 virtual minutes
    var polls = 0;

    (function tick(now) {
      var e = Math.min(1, ((now || t0) - t0) / DUR);
      wbar.style.width = (2 + e * 98) + '%';
      wlab.textContent = 'worker pool — process(batch P0)  ·  ' +
        Math.floor(e * 4) + 'm ' + String(Math.floor((e * 240) % 60)).padStart(2, '0') + 's';

      // main thread polls every 200ms of real time -> sawtooth on the timer
      var p = Math.floor(((now || t0) - t0) / 200);
      if (p > polls) { polls = p; pollCount.textContent = 'poll() đã gọi: ' + polls; }
      setGauge((((now || t0) - t0) % 200) / 200 * 1.4);   // never climbs

      if (e < 1) raf = requestAnimationFrame(tick);
      else { raf = null; btnNext.disabled = false; go(4); }
    })(t0);
  }
})();
