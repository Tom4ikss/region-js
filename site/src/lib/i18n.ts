// Interface strings of the site's own components, per language. Starlight's own strings
// (search, theme, pagination...) come from its built-in translations.
import { langOf } from './site.mjs';

export const UI = {
	en: {
		real: (flags: string) => `real d8${flags} output`,
		timing: '; your timings will differ',
		varies: '; numbers change from run to run',
		exit: (code: number) => `; exit code ${code}`,
		copy: 'Copy',
		copied: 'Copied',
		output: 'Output',
		collapsed: 'Benchmark code and the output of one run',
		bad: 'Bad',
		good: 'Good',
		table: 'Show as a table',
		badge: 'experiment · V8 fork',
		meta: 'runs in d8 and Node',
		github: 'Code on GitHub',
		switchTo: 'Русская версия',
		switchLabel: 'RU',
		docs: 'Docs',
		benchmarks: 'Benchmarks',
		sideNote: 'A research prototype. Every example on this site ran in a built d8; the output is real.',
		footer:
			'Ownership regions in V8 is a research prototype, not a product. The numbers come from a build with checks enabled (dcheck) on Apple Silicon unless the page says otherwise.',
		replay: 'Replay',
	},
	ru: {
		real: (flags: string) => `настоящий вывод d8${flags}`,
		timing: '; время у вас будет другим',
		varies: '; числа меняются от запуска к запуску',
		exit: (code: number) => `; код выхода ${code}`,
		copy: 'Копировать',
		copied: 'Скопировано',
		output: 'Вывод',
		collapsed: 'Код замера и вывод одного запуска',
		bad: 'Плохо',
		good: 'Хорошо',
		table: 'Показать таблицей',
		badge: 'эксперимент · форк V8',
		meta: 'работает в d8 и Node',
		github: 'Код на GitHub',
		switchTo: 'English version',
		switchLabel: 'EN',
		docs: 'Документация',
		benchmarks: 'Замеры',
		sideNote: 'Исследовательский прототип. Все примеры на сайте запущены в собранном d8, вывод настоящий.',
		footer:
			'Регионы владения в V8 — исследовательский прототип, не продукт. Цифры получены на сборке с включёнными проверками (dcheck), Apple Silicon, если на странице не сказано иное.',
		replay: 'Ещё раз',
	},
} as const;

export type Lang = keyof typeof UI;

export function ui(url: URL) {
	const lang = langOf(url.pathname) as Lang;
	return { lang, t: UI[lang] };
}
