// The three order scenarios against plain workers and tokio, from the "Versus tokio" table on the
// landing page and the Numbers page (tests/bench-real.js and tests/tokio-bench, best of five
// runs, V8 without internal checks). The landing page draws them as a race: every lane fills at
// the same speed, so a lane takes as long to finish as its measured time, scaled.

export interface RaceLane {
	key: 'regions' | 'workers' | 'tokio';
	/** Measured time, ms. */
	ms: number;
	/** The label exactly as in the table. */
	text: { en: string; ru: string };
}

export interface RaceScenario {
	title: { en: string; ru: string };
	lanes: RaceLane[];
}

/** Column headers of the table; HTML because two of them contain code. */
export const RACE_LANES = {
	regions: { en: '<code>spawn</code> + regions', ru: '<code>spawn</code> + регионы' },
	workers: { en: 'workers + <code>postMessage</code>', ru: 'воркеры + <code>postMessage</code>' },
	tokio: { en: 'tokio', ru: 'tokio' },
} as const;

export const RACE: RaceScenario[] = [
	{
		title: {
			en: 'Build 200,000 orders on four threads and read them on the main thread',
			ru: 'Собрать 200 000 заказов в четырёх потоках и прочитать в главном',
		},
		lanes: [
			{ key: 'regions', ms: 38, text: { en: '38 ms', ru: '38 мс' } },
			{ key: 'workers', ms: 220, text: { en: '220 ms', ru: '220 мс' } },
			{ key: 'tokio', ms: 16.5, text: { en: '16.5 ms', ru: '16,5 мс' } },
		],
	},
	{
		title: {
			en: '200 batches of 1000 orders: hand them to threads, compute a discount, return',
			ru: '200 пачек по 1000 заказов: отдать потокам, посчитать скидку, вернуть',
		},
		lanes: [
			{ key: 'regions', ms: 13, text: { en: '13 ms', ru: '13 мс' } },
			{ key: 'workers', ms: 309, text: { en: '309 ms', ru: '309 мс' } },
			{ key: 'tokio', ms: 0.7, text: { en: '0.7 ms', ru: '0,7 мс' } },
		],
	},
	{
		title: {
			en: 'A catalog of 100,000 products: share it with four threads, a million reads on each',
			ru: 'Каталог из 100 000 товаров: раздать четырём потокам, по миллиону чтений в каждом',
		},
		lanes: [
			{ key: 'regions', ms: 17, text: { en: '17 ms', ru: '17 мс' } },
			{ key: 'workers', ms: 59, text: { en: '59 ms', ru: '59 мс' } },
			{ key: 'tokio', ms: 1.6, text: { en: '1.6 ms', ru: '1,6 мс' } },
		],
	},
];
