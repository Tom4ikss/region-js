// Кнопки «Копировать» у примеров и подсказки у столбцов графиков. Больше скриптов на сайте нет.
(function () {
  'use strict';

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
      copyText(code.textContent).then(function () {
        button.textContent = 'Скопировано';
        button.classList.add('done');
        setTimeout(function () {
          button.textContent = 'Копировать';
          button.classList.remove('done');
        }, 1600);
      });
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
