#!/usr/bin/env python3
"""Собирает docs/*.html из docs/_build/pages/*.html.

Каждый пример из docs/examples/*.js запускается настоящим d8, и на страницу
попадает его фактический вывод (он же сохраняется в examples/*.out.txt).

    python3 docs/_build/build.py            # запустить примеры и собрать сайт
    python3 docs/_build/build.py --no-run   # взять вывод из сохранённых .out.txt

Первые строки примера могут задать запуск: `// d8-flags: --module` добавляет флаги d8,
`// d8-exit: 1` говорит, что пример должен завершиться с этим кодом.
"""

import html
import math
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES_DIR = os.path.join(ROOT, '_build', 'pages')
EXAMPLES = os.path.join(ROOT, 'examples')
# d8 that runs the examples: REGIONS_D8, or the one scripts/setup.sh builds.
D8 = os.environ.get('REGIONS_D8', os.path.join(os.path.dirname(ROOT), 'v8-src', 'v8', 'out', 'release', 'd8'))
D8_FLAGS = ['--harmony-regions', '--max-serializer-memory=4000']
WARNING = 'V8 is running with experimental features enabled. Stability and security will suffer.'

PAGES = [
    ('index', 'Что это такое'),
    ('problem', 'Зачем это нужно'),
    ('ideas', 'Идея владения'),
    ('guide', 'API шаг за шагом'),
    ('spawn', 'spawn: задачи в потоках'),
    ('channels', 'Каналы'),
    ('practices', 'Как делать и как не делать'),
    ('tooling', 'Редактор и линтеры'),
    ('inside', 'Как это устроено'),
    ('numbers', 'Цифры'),
    ('limits', 'Ограничения и планы'),
]

# ---------------------------------------------------------------- примеры


HEADER = re.compile(r'^// d8-(flags|exit): (.*)$')


def example_options(path):
    """Строки в начале примера: `// d8-flags: --module` — дополнительные флаги d8,
    `// d8-exit: 1` — ожидаемый код выхода (по умолчанию 0)."""
    flags, exit_code = [], 0
    with open(path, encoding='utf-8') as f:
        for line in f:
            m = HEADER.match(line.rstrip('\n'))
            if not m:
                break
            if m.group(1) == 'flags':
                flags += m.group(2).split()
            else:
                exit_code = int(m.group(2))
    return flags, exit_code


def run_examples(run):
    outputs = {}
    for name in sorted(os.listdir(EXAMPLES)):
        if not name.endswith('.js'):
            continue
        path = os.path.join(EXAMPLES, name)
        out_path = path[:-3] + '.out.txt'
        if run:
            flags, expected_exit = example_options(path)
            proc = subprocess.run([D8] + D8_FLAGS + flags + [path], capture_output=True,
                                  text=True, timeout=60)
            text = (proc.stdout + proc.stderr)
            lines = [l for l in text.splitlines() if l.strip() != WARNING]
            text = '\n'.join(lines).rstrip() + '\n'
            if proc.returncode != expected_exit:
                sys.exit('example %s exited with code %d, expected %d:\n%s'
                         % (name, proc.returncode, expected_exit, text))
            with open(out_path, 'w', encoding='utf-8') as f:
                f.write(text)
            print('ran %-28s ok' % name)
        with open(out_path, encoding='utf-8') as f:
            outputs[name] = f.read()
    return outputs


KEYWORDS = set('''const let var function return if else for of in while do try catch finally
throw new class async await break continue typeof instanceof using this arguments null
undefined true false switch case default delete void yield static extends super'''.split())
API_GLOBALS = {'Region', 'spawn', 'Channel', 'Worker', 'SharedArrayBuffer', 'Atomics', 'postMessage', 'onmessage'}
API_METHODS = {'run', 'freeze', 'thaw', 'borrow', 'release', 'join', 'of', 'postMessage',
               'getMessage', 'terminate', 'frozen', 'readers', 'owner', 'id', 'poolSize',
               'frozenHere', 'borrowWhile', 'idle', 'send', 'recv', 'sendSync',
               'recvSync', 'select', 'selectSync', 'close', 'free', 'freed', 'byteSize',
               'stats', 'enter', 'object', 'array'}

TOKEN = re.compile(r'''
   (?P<comment>//[^\n]*|/\*[\s\S]*?\*/)
 | (?P<template>`)
 | (?P<string>'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*")
 | (?P<number>\b\d[\d_]*(?:\.\d+)?n?\b)
 | (?P<ident>[A-Za-z_$][\w$]*)
''', re.X)


def span(cls, text):
    return '<span class="tok-%s">%s</span>' % (cls, html.escape(text, quote=False))


