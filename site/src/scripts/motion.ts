// Small behaviours of the site, loaded on every page:
//
// - tooltips for chart bars (value, label and note), on hover and on keyboard focus;
// - reveal animations, once per page view: chart bars grow in with their value labels counting
//   up, key numbers count up, and the landing page's race runs (with a replay button).
//
// Every animation starts from the final state the HTML already shows. They run only when <head>
// set the `rj-motion` class, i.e. with JavaScript and without `prefers-reduced-motion`, and every
// count-up ends by putting back the exact original text.

const motion = document.documentElement.classList.contains('rj-motion');

// ---------------------------------------------------------------- numbers in labels

type Lang = 'en' | 'ru';

const NUMBER = {
	en: /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g,
	ru: /\d{1,3}(?:[ \u00a0\u2009\u202f]\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g,
};

interface Part {
	text: string;
	value?: number;
	decimals?: number;
	group?: string;
}

/** Splits a label like "75,7 мс · ×1,9" into text and numbers it can count up. */
function parse(text: string, lang: Lang): Part[] {
	const parts: Part[] = [];
	let last = 0;
	for (const m of text.matchAll(NUMBER[lang])) {
		const raw = m[0];
		const index = m.index ?? 0;
		if (index > last) parts.push({ text: text.slice(last, index) });
		const dec = lang === 'en' ? '.' : ',';
		const group = (lang === 'en' ? /,/ : /[ \u00a0\u2009\u202f]/).exec(raw)?.[0];
		const [whole, frac = ''] = raw.split(dec);
		const value = Number((group ? whole.split(group).join('') : whole) + (frac ? `.${frac}` : ''));
		parts.push({ text: raw, value, decimals: frac.length, group: group ?? undefined });
		last = index + raw.length;
	}
	if (last < text.length) parts.push({ text: text.slice(last) });
	return parts;
}

function format(value: number, part: Part, lang: Lang) {
	const fixed = value.toFixed(part.decimals ?? 0);
	let [whole, frac] = fixed.split('.');
	if (part.group && whole.length > 3) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, part.group);
	return frac ? whole + (lang === 'en' ? '.' : ',') + frac : whole;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Counts the numbers in an element's text up from zero; ends with the exact original text. */
function countUp(el: Element, lang: Lang, duration: number, delay = 0, ease = easeOut) {
	const final = el.getAttribute('data-final') ?? el.textContent ?? '';
	const parts = parse(final, lang);
	if (!parts.some((p) => p.value !== undefined)) return;
	const render = (t: number) =>
		parts.map((p) => (p.value === undefined ? p.text : format(p.value * ease(t), p, lang))).join('');
	el.textContent = render(0);
	const start = performance.now() + delay;
	const frame = (now: number) => {
		const t = Math.min(1, Math.max(0, (now - start) / duration));
		if (t >= 1) {
			el.textContent = final;
			return;
		}
		el.textContent = render(t);
		requestAnimationFrame(frame);
	};
	requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- reveal once

function onReveal(selector: string, run: (el: HTMLElement) => void, threshold = 0.3) {
	const els = document.querySelectorAll<HTMLElement>(selector);
	if (!els.length) return;
	const io = new IntersectionObserver(
		(entries) => {
			for (const e of entries) {
				if (!e.isIntersecting) continue;
				io.unobserve(e.target);
				run(e.target as HTMLElement);
			}
		},
		{ threshold },
	);
	els.forEach((el) => io.observe(el));
}

const langOf = (el: Element): Lang => ((el.closest('[data-lang]')?.getAttribute('data-lang') ?? document.documentElement.lang) === 'ru' ? 'ru' : 'en');

if (motion) {
	// Charts: bars grow in (CSS), value labels count up alongside them.
	onReveal('.chart', (chart) => {
		const lang = langOf(chart);
		chart.querySelectorAll('.bar').forEach((bar, i) => {
			const val = bar.querySelector('.c-val');
			if (val) {
				val.setAttribute('data-final', val.textContent ?? '');
				countUp(val, lang, 900, i * 110);
			}
		});
		chart.classList.add('is-in');
	});

	// Key numbers count up.
	onReveal(
		'.stats',
		(stats) => {
			const lang = langOf(stats);
			stats.querySelectorAll('.stat .value').forEach((v, i) => countUp(v, lang, 1100, i * 120));
		},
		0.4,
	);

	// The race: lanes fill at one speed; the time labels count up in step with them.
	const runRace = (race: HTMLElement) => {
		const lang = langOf(race);
		race.classList.remove('is-in');
		race.querySelectorAll('.lane').forEach((lane) => lane.classList.remove('done'));
		void race.offsetWidth;
		race.classList.add('is-in');
		race.querySelectorAll<HTMLElement>('.time').forEach((time) => {
			const ms = Number(time.dataset.ms);
			countUp(time, lang, ms, 0, (t) => t);
			const lane = time.closest('.lane');
			setTimeout(() => lane?.classList.add('done'), ms);
		});
	};
	document.querySelectorAll<HTMLElement>('.rj-race').forEach((race) => {
		const replay = race.querySelector<HTMLButtonElement>('.replay');
		if (replay) {
			replay.hidden = false;
			replay.addEventListener('click', () => runRace(race));
		}
	});
	onReveal('.rj-race', runRace, 0.35);
}

// ---------------------------------------------------------------- chart tooltips

const bars = document.querySelectorAll<SVGGElement>('.chart .bar');
if (bars.length) {
	const tip = document.createElement('div');
	tip.className = 'rj-tooltip';
	tip.hidden = true;
	tip.setAttribute('role', 'status');
	document.body.appendChild(tip);

	const show = (bar: Element, x: number, y: number) => {
		tip.textContent = '';
		const value = document.createElement('strong');
		value.textContent = bar.getAttribute('data-value');
		const label = document.createElement('span');
		label.textContent = bar.getAttribute('data-label');
		tip.append(value, label);
		const note = bar.getAttribute('data-note');
		if (note) {
			const extra = document.createElement('span');
			extra.textContent = ` · ${note}`;
			tip.append(extra);
		}
		tip.hidden = false;
		const w = tip.offsetWidth;
		const h = tip.offsetHeight;
		tip.style.left = `${Math.min(Math.max(8, x + 14), window.innerWidth - w - 8)}px`;
		tip.style.top = `${y - h - 12 < 8 ? y + 16 : y - h - 12}px`;
	};
	bars.forEach((bar) => {
		bar.addEventListener('pointermove', (e) => show(bar, e.clientX, e.clientY));
		bar.addEventListener('pointerleave', () => (tip.hidden = true));
		bar.addEventListener('focus', () => {
			const r = bar.getBoundingClientRect();
			show(bar, r.left + r.width / 2, r.top);
		});
		bar.addEventListener('blur', () => (tip.hidden = true));
	});
}
