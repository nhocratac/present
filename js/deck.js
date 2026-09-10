/* Deck runtime: scaling, navigation, spine, TOC overlay, animation lifecycle. */
(function () {
  'use strict';

  var stage    = document.getElementById('stage');
  var viewport = document.getElementById('viewport');
  var slides   = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var spine    = document.getElementById('spine');
  var spineItems = Array.prototype.slice.call(document.querySelectorAll('.spine-item'));
  var bar      = document.querySelector('#progress span');
  var counter  = document.getElementById('counter');
  var overlay  = document.getElementById('toc-ov');
  var ovGrid   = document.getElementById('ov-grid');
  var current  = 0;

  /* ---------- fit the 1280x720 stage into the viewport ---------- */
  function fit() {
    var pad = 28;
    var s = Math.min((window.innerWidth - pad) / 1280, (window.innerHeight - pad) / 720);
    stage.style.transform = 'scale(' + s + ')';
  }
  window.addEventListener('resize', fit);
  fit();

  /* ---------- titles for the overlay, read from each slide ---------- */
  function slideTitle(el) {
    var t = el.getAttribute('data-toc');
    if (t) return t;
    var h = el.querySelector('h1');
    return h ? h.textContent.replace(/\s+/g, ' ').trim() : 'Slide';
  }

  slides.forEach(function (el, i) {
    var item = document.createElement('div');
    item.className = 'ov-item';
    item.innerHTML = '<div class="n">' + String(i + 1).padStart(2, '0') + '</div>' +
                     '<div class="t">' + slideTitle(el) + '</div>';
    item.addEventListener('click', function () { go(i); closeTOC(); });
    ovGrid.appendChild(item);
  });
  var ovItems = Array.prototype.slice.call(ovGrid.children);

  /* ---------- animation registry ---------- */
  /* Each anim module registers window.DeckAnim[name] = { mount(rootEl), enter(), leave() } */
  window.DeckAnim = window.DeckAnim || {};
  var mounted = {};

  function animFor(el) {
    var key = el.getAttribute('data-anim');
    return key ? window.DeckAnim[key] : null;
  }

  /* ---------- navigation ---------- */
  function go(i) {
    if (i < 0 || i >= slides.length) return;
    var prev = slides[current];
    var prevAnim = animFor(prev);
    if (prevAnim && prevAnim.leave) prevAnim.leave();
    prev.classList.remove('is-active');

    current = i;
    var el = slides[current];
    el.classList.add('is-active');

    var a = animFor(el);
    if (a) {
      var key = el.getAttribute('data-anim');
      if (!mounted[key]) { a.mount(el.querySelector('.slide-body')); mounted[key] = true; }
      if (a.enter) a.enter();
    }

    // spine
    var sec = el.getAttribute('data-sec');
    spine.classList.toggle('hidden', el.classList.contains('no-spine'));
    spineItems.forEach(function (s) { s.classList.toggle('on', s.getAttribute('data-sec') === sec); });

    // chrome
    bar.style.width = ((current) / (slides.length - 1) * 100) + '%';
    counter.textContent = String(current + 1).padStart(2, '0') + ' / ' + slides.length;
    ovItems.forEach(function (o, k) { o.classList.toggle('on', k === current); });

    if (location.hash !== '#' + (current + 1)) {
      history.replaceState(null, '', '#' + (current + 1));
    }
  }

  function next() { go(current + 1); }
  function prev() { go(current - 1); }

  /* ---------- TOC overlay ---------- */
  function openTOC()  { overlay.classList.add('open'); }
  function closeTOC() { overlay.classList.remove('open'); }
  function toggleTOC(){ overlay.classList.contains('open') ? closeTOC() : openTOC(); }

  document.querySelectorAll('[data-goto]').forEach(function (r) {
    r.addEventListener('click', function () { go(parseInt(r.getAttribute('data-goto'), 10)); });
  });
  spineItems.forEach(function (s) {
    s.addEventListener('click', function () {
      var sec = s.getAttribute('data-sec');
      for (var i = 0; i < slides.length; i++) {
        if (slides[i].getAttribute('data-sec') === sec) { go(i); break; }
      }
    });
  });

  /* ---------- keyboard ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // let interactive figures own Enter/Space when a button has focus
    var onButton = document.activeElement && document.activeElement.tagName === 'BUTTON';

    switch (e.key) {
      case 'ArrowRight': case 'PageDown': next(); e.preventDefault(); break;
      case 'ArrowLeft':  case 'PageUp':   prev(); e.preventDefault(); break;
      case ' ':          if (!onButton) { next(); e.preventDefault(); } break;
      case 'Home':       go(0); e.preventDefault(); break;
      case 'End':        go(slides.length - 1); e.preventDefault(); break;
      case 't': case 'T': toggleTOC(); e.preventDefault(); break;
      case 'Escape':     closeTOC(); break;
      case 'f': case 'F':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
        e.preventDefault();
        break;
    }
  });
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeTOC(); });

  /* ---------- hero signal trace on the title slide ---------- */
  (function hero() {
    var svg = document.getElementById('hero-trace');
    if (!svg) return;
    var W = 520, H = 720;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function path(d, stroke, w, op) {
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d); p.setAttribute('fill', 'none');
      p.setAttribute('stroke', stroke); p.setAttribute('stroke-width', w);
      p.setAttribute('opacity', op == null ? 1 : op);
      svg.appendChild(p); return p;
    }

    // static grid
    for (var y = 60; y < H; y += 60) {
      path('M0 ' + y + ' H' + W, '#173845', 1, .55);
    }

    var hbLine   = path('', '#3fd6c4', 1.6);
    var pollLine = path('', '#f5a524', 1.6);
    var hbY = 250, pollY = 450, t = 0;

    function build(y, kind, phase) {
      // walk right-to-left so the newest pulse is at the top-right edge
      var d = 'M' + W + ' ' + y, x = W;
      var i = 0;
      while (x > -40) {
        if (kind === 'hb') {
          // steady pulse train, one every 46px
          d += ' H' + (x - 20) + ' V' + (y - 26) + ' H' + (x - 30) + ' V' + y;
          x -= 46;
        } else {
          // poll train that stalls: after 4 pulses a long flat stretch
          var stall = (i >= 4 && i <= 7);
          var w = stall ? 300 : 46;
          if (!stall) { d += ' H' + (x - 20) + ' V' + (y - 26) + ' H' + (x - 30) + ' V' + y; }
          d += ' H' + (x - w);
          x -= w;
          if (stall) i = 8;
        }
        i++;
      }
      return d;
    }

    var hbD = build(hbY, 'hb'), pollD = build(pollY, 'poll');
    hbLine.setAttribute('d', hbD);
    pollLine.setAttribute('d', pollD);

    // labels
    function label(text, y, color) {
      var el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      el.setAttribute('x', 24); el.setAttribute('y', y);
      el.setAttribute('fill', color); el.setAttribute('font-size', '12');
      el.setAttribute('font-family', 'IBM Plex Mono, monospace');
      el.textContent = text; svg.appendChild(el); return el;
    }
    label('heartbeat thread', hbY - 40, '#3fd6c4');
    label('main thread — poll()', pollY - 40, '#f5a524');
    label('stalled', pollY + 26, '#ff5f56');

    if (!reduce) {
      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      svg.insertBefore(g, hbLine);
      // scroll the traces leftward by translating the whole pair
      var wrap = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      svg.appendChild(wrap);
      wrap.appendChild(hbLine); wrap.appendChild(pollLine);
      var off = 0;
      (function tick() {
        off = (off + 0.55) % 46;
        wrap.setAttribute('transform', 'translate(' + (-off) + ',0)');
        requestAnimationFrame(tick);
      })();
    }
  })();

  /* ---------- deep links ---------- */
  window.addEventListener('hashchange', function () {
    var n = parseInt((location.hash || '#1').slice(1), 10);
    if (!isNaN(n) && n - 1 !== current) go(Math.max(0, Math.min(slides.length - 1, n - 1)));
  });

  /* ---------- boot ---------- */
  var initial = parseInt((location.hash || '#1').slice(1), 10);
  go(isNaN(initial) ? 0 : Math.max(0, Math.min(slides.length - 1, initial - 1)));
})();