def highlight(src, pos=0, stop=None):
    """Возвращает (html, позиция). stop='}' — разбор интерполяции ${...}."""
    out = []
    depth = 0
    while pos < len(src):
        ch = src[pos]
        if stop == '}':
            if ch == '{':
                depth += 1
            elif ch == '}':
                if depth == 0:
                    return ''.join(out), pos
                depth -= 1
        m = TOKEN.match(src, pos)
        if not m:
            out.append(html.escape(ch, quote=False))
            pos += 1
            continue
        kind = m.lastgroup
        text = m.group(0)
        if kind == 'template':
            part, pos = highlight_template(src, pos + 1)
            out.append(part)
            continue
        if kind == 'ident':
            before = src[:pos].rstrip()
            after = src[m.end():].lstrip()
            if text in KEYWORDS:
                out.append(span('keyword', text))
            elif before.endswith('.') and text in API_METHODS:
                out.append(span('api', text))
            elif text in API_GLOBALS and not before.endswith('.'):
                out.append(span('api', text))
            elif after.startswith('('):
                out.append(span('fn', text))
            else:
                out.append(html.escape(text, quote=False))
        else:
            out.append(span(kind, text))
        pos = m.end()
    return ''.join(out), pos


def highlight_template(src, pos):
    out = ['<span class="tok-string">`']
    buf = []
    while pos < len(src):
        ch = src[pos]
        if ch == '\\':
            buf.append(src[pos:pos + 2])
            pos += 2
            continue
        if ch == '`':
            buf.append('`')
            out.append(html.escape(''.join(buf), quote=False))
            out.append('</span>')
            return ''.join(out), pos + 1
        if src.startswith('${', pos):
            out.append(html.escape(''.join(buf), quote=False))
            buf = []
            out.append('${</span>')
            inner, pos = highlight(src, pos + 2, stop='}')
            out.append(inner)
            out.append('<span class="tok-string">}')
            pos += 1
            continue
        buf.append(ch)
        pos += 1
    out.append(html.escape(''.join(buf), quote=False))
    out.append('</span>')
    return ''.join(out), pos


def render_output(text):
    lines = []
    for line in text.rstrip('\n').split('\n'):
        esc = html.escape(line, quote=False)
        if 'Error' in line:
            esc = '<span class="err">%s</span>' % esc
        lines.append(esc)
    return '\n'.join(lines)


def example_block(name, flags, outputs):
    path = os.path.join(EXAMPLES, name)
    with open(path, encoding='utf-8') as f:
        src = f.read().rstrip('\n')
    code, _ = highlight(src)
    if 'timing' in flags:
        hint = 'настоящий вывод d8; время у вас будет другим'
    elif 'varies' in flags:
        hint = 'настоящий вывод d8; числа меняются от запуска к запуску'
    else:
        hint = 'настоящий вывод d8'
    extra_flags, exit_code = example_options(path)
    if extra_flags:
        hint = hint.replace('вывод d8', 'вывод d8 ' + ' '.join(extra_flags), 1)
    if exit_code:
        hint += '; код выхода %d' % exit_code
    block = (
        '<figure class="example">'
        '<div class="ex-head"><span class="file"><a href="examples/{n}">examples/{n}</a></span>'
        '<button class="copy" type="button">Копировать</button></div>'
        '<pre class="code"><code>{code}</code></pre>'
        '<div class="out-head"><span>Вывод</span><span class="hint">{hint}</span></div>'
        '<pre class="out">{out}</pre>'
        '</figure>'
    ).format(n=name, code=code, hint=hint, out=render_output(outputs[name]))
    if 'collapsed' in flags:
        return ('<details class="ex-details"><summary>Код замера и вывод одного запуска '
                '<span class="file">examples/%s</span></summary>%s</details>' % (name, block))
    return block


SNIPPET = re.compile(r'<js-(bad|good)>\n?(.*?)\n?</js-\1>', re.S)


def snippet_block(m):
    kind, src = m.group(1), m.group(2)
    code, _ = highlight(src)
    title = 'Плохо' if kind == 'bad' else 'Хорошо'
    return ('<figure class="snippet %s"><div class="snippet-head"><span class="mark" aria-hidden="true"></span>%s</div>'
            '<pre class="code"><code>%s</code></pre></figure>' % (kind, title, code))


# ---------------------------------------------------------------- графики


def ru(value, digits=None):
    """Число по-русски: десятичная запятая, тонкий пробел в тысячах."""
    if digits is None:
        digits = 0 if value >= 100 or value == int(value) and value >= 10 else (2 if value < 1 else 1)
    s = '%.*f' % (digits, value)
    whole, _, frac = s.partition('.')
    if len(whole) > 4:
        whole = '{:,}'.format(int(whole)).replace(',', '\u2009')
    return whole + (',' + frac if frac else '')


def nice_step(span_, ticks=5):
    raw = span_ / ticks
    mag = 10 ** math.floor(math.log10(raw))
    for m in (1, 2, 2.5, 5, 10):
        if raw <= m * mag:
            return m * mag
    return 10 * mag


def bar_path(x0, y, w, h, r=4):
    if w < 2 * r:
        w = max(w, 2)
        return '<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="1"' % (x0, y, w, h)
    return ('<path d="M%.1f,%.1f h%.1f a%d,%d 0 0 1 %d,%d v%.1f a%d,%d 0 0 1 -%d,%d h-%.1f z"'
            % (x0, y, w - r, r, r, r, r, h - 2 * r, r, r, r, r, w - r))


