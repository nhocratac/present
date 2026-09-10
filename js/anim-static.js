/* Slide: static membership.
   Run the same rolling deploy of 20 pods twice — dynamic membership vs
   group.instance.id — and count rebalances. Then show the cost: a pod that
   really dies is only noticed after session.timeout.ms. */
(function () {
  'use strict';
  window.DeckAnim = window.DeckAnim || {};

  var N = 20;
  var root, narr, timer = null;
  var lanes = {};   // dynamic | static
  var btnRoll, btnCrash, btnReset, stepLabel;
  var crashBar = null, crashRaf = null;

  window.DeckAnim.static = {
    mount: function (body) {
      root = body;
      root.innerHTML =
        '<div class="ctl" style="margin-bottom:16px">' +
          '<button class="b primary" data-b="roll">Rolling deploy 20 pod</button>' +
          '<button class="b warn" data-b="crash">Một pod chết thật</button>' +
          '<button class="b" data-b="reset">Reset</button>' +
          '<span class="step-label" data-el="step">sẵn sàng</span>' +
        '</div>' +

        '<div class="grid g2" style="margin-bottom:14px">' +
          lane('dynamic', 'Dynamic membership', 'không set group.instance.id', 'chd') +
          lane('static',  'Static membership',  'group.instance.id = ${POD_NAME}', 'ch1') +
        '</div>' +

        '<div class="panel tight" data-el="crashbox" style="display:none;margin-bottom:14px">' +
          '<div class="gauge chd" style="margin:0">' +
            '<div class="gauge-head"><span class="lab">static member biến mất — coordinator giữ slot, chờ session.timeout.ms</span>' +
            '<span class="val" data-el="crashv">0s / 45s</span></div>' +
            '<div class="gauge-bar"><div class="gauge-fill"></div></div>' +
          '</div>' +
        '</div>' +

        '<div class="grid g2" style="margin-bottom:14px">' +
          '<div class="panel">' +
            '<p class="panel-t">Ai gửi LeaveGroup, khi nào?</p>' +
            '<table class="cmp" style="margin-top:6px;font-size:13px">' +
              '<thead><tr><th></th><th style="color:var(--paper-2)">close() graceful</th><th style="color:var(--paper-2)">crash / kill -9</th><th style="color:var(--poll)">poll timer expire</th></tr></thead>' +
              '<tbody>' +
                '<tr><td>dynamic</td><td>Gửi LeaveGroup → rebalance ngay</td><td>Không gửi được gì → chờ session.timeout</td><td>Gửi LeaveGroup → rebalance ngay</td></tr>' +
                '<tr><td>static</td><td><b style="color:var(--hb)">KHÔNG</b> gửi → giữ slot</td><td>Không gửi được gì → chờ session.timeout</td><td><b style="color:var(--dead)">KHÔNG</b> gửi → group chờ session.timeout</td></tr>' +
              '</tbody></table>' +
              '<p class="panel-d" style="font-size:12px;margin-top:8px"><span class="mono">shouldSendLeaveGroupRequest()</span> đòi <span class="mono">isDynamicMember()</span> — nên static member treo poll loop là ô <b>chậm phát hiện nhất</b> bảng này.</p>' +
          '</div>' +
          '<div>' +
            '<div class="panel ch1 accented" style="margin-bottom:10px">' +
              '<p class="panel-t">Channel 1 luôn là safety net</p>' +
              '<p class="panel-d">LeaveGroup chỉ là đường tắt cho graceful shutdown. Crash thì không ai gửi gì — coordinator chỉ phát hiện qua <span class="mono">session.timeout.ms</span>.</p>' +
            '</div>' +
            '<p class="note" style="font-size:12.5px">Kafka 4.0 (KIP-1092): <span class="mono">close(CloseOptions)</span> cho static member chọn <span class="mono">LEAVE_GROUP</span> khi scale down thật, không phải restart.</p>' +
            '<p class="note" style="font-size:12.5px;margin-top:9px;border-left-color:var(--poll)">Broker chặn <span class="mono">session.timeout.ms</span> bằng <span class="mono">group.min/max.session.timeout.ms</span> — mặc định <b>6s–30 phút</b>, nên 120s hợp lệ. Nhưng dưới <b>KIP-848</b> trần chỉ còn <b>60s</b>, và là broker config.</p>' +
          '</div>' +
        '</div>' +

        '<div class="narr" data-el="narr">Rolling deploy tắt rồi bật lại từng pod một. Bấm để xem mỗi kiểu membership sinh ra bao nhiêu lần rebalance.</div>';

      ['dynamic', 'static'].forEach(function (k) {
        lanes[k] = {
          pods: Array.prototype.slice.call(root.querySelectorAll('[data-pods="' + k + '"] .pod')),
          count: root.querySelector('[data-count="' + k + '"]'),
          note: root.querySelector('[data-note="' + k + '"]'),
          n: 0
        };
      });

      narr      = root.querySelector('[data-el="narr"]');
      stepLabel = root.querySelector('[data-el="step"]');
      btnRoll   = root.querySelector('[data-b="roll"]');
      btnCrash  = root.querySelector('[data-b="crash"]');
      btnReset  = root.querySelector('[data-b="reset"]');
      crashBar  = root.querySelector('[data-el="crashbox"]');

      btnRoll.addEventListener('click', roll);
      btnCrash.addEventListener('click', crash);
      btnReset.addEventListener('click', reset);
      reset();
    },
    enter: function () {},
    leave: function () { halt(); }
  };

  function lane(key, title, sub, cls) {
    var pods = '';
    for (var i = 0; i < N; i++) pods += '<span class="pod up"></span>';
    return '<div class="panel ' + cls + '">' +
             '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">' +
               '<p class="panel-t" style="margin:0">' + title + '</p>' +
               '<span class="mono" style="font-size:12px;color:var(--paper-3)">rebalance: <b data-count="' + key + '" style="color:var(--paper);font-size:15px">0</b></span>' +
             '</div>' +
             '<p class="panel-d" style="font-size:12px;margin-bottom:10px">' + sub + '</p>' +
             '<div class="pods" data-pods="' + key + '">' + pods + '</div>' +
             '<p class="panel-d" style="font-size:12px;margin-top:9px;min-height:32px" data-note="' + key + '">20 pod đang chạy</p>' +
           '</div>';
  }

  function halt() { if (timer) { clearInterval(timer); timer = null; } if (crashRaf) { cancelAnimationFrame(crashRaf); crashRaf = null; } }

  function reset() {
    halt();
    ['dynamic', 'static'].forEach(function (k) {
      lanes[k].n = 0;
      lanes[k].count.textContent = '0';
      lanes[k].count.style.color = 'var(--paper)';
      lanes[k].pods.forEach(function (p) { p.className = 'pod up'; });
      lanes[k].note.textContent = '20 pod đang chạy';
    });
    crashBar.style.display = 'none';
    stepLabel.textContent = 'sẵn sàng';
    btnRoll.disabled = false;
    narr.innerHTML = 'Rolling deploy tắt rồi bật lại từng pod một. Bấm để xem mỗi kiểu membership sinh ra bao nhiêu lần rebalance.';
  }

  function roll() {
    reset();
    btnRoll.disabled = true;
    var i = 0, phase = 0;   // phase 0 = tắt, 1 = bật lại
    narr.innerHTML = 'Mỗi pod tắt rồi bật lại. <b>Dynamic:</b> tắt gửi LeaveGroup → 1 rebalance, bật gửi JoinGroup → 1 rebalance nữa. <b>Static:</b> coordinator giữ slot, pod lên lại cùng <span class="mono">group.instance.id</span> → nhận lại đúng partition cũ.';

    timer = setInterval(function () {
      if (i >= N) {
        halt();
        btnRoll.disabled = false;
        stepLabel.textContent = 'deploy xong';
        lanes.dynamic.note.innerHTML = '<span style="color:var(--dead)">40 lần rebalance liên tiếp</span> — nếu assignor là eager thì đó là 40 lần stop-the-world.';
        lanes.static.note.innerHTML  = '<span style="color:var(--hb)">0 lần rebalance</span> — mỗi pod nhận lại đúng partition cũ.';
        narr.innerHTML = 'Cùng một rolling deploy: <b class="bad">40 rebalance</b> với dynamic, <b class="tick">0 rebalance</b> với static membership. Đây là lý do <span class="mono">group.instance.id</span> đáng để set.';
        return;
      }

      if (phase === 0) {
        lanes.dynamic.pods[i].className = 'pod down';
        lanes.static.pods[i].className  = 'pod down';
        bump('dynamic');                       // LeaveGroup → rebalance
        stepLabel.textContent = 'pod-' + i + ' tắt';
        phase = 1;
      } else {
        lanes.dynamic.pods[i].className = 'pod new';
        lanes.static.pods[i].className  = 'pod up';
        bump('dynamic');                       // JoinGroup → rebalance
        stepLabel.textContent = 'pod-' + i + ' lên lại';
        phase = 0; i++;
      }
    }, 130);
  }

  function bump(k) {
    lanes[k].n++;
    lanes[k].count.textContent = lanes[k].n;
    lanes[k].count.style.color = 'var(--dead)';
  }

  function crash() {
    halt();
    crashBar.style.display = '';
    var t0 = performance.now();
    var fill = crashBar.querySelector('.gauge-fill');
    var val  = crashBar.querySelector('[data-el="crashv"]');
    var gg   = crashBar.querySelector('.gauge');
    narr.innerHTML = 'Đánh đổi: pod <b>chết thật</b> chứ không phải restart. Static member không gửi LeaveGroup được — group phải chờ hết <span class="mono">session.timeout.ms</span> mới rebalance. Thực tế thường phải nâng lên 2–5 phút để chịu được restart, nên downtime phát hiện cũng dài đúng bằng chừng đó.';
    lanes.static.pods[7].className = 'pod down';

    (function tick(now) {
      var s = Math.min(45, ((now || t0) - t0) / 1000 * 15);   // 15x
      fill.style.width = (s / 45 * 100) + '%';
      val.textContent = s.toFixed(0) + 's / 45s';
      if (s < 45) { crashRaf = requestAnimationFrame(tick); }
      else {
        gg.classList.add('over');
        val.textContent = 'hết hạn → rebalance';
        bump('static');
        lanes.static.note.innerHTML = '<span style="color:var(--dead)">1 rebalance</span>, nhưng phát hiện chậm mất trọn <span class="mono">session.timeout.ms</span>.';
      }
    })(t0);
  }
})();
