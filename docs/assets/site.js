// Кнопки копирования у примеров, переключатель языка, подсказки у столбцов графиков, переключатель темы и
// подсветка текущего раздела в оглавлении. Больше скриптов на сайте нет.
(function () {
  'use strict';

  var root = document.documentElement;
  var toggle = document.querySelector('.theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var dark = root.classList.contains('dark') ||
          (!root.classList.contains('light') && matchMedia('(prefers-color-scheme: dark)').matches);
      var next = dark ? 'light' : 'dark';
      root.classList.remove('dark', 'light');
      root.classList.add(next);
      try { localStorage.setItem('theme', next); } catch (e) { /* без хранилища тема живёт до перехода */ }
    });
  }

  // На узком экране разделы — полоса, которая листается вбок: текущий должен быть виден.
  var current = document.querySelector('.sidebar a[aria-current="page"]');
  var sidebar = document.querySelector('.sidebar');
  if (current && sidebar && sidebar.scrollWidth > sidebar.clientWidth) {
    sidebar.scrollLeft = current.offsetLeft - (sidebar.clientWidth - current.offsetWidth) / 2;
  }

  var links = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
  if (links.length && 'IntersectionObserver' in window) {
    var targets = links.map(function (a) { return document.getElementById(a.hash.slice(1)); });
    var visible = new Set();
    var mark = function () {
      // Текущий раздел — первый видимый заголовок, а если не видно ни одного, последний выше экрана.
      var current = -1;
      for (var i = 0; i < targets.length; i++) {
        if (visible.has(targets[i])) { current = i; break; }
        if (targets[i] && targets[i].getBoundingClientRect().top < 120) current = i;
      }
      links.forEach(function (a, i) { a.classList.toggle('active', i === current); });
    };
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { e.isIntersecting ? visible.add(e.target) : visible.delete(e.target); });
      mark();
    }, { rootMargin: '-60px 0px -55% 0px' });
    targets.forEach(function (t) { if (t) observer.observe(t); });
    mark();
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    // file:// не всегда считается безопасным контекстом, поэтому есть запасной путь.
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy') ? resolve() : reject(new Error('copy failed'));
      } catch (e) {
        reject(e);
      } finally {
        document.body.removeChild(area);
      }
    });
  }

  document.querySelectorAll('.example .copy').forEach(function (button) {
    button.addEventListener('click', function () {
      var code = button.closest('.example').querySelector('pre.code');
      var label = button.dataset.label || button.textContent;
      button.dataset.label = label;
      copyText(code.textContent).then(function () {
        button.textContent = button.dataset.done || label;
        button.classList.add('done');
        setTimeout(function () {
          button.textContent = label;
          button.classList.remove('done');
        }, 1600);
      });
    });
  });

  // Другой язык открывается на том же разделе: якоря заголовков на обоих языках одинаковые.
  document.querySelectorAll('a.lang-switch').forEach(function (link) {
    link.addEventListener('click', function () {
      if (location.hash) link.href = link.href.split('#')[0] + location.hash;
    });
  });

  var tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.hidden = true;
  tip.setAttribute('role', 'status');
  document.body.appendChild(tip);

  function show(bar, x, y) {
    tip.textContent = '';
    var value = document.createElement('strong');
    value.textContent = bar.getAttribute('data-value');
    var label = document.createElement('span');
    label.textContent = bar.getAttribute('data-label');
    tip.appendChild(value);
    tip.appendChild(label);
    var note = bar.getAttribute('data-note');
    if (note) {
      var extra = document.createElement('span');
      extra.textContent = ' · ' + note;
      tip.appendChild(extra);
    }
    tip.hidden = false;
    var w = tip.offsetWidth;
    var h = tip.offsetHeight;
    var left = Math.min(Math.max(8, x + 14), window.innerWidth - w - 8);
    var top = y - h - 12 < 8 ? y + 16 : y - h - 12;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  document.querySelectorAll('.chart .bar').forEach(function (bar) {
    bar.addEventListener('pointermove', function (e) { show(bar, e.clientX, e.clientY); });
    bar.addEventListener('pointerleave', function () { tip.hidden = true; });
    bar.addEventListener('focus', function () {
      var r = bar.getBoundingClientRect();
      show(bar, r.left + r.width / 2, r.top);
    });
    bar.addEventListener('blur', function () { tip.hidden = true; });
  });
})();