def hbar_chart(spec):
    W, L, R = 700, 200, 96
    P = W - L - R
    bar_h, pitch, top = 22, 50, 8
    rows = spec['rows']
    vmax = max(max(r['value'], r.get('ideal') or 0) for r in rows)
    if spec.get('ref'):
        vmax = max(vmax, spec['ref'][0])
    step = nice_step(vmax, spec.get('ticks', 5))
    axis_max = math.ceil(vmax / step) * step
    x = lambda v: L + P * v / axis_max
    plot_h = top + pitch * len(rows)
    H = plot_h + 44
    parts = ['<svg viewBox="0 0 %d %d" role="img" aria-labelledby="%s-t">' % (W, H, spec['id'])]
    parts.append('<title id="%s-t">%s</title>' % (spec['id'], html.escape(spec['title'])))
    # сетка и подписи оси
    v = 0
    while v <= axis_max + 1e-9:
        xx = x(v)
        parts.append('<line class="c-grid" x1="%.1f" x2="%.1f" y1="0" y2="%d"/>' % (xx, xx, plot_h))
        parts.append('<text class="c-tick" x="%.1f" y="%d" text-anchor="middle">%s</text>'
                     % (xx, plot_h + 16, ru(v, spec.get('tick_digits', 0))))
        v += step
    parts.append('<line class="c-base" x1="%d" x2="%d" y1="0" y2="%d"/>' % (L, L, plot_h))
    parts.append('<text class="c-axis" x="%.1f" y="%d" text-anchor="middle">%s</text>'
                 % (L + P / 2, plot_h + 38, html.escape(spec['axis'])))
    if spec.get('ref'):
        rv, _ = spec['ref']
        parts.append('<line class="c-ref" x1="%.1f" x2="%.1f" y1="0" y2="%d"/>' % (x(rv), x(rv), plot_h))
    for i, r in enumerate(rows):
        y = top + i * pitch + (pitch - bar_h) / 2 - 4
        cy = y + bar_h / 2
        label = r['label']
        aria = '%s: %s' % (label + (' (' + r['sub'] + ')' if r.get('sub') else ''), r['text'])
        parts.append('<g class="bar" tabindex="0" role="img" aria-label="%s" data-value="%s" data-label="%s" data-note="%s">'
                     % (html.escape(aria), html.escape(r['text']), html.escape(label + (', ' + r['sub'] if r.get('sub') else '')),
                        html.escape(r.get('note', ''))))
        parts.append('<rect class="c-hit" x="0" y="%.1f" width="%d" height="%d" rx="6"/>' % (y - 10, W, bar_h + 20))
        parts.append('<text class="c-cat" x="%d" y="%.1f" text-anchor="end">%s</text>'
                     % (L - 12, cy + (-2 if r.get('sub') else 4.5), html.escape(label)))
        if r.get('sub'):
            parts.append('<text class="c-cat-s" x="%d" y="%.1f" text-anchor="end">%s</text>'
                         % (L - 12, cy + 13, html.escape(r['sub'])))
        w = x(r['value']) - L
        parts.append(bar_path(L, y, w, bar_h) + ' class="c-s%d"/>' % r.get('series', 1))
        if r.get('ideal'):
            parts.append('<rect class="c-ideal" x="%.1f" y="%.1f" width="3" height="%d" rx="1"/>'
                         % (x(r['ideal']) - 1.5, y - 4, bar_h + 8))
        label_x = max(L + max(w, 2), x(r['ideal']) + 2 if r.get('ideal') else 0) + 7
        parts.append('<text class="c-val" x="%.1f" y="%.1f">%s</text>' % (label_x, cy + 4.5, html.escape(r['text'])))
        parts.append('</g>')
    parts.append('</svg>')

    legend = ''
    if spec.get('legend'):
        items = ''.join('<li><span class="sw %s"></span>%s</li>' % (cls, html.escape(t)) for cls, t in spec['legend'])
        legend = '<ul class="legend">%s</ul>' % items

    head = ''.join('<th%s>%s</th>' % (' class="num"' if i else '', html.escape(c))
                   for i, c in enumerate(spec['table_head']))
    body = ''.join('<tr>%s</tr>' % ''.join('<td%s>%s</td>' % (' class="num"' if i else '', html.escape(c))
                                           for i, c in enumerate(row))
                   for row in spec['table'])
    table = ('<details class="table-view"><summary>Показать таблицей</summary>'
             '<div class="table-wrap"><table><thead><tr>%s</tr></thead><tbody>%s</tbody></table></div></details>'
             % (head, body))
    return ('<figure class="chart"><h4>%s</h4><p class="sub">%s</p>%s%s%s%s</figure>'
            % (html.escape(spec['title']), spec['sub'], legend, ''.join(parts), table,
               '<figcaption>%s</figcaption>' % spec['caption'] if spec.get('caption') else ''))


