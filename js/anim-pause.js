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
    { n: '<span class="mono">poll(100)</span> trả về một batch của <b>P0</b>. Main thread chưa làm gì nặng cả — nó sắp giao việc đi chỗ khác.' },
    { n: '<span class="mono">consumer.pause(P0)</span> — consumer <b>ngừng nhận thêm</b> record của P0, nhưng <b>vẫn giữ</b> P0. Không member nào khác được assign nó.' },
    { n: '<span class="mono">executor.submit(...)</span> — batch đi vào thread pool. Worker xử lý bao lâu tuỳ ý, chuyện đó không còn liên quan gì tới <span class="mono">max.poll.interval.ms</span>.' },
    { n: 'Main thread <b>vẫn gọi poll() đều</b> trong lúc worker chạy. Nhìn timer channel 2: mỗi lần poll là một lần reset.', run: true },
    { n: 'Worker xong sau 4 phút, đẩy <span class="mono">tp</span> vào <span class="mono">doneQueue</span>. Nó không chạm vào consumer — <span class="mono">KafkaConsumer</span> không thread-safe.' },
    { n: '<span class="mono">commitSync()</span> rồi <span class="mono">resume(P0)</span>, cả hai từ main thread. Commit xảy ra <b>sau</b> khi xử lý xong → at-least-once thật sự.' }
  ];

  window.DeckAnim.pause = {
    mount: function (body) {
      root = body;
      root.innerHTML =
        '<div style="display:flex;gap:22px;align-items:flex-start">' +

          '<div style="flex:0 0 505px">' +
            '<pre class="code">while (running) {\n' +
            '  ConsumerRecords&lt;K,V&gt; records = consumer.poll(100);  <span class="c">// luôn gọi đều</span>\n' +
            '  for (TopicPartition tp : records.partitions()) {\n' +
            '    consumer.<span class="kw">pause</span>(singleton(tp));          <span class="c">// ngừng NHẬN thêm</span>\n' +
            '    executor.submit(() -&gt; {\n' +
            '      process(records.records(tp));       <span class="c">// lâu tuỳ ý</span>\n' +
            '      doneQueue.add(tp);                  <span class="c">// báo về main</span>\n' +
            '    });\n' +
            '  }\n' +
            '  for (TopicPartition tp : drain(doneQueue)) {\n' +
            '    consumer.commitSync(offsetsFor(tp)); <span class="c">// commit SAU</span>\n' +
            '    consumer.<span class="kw">resume</span>(singleton(tp));\n' +
            '  }\n}</pre>' +
            '<div class="panel ch1 accented" style="margin-top:12px">' +
              '<p class="panel-t">pause() là client-side thuần</p>' +
              '<p class="panel-d">Không có request nào lên broker. Offset không nhích (lag tăng — đúng ý). Consumer vẫn giữ partition.</p>' +
            '</div>' +
          '</div>' +

          '<div style="flex:1 1 auto;min-width:0">' +
            '<div class="ctl" style="margin-bottom:14px">' +
              '<button class="b primary" data-b="next">Bước tiếp</button>' +
              '<button class="b" data-b="reset">Reset</button>' +
              '<span class="step-label" data-el="step">chưa bắt đầu</span>' +
            '</div>' +

            '<div class="panel ch2" style="margin-bottom:10px">' +
              '<p class="panel-t" style="margin-bottom:9px">Main thread</p>' +
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
              '<div class="worker-h" data-el="wlab">worker thread — rảnh</div>' +
              '<div class="gauge-bar"><div class="gauge-fill" data-el="wbar" style="background:var(--poll)"></div></div>' +
            '</div>' +

            '<div class="panel tight" style="margin-bottom:10px">' +
              '<p class="panel-d" style="font-size:13px">poll() trên partition đã pause <b style="color:var(--hb)">vẫn chạy</b>: join group · xử lý rebalance · auto-commit · reset timer.<br>' +
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
    worker.className = 'worker'; wlab.textContent = 'worker thread — rảnh';
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
    if (i === 2) { worker.className = 'worker busy'; wlab.textContent = 'worker thread — process(batch P0)'; wbar.style.width = '2%'; }
    if (i === 3) runLoop();
    if (i === 4) {
      worker.className = 'worker done';
      wlab.textContent = 'worker thread — xong, doneQueue.add(P0)';
      wbar.style.width = '100%'; wbar.style.background = 'var(--hb)';
    }
    if (i === 5) {
      chip.className = 'chip owned'; chip.textContent = 'P0 · resumed';
      worker.className = 'worker'; wlab.textContent = 'worker thread — rảnh';
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
      wlab.textContent = 'worker thread — process(batch P0)  ·  ' +
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