CHARTS = {
    # Медианы пяти запусков tests/{bench,bench-writes,bench-frozen,spawn}.js и
    # docs/examples/36-create.js на out/docs/d8 с флагами --harmony-regions --max-serializer-memory=4000.
    'move-1m': {
        'id': 'ch-move',
        'title': 'Отправить дерево из 1 млн узлов в воркер',
        'sub': 'Время одной операции, мс. Короче значит лучше.',
        'axis': 'миллисекунды',
        'legend': [('s2', 'обычный postMessage'), ('s1', 'регионы')],
        'rows': [
            {'label': 'Копия', 'sub': 'structured clone', 'value': 928, 'series': 2, 'text': '928 мс'},
            # region.run, 1 млн узлов: 601,0 · 611,2 · 585,8 · 591,9 · 598,3 мс;
            # 1 тыс. узлов: 0,466 · 0,440 · 0,451 · 0,432 · 0,461 мс.
            {'label': 'Создание региона', 'sub': 'копия внутрь, один раз', 'value': 598, 'series': 1, 'text': '598 мс'},
            {'label': 'Переезд региона', 'sub': 'transfer list', 'value': 0.12, 'series': 1, 'text': '0,12 мс',
             'note': 'столбик слишком короткий, чтобы его увидеть'},
        ],
        'table_head': ['Операция', '1 тыс. узлов', '1 млн узлов'],
        'table': [
            ['postMessage, structured clone', '0,92 мс', '928 мс'],
            ['region.run (создание региона)', '0,45 мс', '598 мс'],
            ['postMessage, переезд региона', '0,02 мс', '0,12 мс'],
        ],
    },
    'create': {
        'id': 'ch-create',
        'title': 'Положить 200 000 товаров в регион',
        'sub': 'Объекты { id, name, tags, price }. Время создания всего массива, мс. Короче значит лучше.',
        'axis': 'миллисекунды',
        'legend': [('s2', 'без регионов'), ('s1', 'в регион')],
        'rows': [
            {'label': 'Обычные объекты', 'sub': 'без регионов', 'value': 26, 'series': 2, 'text': '26 мс'},
            {'label': 'region.run', 'sub': 'обычные объекты и копия', 'value': 194, 'series': 1, 'text': '194 мс'},
            {'label': 'Литерал #{}', 'sub': 'по одному, push', 'value': 253, 'series': 1, 'text': '253 мс',
             'note': 'без копии, но каждый литерал — вызов рантайма; push идёт без него'},
            {'label': 'Region.object', 'sub': 'по одному, в enter', 'value': 472, 'series': 1, 'text': '472 мс'},
            {'label': 'Region.object', 'sub': 'по одному, push', 'value': 479, 'series': 1, 'text': '479 мс',
             'note': 'push почти ничего не добавляет: около 25 нс на элемент'},
        ],
        'table_head': ['Способ', 'Создание', 'Проход по ценам', 'Создание, пять запусков'],
        'table': [
            ['Обычные объекты', '26 мс', '0,2 мс', '27 · 25 · 26 · 26 · 25'],
            ['region.run', '194 мс', '2,0 мс', '193 · 192 · 194 · 196 · 197'],
            ['Литерал #{} и push', '253 мс', '2,2 мс', '257 · 249 · 253 · 257 · 251'],
            ['Region.object по одному', '472 мс', '2,0 мс', '472 · 466 · 473 · 472 · 476'],
            ['Region.object и push', '479 мс', '2,1 мс', '479 · 468 · 472 · 480 · 480'],
        ],
    },
    'access-ratio': {
        'id': 'ch-access',
        'title': 'Доступ к объектам региона по сравнению с обычными',
        'sub': 'Во сколько раз дольше, чем с обычными объектами. 1 — одинаково, меньше 1 — быстрее. Дерево и массив по 1 млн элементов.',
        'axis': 'во сколько раз дольше обычного JS',
        'ref': (1, 'обычный JS'),
        'tick_digits': 0,
        'legend': [('ref', 'вертикальная линия: обычный JS = 1')],
        'rows': [
            {'label': 'Чтение полей', 'sub': 'сумма по дереву', 'value': 21.9 / 21.2, 'text': '×1,0',
             'note': 'обычные 21,2 мс, регион 21,9 мс'},
            {'label': 'Запись полей', 'sub': 'в каждый узел', 'value': 28.4 / 4.72, 'text': '×6,0',
             'note': 'обычные 4,7 мс, регион 28,4 мс'},
            {'label': 'Доступ по индексу', 'sub': 'сумма массива', 'value': 7.70 / 0.70, 'text': '×11,0',
             'note': 'обычный массив 0,70 мс, регион 7,7 мс'},
        ],
        'table_head': ['Операция', 'Обычные объекты', 'Регион', 'Отношение'],
        'table': [
            ['Сумма по дереву (чтение)', '21,2 мс', '21,9 мс', '×1,0'],
            ['Запись в каждый узел дерева', '4,7 мс', '28,4 мс', '×6,0'],
            ['Сумма массива по индексу', '0,70 мс', '7,7 мс', '×11,0'],
        ],
    },
    'frozen-scaling': {
        'id': 'ch-scale',
        'title': 'Параллельное чтение одного замороженного дерева',
        'sub': '8 проходов по дереву из 1 млн узлов делятся поровну между потоками. Время всей работы, мс.',
        'axis': 'миллисекунды',
        'legend': [('s1', 'фактическое время'), ('tick', 'идеальное ускорение (время / число потоков)')],
        'rows': [
            {'label': '1 поток', 'sub': 'только главный', 'value': 146.9, 'text': '146,9 мс'},
            {'label': '2 воркера', 'value': 75.7, 'ideal': 146.9 / 2, 'text': '75,7 мс · ×1,9',
             'note': 'идеально было бы 73,5 мс'},
            {'label': '4 воркера', 'value': 38.3, 'ideal': 146.9 / 4, 'text': '38,3 мс · ×3,8',
             'note': 'идеально было бы 36,7 мс'},
            {'label': '8 воркеров', 'sub': 'а быстрых ядер 6', 'value': 25.1, 'ideal': 146.9 / 8, 'text': '25,1 мс · ×5,9',
             'note': 'идеально было бы 18,4 мс'},
        ],
        'table_head': ['Потоки', 'Время', 'Ускорение', 'Идеально'],
        'table': [
            ['1 поток', '146,9 мс', '×1,0', '×1'],
            ['2 воркера', '75,7 мс', '×1,9', '×2'],
            ['4 воркера', '38,3 мс', '×3,8', '×4'],
            ['8 воркеров', '25,1 мс', '×5,9', '×8'],
        ],
    },
    'spawn-parallel': {
        'id': 'ch-spawn',
        'title': 'Четыре тяжёлые задачи через spawn',
        'sub': 'Одна и та же вычислительная задача четыре раза. Общее время, мс.',
        'axis': 'миллисекунды',
        'rows': [
            {'label': 'По очереди', 'sub': 'join сразу после spawn', 'value': 738, 'text': '738 мс'},
            {'label': 'Все сразу', 'sub': '4 × spawn, потом 4 × join', 'value': 201, 'text': '201 мс · ×3,7'},
        ],
        'table_head': ['Способ', 'Время'],
        'table': [['По очереди', '738 мс'], ['Все сразу', '201 мс (×3,7)']],
    },
    # ---- Как делать и как не делать (practices.html). Медианы пяти запусков
    # docs/examples/practice-*.js на out/docs/d8; в каждом запуске — лучшее из 3–7 повторов.
    'p-frozen': {
        'id': 'ch-p1',
        'title': '32 задачи читают каталог из 100 000 товаров',
        'sub': 'Время всех задач вместе, мс. Короче значит лучше.',
        'axis': 'миллисекунды',
        'legend': [('s2', 'плохо'), ('s1', 'хорошо')],
        'rows': [
            {'label': 'Обычный массив', 'sub': 'копия в каждую задачу', 'value': 1065, 'series': 2, 'text': '1 065 мс'},
            {'label': 'Замороженный регион', 'sub': 'общий, без копий', 'value': 0.7, 'series': 1, 'text': '0,7 мс',
             'note': 'примерно в 1 500 раз быстрее; столбик слишком короткий, чтобы его увидеть'},
        ],
        'table_head': ['Способ', 'Медиана', 'Пять запусков'],
        'table': [
            ['Захват обычного массива', '1 065 мс', '1 085 · 1 062 · 1 065 · 1 068 · 1 052'],
            ['Захват замороженного региона', '0,7 мс', '0,7 · 1,1 · 0,6 · 0,7 · 0,6'],
        ],
    },
    'p-move': {
        'id': 'ch-p2',
        'title': '10 000 объектов в воркер и обратно',
        'sub': 'Время одного круга, микросекунды. Короче значит лучше.',
        'axis': 'микросекунды',
        'legend': [('s2', 'плохо'), ('s1', 'хорошо')],
        'rows': [
            {'label': 'Новый регион', 'sub': 'region.run каждый круг', 'value': 3585, 'series': 2, 'text': '3 585 мкс'},
            {'label': 'Один регион', 'sub': 'переезд туда-обратно', 'value': 8.8, 'series': 1, 'text': '8,8 мкс',
             'note': 'примерно в 400 раз быстрее'},
        ],
        'table_head': ['Способ', 'Медиана', 'Пять запусков'],
        'table': [
            ['Пересоздавать регион', '3 585 мкс', '3 598 · 3 576 · 3 585 · 3 762 · 3 531'],
            ['Переезд туда-обратно', '8,8 мкс', '9,3 · 8,8 · 8,9 · 8,6 · 8,7'],
        ],
    },
    # p-build — те же пять запусков docs/examples/36-create.js, что и график create.
    'p-build': {
        'id': 'ch-p12',
        'title': '200 000 товаров в регион',
        'sub': 'Время создания всего массива, мс. Короче значит лучше. Проход по готовому массиву у всех трёх одинаковый, около 2 мс.',
        'axis': 'миллисекунды',
        'legend': [('s2', 'по одному объекту'), ('s1', 'одним run')],
        'rows': [
            {'label': 'Region.object', 'sub': 'по одному, push', 'value': 479, 'series': 2, 'text': '479 мс'},
            {'label': 'Литерал #{}', 'sub': 'по одному, push', 'value': 253, 'series': 2, 'text': '253 мс',
             'note': 'без копии, но с вызовом рантайма на каждый литерал'},
            {'label': 'region.run', 'sub': 'обычные объекты и одна копия', 'value': 194, 'series': 1, 'text': '194 мс',
             'note': 'в 2,5 раза быстрее Region.object, в 1,3 раза быстрее литералов'},
        ],
        'table_head': ['Способ', 'Медиана', 'Пять запусков'],
        'table': [
            ['Region.object и push, создание', '479 мс', '479 · 468 · 472 · 480 · 480'],
            ['Литерал #{} и push, создание', '253 мс', '257 · 249 · 253 · 257 · 251'],
            ['region.run, создание', '194 мс', '193 · 192 · 194 · 196 · 197'],
            ['Region.object и push, проход', '2,1 мс', '2,1 · 2,1 · 2,2 · 2,1 · 2,1'],
            ['Литерал #{} и push, проход', '2,2 мс', '2,1 · 2,2 · 2,2 · 2,2 · 2,2'],
            ['region.run, проход', '2,0 мс', '2,0 · 2,0 · 2,0 · 2,0 · 2,0'],
        ],
    },
    'p-batch': {
        'id': 'ch-p3',
        'title': 'Простые числа до 2 000 000',
        'sub': 'Общее время, мс. Короче значит лучше. Вертикальная линия — та же работа в главном потоке без spawn.',
        'axis': 'миллисекунды',
        'ref': (194, 'главный поток'),
        'legend': [('s2', 'плохо'), ('s1', 'хорошо'), ('ref', 'без spawn: 194 мс')],
        'rows': [
            {'label': '10 000 задач', 'sub': 'по 200 чисел', 'value': 57, 'series': 2, 'text': '57 мс',
             'note': 'на 5 мс дольше 100 задач: около 0,5 мкс лишних на задачу'},
            {'label': '100 задач', 'sub': 'по 20 000 чисел', 'value': 52, 'series': 1, 'text': '52 мс',
             'note': 'в 3,7 раза быстрее главного потока'},
            {'label': '4 задачи', 'sub': 'по одной на воркер', 'value': 65, 'series': 1, 'text': '65 мс',
             'note': 'части неравны по работе, последняя считается дольше всех'},
        ],
        'table_head': ['Способ', 'Медиана', 'Пять запусков'],
        'table': [
            ['Главный поток, без spawn', '194 мс', '194 · 195 · 193 · 194 · 193'],
            ['10 000 мелких задач', '57 мс', '56 · 58 · 57 · 56 · 57'],
            ['100 средних задач', '52 мс', '52 · 52 · 52 · 52 · 52'],
            ['4 крупные задачи', '65 мс', '65 · 65 · 65 · 65 · 66'],
        ],
    },
    'p-write': {
        'id': 'ch-p4a',
        'title': 'Миллион шагов, на каждом два поля',
        'sub': 'Время цикла, мс. Короче значит лучше.',
        'axis': 'миллисекунды',
        'tick_digits': 0,
        'legend': [('s2', 'плохо'), ('s1', 'хорошо')],
        'rows': [
            {'label': 'Запись в регион', 'sub': 'на каждом шаге', 'value': 14.27, 'series': 2, 'text': '14,3 мс'},
            {'label': 'Локальные переменные', 'sub': 'в регион один раз', 'value': 0.75, 'series': 1, 'text': '0,75 мс',
             'note': 'в 19 раз быстрее'},
        ],
        'table_head': ['Способ', 'Медиана', 'Пять запусков'],
        'table': [
            ['Запись в регион на каждом шаге', '14,27 мс', '14,27 · 14,27 · 14,27 · 14,27 · 14,32'],
            ['Локально, в регион один раз', '0,75 мс', '0,75 · 0,74 · 0,74 · 0,75 · 0,75'],
        ],
    },
    'p-read': {
        'id': 'ch-p4b',
        'title': '50 проходов по массиву из 100 000 чисел',
        'sub': 'Время вместе с копированием, мс. Короче значит лучше.',
        'axis': 'миллисекунды',
        'legend': [('s2', 'плохо'), ('s1', 'хорошо')],
        'rows': [
            {'label': 'Массив региона', 'sub': 'prices[i] каждый проход', 'value': 34.56, 'series': 2, 'text': '34,6 мс'},
            {'label': 'Копия Array.from', 'sub': 'потом обычный массив', 'value': 19.07, 'series': 2, 'text': '19,1 мс',
             'note': 'сама копия занимает около 15 мс: Array.from идёт через итератор'},
            {'label': 'Копия циклом', 'sub': 'потом обычный массив', 'value': 3.93, 'series': 1, 'text': '3,9 мс',
             'note': 'в 8,8 раза быстрее массива региона'},
        ],
        'table_head': ['Способ', 'Медиана', 'Пять запусков'],
        'table': [
            ['Массив региона', '34,56 мс', '34,56 · 34,38 · 34,43 · 36,23 · 35,84'],
            ['Копия через Array.from', '19,07 мс', '19,13 · 19,13 · 19,07 · 19,07 · 19,01'],
            ['Копия циклом по индексу', '3,93 мс', '3,57 · 3,91 · 3,93 · 3,93 · 3,93'],
        ],
    },
    'p-methods': {
        'id': 'ch-p5',
        'title': 'Сумма квадратов чётных чисел, массив из 1 000 000',
        'sub': 'Один проход, мс. Короче значит лучше.',
        'axis': 'миллисекунды',
        'legend': [('s2', 'методы массива'), ('s1', 'цикл for')],
        'rows': [
            {'label': 'Регион', 'sub': 'filter / map / reduce', 'value': 222.91, 'series': 2, 'text': '223 мс'},
            {'label': 'Копия циклом', 'sub': 'filter / map / reduce', 'value': 27.68, 'series': 2, 'text': '27,7 мс'},
            {'label': 'Регион', 'sub': 'цикл for', 'value': 7.82, 'series': 1, 'text': '7,8 мс',
             'note': 'в 28 раз быстрее методов на регионе'},
            {'label': 'Копия циклом', 'sub': 'цикл for', 'value': 8.74, 'series': 1, 'text': '8,7 мс',
             'note': 'копия стоит дороже, чем выигрывает на одном проходе'},
        ],
        'table_head': ['Способ', 'Медиана', 'Пять запусков'],
        'table': [
            ['Регион, filter/map/reduce', '222,9 мс', '221,1 · 222,2 · 222,9 · 223,3 · 224,5'],
            ['Копия циклом, filter/map/reduce', '27,7 мс', '27,7 · 28,0 · 27,5 · 27,6 · 28,1'],
            ['Регион, цикл for', '7,82 мс', '7,82 · 7,81 · 7,92 · 7,81 · 7,93'],
            ['Копия циклом, цикл for', '8,74 мс', '8,73 · 8,74 · 8,74 · 8,73 · 8,78'],
        ],
    },
    'p-shapes': {
        'id': 'ch-p6',
        'title': 'Сумма поля x по 100 000 объектам региона, 20 проходов',
        'sub': 'Время, мс. Короче значит лучше. Формы — разные порядки одних и тех же четырёх ключей.',
        'axis': 'миллисекунды',
        'legend': [('s1', 'одна форма'), ('s2', 'формы вперемешку')],
        'rows': [
            {'label': 'Одна форма', 'sub': 'x, y, z, w везде', 'value': 20.2, 'series': 1, 'text': '20,2 мс'},
            {'label': '4 формы', 'sub': 'полиморфный IC', 'value': 26.5, 'series': 2, 'text': '26,5 мс',
             'note': 'на 31% медленнее одной формы'},
            {'label': '24 формы', 'sub': 'мегаморфный IC', 'value': 20.3, 'series': 2, 'text': '20,3 мс',
             'note': 'как одна форма; у обычных объектов здесь в 4,9 раза медленнее'},
        ],
        'table_head': ['Форм', 'Объекты региона', 'Обычные объекты'],
        'table': [
            ['1', '20,2 мс', '1,5 мс'],
            ['4', '26,5 мс', '1,7 мс'],
            ['24', '20,3 мс', '7,3 мс'],
        ],
    },
    'p-await': {
        'id': 'ch-p7',
        'title': 'Самая длинная пауза главного потока, пока задача считается ~0,2 с',
        'sub': 'Сколько главный поток не мог ответить ни на одно событие, мс. Короче значит лучше.',
        'axis': 'миллисекунды',
        'legend': [('s2', 'плохо'), ('s1', 'хорошо')],
        'rows': [
            {'label': 'join()', 'sub': 'поток стоит', 'value': 192.5, 'series': 2, 'text': '192,5 мс',
             'note': 'главный поток ответил 1 раз, уже после задачи'},
            {'label': 'await', 'sub': 'поток свободен', 'value': 0.3, 'series': 1, 'text': '0,3 мс',
             'note': 'главный поток ответил около 257 тысяч раз'},
        ],
        'table_head': ['Способ', 'Задача', 'Ответов главного потока', 'Самая длинная пауза'],
        'table': [
            ['join()', '192 мс', '1', '192,5 мс'],
            ['await', '192 мс', '≈257 000', '0,3 мс'],
        ],
    },
    'p-typed': {
        'id': 'ch-p9',
        'title': 'Сумма 1 000 000 чисел',
        'sub': 'Один проход циклом for, мс. Короче значит лучше.',
        'axis': 'миллисекунды',
        'tick_digits': 0,
        'legend': [('s2', 'плохо'), ('s1', 'хорошо')],
        'rows': [
            {'label': 'Массив чисел', 'sub': 'в регионе', 'value': 6.88, 'series': 2, 'text': '6,9 мс'},
            {'label': 'Float64Array', 'sub': 'в регионе', 'value': 0.66, 'series': 1, 'text': '0,66 мс',
             'note': 'в 10 раз быстрее массива региона'},
            {'label': 'Float64Array', 'sub': 'обычный, без регионов', 'value': 0.61, 'series': 1, 'text': '0,61 мс',
             'note': 'почти столько же, сколько в регионе'},
        ],
        'table_head': ['Способ', 'Медиана', 'Пять запусков'],
        'table': [
            ['Сумма, массив чисел в регионе', '6,88 мс', '6,75 · 6,80 · 7,34 · 6,88 · 6,93'],
            ['Сумма, Float64Array в регионе', '0,66 мс', '0,60 · 0,62 · 0,83 · 0,66 · 0,66'],
            ['Сумма, обычный Float64Array', '0,61 мс', '0,60 · 0,62 · 0,62 · 0,61 · 0,61'],
            ['Запись, массив чисел в регионе', '7,82 мс', '7,62 · 7,68 · 7,83 · 7,83 · 7,82'],
            ['Запись, Float64Array в регионе', '1,52 мс', '0,77 · 1,30 · 1,72 · 1,66 · 1,52'],
            ['Запись, обычный Float64Array', '1,48 мс', '1,48 · 0,80 · 0,96 · 1,65 · 1,52'],
        ],
    },
}

# ---------------------------------------------------------------- страницы

LOGO = ('<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">'
        '<rect x="1" y="1" width="24" height="24" rx="7" fill="var(--series-1)"/>'
        '<rect x="6" y="6" width="14" height="14" rx="4" fill="none" stroke="#fff" stroke-width="2"/>'
        '<circle cx="13" cy="13" r="2.6" fill="#fff"/></svg>')

LAYOUT = '''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="description" content="{description}">
<title>{title} · Регионы владения в V8</title>
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="index.html">{logo}<span>Регионы владения</span></a>
  <span class="badge">эксперимент · форк V8</span>
  <span class="spacer"></span>
  <span class="meta">работает только в d8</span>
</header>
<div class="layout">
<nav class="sidebar" aria-label="Разделы">
<ol>
{nav}
</ol>
<p class="side-note">Исследовательский прототип. Все примеры на сайте запущены в собранном d8, вывод настоящий.</p>
</nav>
<main>
<article class="content">
{body}
<nav class="pager" aria-label="Соседние страницы">{pager}</nav>
<p class="footer">Регионы владения в V8 — исследовательский прототип, не продукт. Цифры получены на сборке с включёнными проверками (dcheck), Apple Silicon.</p>
</article>
</main>
</div>
<script src="assets/site.js"></script>
</body>
</html>
'''


def build(run=True):
    outputs = run_examples(run)
    used = set()
    for i, (slug, nav_title) in enumerate(PAGES):
        with open(os.path.join(PAGES_DIR, slug + '.html'), encoding='utf-8') as f:
            src = f.read()
        meta = dict(re.findall(r'<!--\s*(title|description):\s*(.*?)\s*-->', src))
        body = re.sub(r'<!--\s*(title|description):.*?-->\n?', '', src)

        def ex(m):
            name, flags = m.group(1), (m.group(2) or '').split()
            used.add(name)
            return example_block(name, flags, outputs)

        body = re.sub(r'<!--\s*ex:([\w.-]+\.js)((?:\s+\w+)*)\s*-->', ex, body)
        body = re.sub(r'<!--\s*chart:([\w-]+)\s*-->', lambda m: hbar_chart(CHARTS[m.group(1)]), body)
        body = SNIPPET.sub(snippet_block, body)

        nav = '\n'.join('<li><a href="%s.html"%s>%s</a></li>'
                        % (s, ' aria-current="page"' if s == slug else '', html.escape(t))
                        for s, t in PAGES)
        pager = ''
        if i > 0:
            ps, pt = PAGES[i - 1]
            pager += '<a class="prev" href="%s.html"><span>← Назад</span>%s</a>' % (ps, html.escape(pt))
        if i + 1 < len(PAGES):
            ns, nt = PAGES[i + 1]
            pager += '<a class="next" href="%s.html"><span>Дальше →</span>%s</a>' % (ns, html.escape(nt))
        page = LAYOUT.format(title=html.escape(meta.get('title', nav_title)),
                             description=html.escape(meta.get('description', '')),
                             logo=LOGO, nav=nav, body=body.strip(), pager=pager)
        with open(os.path.join(ROOT, slug + '.html'), 'w', encoding='utf-8') as f:
            f.write(page)
        print('built %s.html' % slug)
    unused = sorted(set(outputs) - used)
    if unused:
        print('examples not shown on any page:', ', '.join(unused))


if __name__ == '__main__':
    build(run='--no-run' not in sys.argv)
