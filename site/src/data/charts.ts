// Bar charts of the documentation: the measured values and their texts in both languages.
//
// Numbers are shared; only the human-readable strings differ between `en` and `ru`. `text` is the
// label printed next to a bar and must be exactly what the measurement says; `value` sets the bar
// length. The chart component draws the bars from `value` and prints `text` as is.
//
// Measurement notes (carried over from the old site's build script):
//
// - move-1m, create, access-ratio, frozen-scaling, spawn-parallel: medians of five runs of
//   tests/{bench,bench-writes,bench-frozen,spawn}.js and examples/en/36-create.js on out/docs/d8
//   with --harmony-regions --max-serializer-memory=4000. The "pass over prices" in `create` and
//   `p-build` was remeasured after access was inlined into Maglev and Turbofan, on out/release/d8
//   (the same build settings); creation did not change beyond noise then. `create` and `p-build`
//   were remeasured entirely on out/release/d8 when region.object() was removed (replaced by
//   "run one by one and push").
// - move-1m, region.run with 1M nodes: 601.0 · 611.2 · 585.8 · 591.9 · 598.3 ms; with 1K nodes:
//   0.466 · 0.440 · 0.451 · 0.432 · 0.461 ms.
// - access-ratio: tests/bench.js (tree, reads) and tests/bench-writes.js after access was inlined
//   into Maglev and Turbofan, out/release/d8 (the same build settings as out/docs). Five runs, ms.
//   Tree reads: plain 6.049 · 6.543 · 6.047 · 6.318 · 6.491, region 7.290 · 7.325 · 7.296 · 7.316 ·
//   7.673. A write to every node: plain 4.638 · 4.730 · 4.728 · 4.902 · 4.798, region 8.201 · 8.143 ·
//   8.285 · 8.603 · 8.219. Array sum: plain 0.650 · 0.654 · 0.652 · 0.650 · 0.718, region 2.087 ·
//   2.101 · 2.127 · 2.174 · 2.185. Tree with --no-inline-region-access: plain 22.845 · 21.369 ·
//   21.260 · 22.100 · 21.734, region 23.807 · 23.296 · 23.033 · 23.684 · 23.613 (sum sees both
//   shapes, and plain objects went through the IC too). After the check once per loop: array sum,
//   plain 0.709 · 0.701 · 0.705 · 0.697 · 0.698, region 1.603 · 1.621 · 1.618 · 1.625 · 1.603.
// - Practices (p-*): medians of five runs of examples/en/practice-*.js on out/docs/d8; each run
//   takes the best of 3–7 repetitions. p-write, p-read, p-methods, p-shapes and p-typed were
//   remeasured after access was inlined into Maglev and Turbofan, on out/release/d8 (the same
//   build settings), flags --harmony-regions --module. p-read and p-methods were remeasured once
//   more after the fast paths for array methods (GetProperty/HasProperty, the iterator,
//   Array.from and spread, includes/indexOf).
// - p-build: the same five runs of examples/en/36-create.js as the `create` chart.

export type Series = 1 | 2;
/** Legend swatches: s1 and s2 are the bar colours, tick is the ideal mark, ref the reference line. */
export type Swatch = 's1' | 's2' | 'tick' | 'ref';

export interface ChartText {
	title: string;
	sub: string;
	axis: string;
	legend?: string[];
	caption?: string;
	rows: { label: string; sub?: string; text: string; note?: string }[];
	tableHead: string[];
	table: string[][];
}

export interface ChartSpec {
	id: string;
	/** Number of axis steps to aim for (5 by default). */
	ticks?: number;
	/** Decimals in the axis labels (0 by default). */
	tickDigits?: number;
	/** A dashed reference line at this value. */
	ref?: number;
	legend?: Swatch[];
	rows: { value: number; series?: Series; ideal?: number }[];
	en: ChartText;
	ru: ChartText;
}

export const CHARTS: Record<string, ChartSpec> = {
	"move-1m": {
		id: "ch-move",
		legend: ["s2", "s1"],
		rows: [
			{ value: 928, series: 2 },
			{ value: 598 },
			{ value: 0.12 },
		],
		en: {
			title: "Send a tree of 1M nodes to a worker",
			sub: "Time of one operation, ms. Shorter is better.",
			axis: "milliseconds",
			legend: ["plain postMessage", "regions"],
			rows: [
				{ label: "Copy", sub: "structured clone", text: "928 ms" },
				{ label: "Region creation", sub: "copy inside, once", text: "598 ms" },
				{ label: "Region move", sub: "transfer list", text: "0.12 ms", note: "the bar is too short to see" },
			],
			tableHead: ["Operation", "1K nodes", "1M nodes"],
			table: [
				["postMessage, structured clone", "0.92 ms", "928 ms"],
				["region.run (region creation)", "0.45 ms", "598 ms"],
				["postMessage, region move", "0.02 ms", "0.12 ms"],
			],
		},
		ru: {
			title: "Отправить дерево из 1 млн узлов в воркер",
			sub: "Время одной операции, мс. Короче значит лучше.",
			axis: "миллисекунды",
			legend: ["обычный postMessage", "регионы"],
			rows: [
				{ label: "Копия", sub: "structured clone", text: "928 мс" },
				{ label: "Создание региона", sub: "копия внутрь, один раз", text: "598 мс" },
				{ label: "Переезд региона", sub: "transfer list", text: "0,12 мс", note: "столбик слишком короткий, чтобы его увидеть" },
			],
			tableHead: ["Операция", "1 тыс. узлов", "1 млн узлов"],
			table: [
				["postMessage, structured clone", "0,92 мс", "928 мс"],
				["region.run (создание региона)", "0,45 мс", "598 мс"],
				["postMessage, переезд региона", "0,02 мс", "0,12 мс"],
			],
		},
	},
	"create": {
		id: "ch-create",
		legend: ["s2", "s1"],
		rows: [
			{ value: 27, series: 2 },
			{ value: 74 },
			{ value: 165 },
			{ value: 377 },
		],
		en: {
			title: "Put 200,000 products into a region",
			sub: "Objects { id, name, tags, price }. Time to create the whole array, ms. Shorter is better.",
			axis: "milliseconds",
			legend: ["without regions", "into a region"],
			rows: [
				{ label: "Plain objects", sub: "without regions", text: "27 ms" },
				{ label: "Literal #{}", sub: "one by one, push", text: "74 ms", note: "no copy and, after the first literal of a shape, no runtime" },
				{ label: "region.run", sub: "plain objects and one copy", text: "165 ms" },
				{ label: "region.run", sub: "one by one, push", text: "377 ms", note: "a copy per object" },
			],
			tableHead: ["Method", "Creation", "Pass over prices", "Creation, five runs"],
			table: [
				["Plain objects", "27 ms", "0.2 ms", "27 · 27 · 27 · 26 · 26"],
				["Literal #{} and push", "74 ms", "0.7 ms", "78 · 74 · 73 · 75 · 74"],
				["One region.run", "165 ms", "0.8 ms", "173 · 170 · 160 · 158 · 165"],
				["region.run one by one and push", "377 ms", "1.3 ms", "387 · 385 · 377 · 371 · 374"],
			],
		},
		ru: {
			title: "Положить 200 000 товаров в регион",
			sub: "Объекты { id, name, tags, price }. Время создания всего массива, мс. Короче значит лучше.",
			axis: "миллисекунды",
			legend: ["без регионов", "в регион"],
			rows: [
				{ label: "Обычные объекты", sub: "без регионов", text: "27 мс" },
				{ label: "Литерал #{}", sub: "по одному, push", text: "74 мс", note: "без копии и, после первого литерала формы, без рантайма" },
				{ label: "region.run", sub: "обычные объекты и одна копия", text: "165 мс" },
				{ label: "region.run", sub: "по одному, push", text: "377 мс", note: "копия на каждый объект" },
			],
			tableHead: ["Способ", "Создание", "Проход по ценам", "Создание, пять запусков"],
			table: [
				["Обычные объекты", "27 мс", "0,2 мс", "27 · 27 · 27 · 26 · 26"],
				["Литерал #{} и push", "74 мс", "0,7 мс", "78 · 74 · 73 · 75 · 74"],
				["Один region.run", "165 мс", "0,8 мс", "173 · 170 · 160 · 158 · 165"],
				["region.run по одному и push", "377 мс", "1,3 мс", "387 · 385 · 377 · 371 · 374"],
			],
		},
	},
	"access-ratio": {
		id: "ch-access",
		tickDigits: 0,
		ref: 1,
		legend: ["ref"],
		rows: [
			{ value: 7.3 / 6.3 },
			{ value: 8.22 / 4.73 },
			{ value: 1.61 / 0.7 },
		],
		en: {
			title: "Access to region objects compared with plain ones",
			sub: "How many times longer than with plain objects. 1 means the same, below 1 means faster. A tree and an array of 1M elements each.",
			axis: "times longer than plain JS",
			legend: ["vertical line: plain JS = 1"],
			rows: [
				{ label: "Field reads", sub: "sum over a tree", text: "×1.2", note: "plain 6.3 ms, region 7.3 ms; before inlining it was 21.7 and 23.6 ms" },
				{ label: "Field writes", sub: "to every node", text: "×1.7", note: "plain 4.73 ms, region 8.22 ms; before inlining it was ×6.0" },
				{ label: "Indexed access", sub: "array sum", text: "×2.3", note: "plain array 0.70 ms, region 1.61 ms; before the once-per-loop check it was ×3.3, before inlining ×11" },
			],
			tableHead: ["Operation", "Plain objects", "Region", "Ratio", "Before inlining"],
			table: [
				["Sum over a tree (read)", "6.3 ms", "7.3 ms", "×1.2", "×1.1"],
				["Write to every tree node", "4.73 ms", "8.22 ms", "×1.7", "×6.0"],
				["Array sum by index", "0.70 ms", "1.61 ms", "×2.3", "×11"],
			],
		},
		ru: {
			title: "Доступ к объектам региона по сравнению с обычными",
			sub: "Во сколько раз дольше, чем с обычными объектами. 1 — одинаково, меньше 1 — быстрее. Дерево и массив по 1 млн элементов.",
			axis: "во сколько раз дольше обычного JS",
			legend: ["вертикальная линия: обычный JS = 1"],
			rows: [
				{ label: "Чтение полей", sub: "сумма по дереву", text: "×1,2", note: "обычные 6,3 мс, регион 7,3 мс; до встраивания было 21,7 и 23,6 мс" },
				{ label: "Запись полей", sub: "в каждый узел", text: "×1,7", note: "обычные 4,73 мс, регион 8,22 мс; до встраивания было ×6,0" },
				{ label: "Доступ по индексу", sub: "сумма массива", text: "×2,3", note: "обычный массив 0,70 мс, регион 1,61 мс; до проверки один раз на цикл было ×3,3, до встраивания ×11" },
			],
			tableHead: ["Операция", "Обычные объекты", "Регион", "Отношение", "До встраивания"],
			table: [
				["Сумма по дереву (чтение)", "6,3 мс", "7,3 мс", "×1,2", "×1,1"],
				["Запись в каждый узел дерева", "4,73 мс", "8,22 мс", "×1,7", "×6,0"],
				["Сумма массива по индексу", "0,70 мс", "1,61 мс", "×2,3", "×11"],
			],
		},
	},
	"frozen-scaling": {
		id: "ch-scale",
		legend: ["s1", "tick"],
		rows: [
			{ value: 146.9 },
			{ value: 75.7, ideal: 146.9 / 2 },
			{ value: 38.3, ideal: 146.9 / 4 },
			{ value: 25.1, ideal: 146.9 / 8 },
		],
		en: {
			title: "Parallel reads of one frozen tree",
			sub: "8 passes over a tree of 1M nodes are split evenly between threads. Time of the whole job, ms.",
			axis: "milliseconds",
			legend: ["actual time", "ideal speedup (time / number of threads)"],
			rows: [
				{ label: "1 thread", sub: "main only", text: "146.9 ms" },
				{ label: "2 workers", text: "75.7 ms · ×1.9", note: "ideal would be 73.5 ms" },
				{ label: "4 workers", text: "38.3 ms · ×3.8", note: "ideal would be 36.7 ms" },
				{ label: "8 workers", sub: "but only 6 fast cores", text: "25.1 ms · ×5.9", note: "ideal would be 18.4 ms" },
			],
			tableHead: ["Threads", "Time", "Speedup", "Ideal"],
			table: [
				["1 thread", "146.9 ms", "×1.0", "×1"],
				["2 workers", "75.7 ms", "×1.9", "×2"],
				["4 workers", "38.3 ms", "×3.8", "×4"],
				["8 workers", "25.1 ms", "×5.9", "×8"],
			],
		},
		ru: {
			title: "Параллельное чтение одного замороженного дерева",
			sub: "8 проходов по дереву из 1 млн узлов делятся поровну между потоками. Время всей работы, мс.",
			axis: "миллисекунды",
			legend: ["фактическое время", "идеальное ускорение (время / число потоков)"],
			rows: [
				{ label: "1 поток", sub: "только главный", text: "146,9 мс" },
				{ label: "2 воркера", text: "75,7 мс · ×1,9", note: "идеально было бы 73,5 мс" },
				{ label: "4 воркера", text: "38,3 мс · ×3,8", note: "идеально было бы 36,7 мс" },
				{ label: "8 воркеров", sub: "а быстрых ядер 6", text: "25,1 мс · ×5,9", note: "идеально было бы 18,4 мс" },
			],
			tableHead: ["Потоки", "Время", "Ускорение", "Идеально"],
			table: [
				["1 поток", "146,9 мс", "×1,0", "×1"],
				["2 воркера", "75,7 мс", "×1,9", "×2"],
				["4 воркера", "38,3 мс", "×3,8", "×4"],
				["8 воркеров", "25,1 мс", "×5,9", "×8"],
			],
		},
	},
	"spawn-parallel": {
		id: "ch-spawn",
		rows: [
			{ value: 738 },
			{ value: 201 },
		],
		en: {
			title: "Four heavy tasks through spawn",
			sub: "The same compute task four times. Total time, ms.",
			axis: "milliseconds",
			rows: [
				{ label: "One after another", sub: "join right after spawn", text: "738 ms" },
				{ label: "All at once", sub: "4 × spawn, then 4 × join", text: "201 ms · ×3.7" },
			],
			tableHead: ["Method", "Time"],
			table: [
				["One after another", "738 ms"],
				["All at once", "201 ms (×3.7)"],
			],
		},
		ru: {
			title: "Четыре тяжёлые задачи через spawn",
			sub: "Одна и та же вычислительная задача четыре раза. Общее время, мс.",
			axis: "миллисекунды",
			rows: [
				{ label: "По очереди", sub: "join сразу после spawn", text: "738 мс" },
				{ label: "Все сразу", sub: "4 × spawn, потом 4 × join", text: "201 мс · ×3,7" },
			],
			tableHead: ["Способ", "Время"],
			table: [
				["По очереди", "738 мс"],
				["Все сразу", "201 мс (×3,7)"],
			],
		},
	},
	"p-frozen": {
		id: "ch-p1",
		legend: ["s2", "s1"],
		rows: [
			{ value: 1065, series: 2 },
			{ value: 0.7 },
		],
		en: {
			title: "32 tasks read a catalog of 100,000 products",
			sub: "Time of all tasks together, ms. Shorter is better.",
			axis: "milliseconds",
			legend: ["bad", "good"],
			rows: [
				{ label: "Plain array", sub: "a copy into every task", text: "1,065 ms" },
				{ label: "Frozen region", sub: "shared, no copies", text: "0.7 ms", note: "about 1,500 times faster; the bar is too short to see" },
			],
			tableHead: ["Method", "Median", "Five runs"],
			table: [
				["Capturing a plain array", "1,065 ms", "1,085 · 1,062 · 1,065 · 1,068 · 1,052"],
				["Capturing a frozen region", "0.7 ms", "0.7 · 1.1 · 0.6 · 0.7 · 0.6"],
			],
		},
		ru: {
			title: "32 задачи читают каталог из 100 000 товаров",
			sub: "Время всех задач вместе, мс. Короче значит лучше.",
			axis: "миллисекунды",
			legend: ["плохо", "хорошо"],
			rows: [
				{ label: "Обычный массив", sub: "копия в каждую задачу", text: "1 065 мс" },
				{ label: "Замороженный регион", sub: "общий, без копий", text: "0,7 мс", note: "примерно в 1 500 раз быстрее; столбик слишком короткий, чтобы его увидеть" },
			],
			tableHead: ["Способ", "Медиана", "Пять запусков"],
			table: [
				["Захват обычного массива", "1 065 мс", "1 085 · 1 062 · 1 065 · 1 068 · 1 052"],
				["Захват замороженного региона", "0,7 мс", "0,7 · 1,1 · 0,6 · 0,7 · 0,6"],
			],
		},
	},
	"p-move": {
		id: "ch-p2",
		legend: ["s2", "s1"],
		rows: [
			{ value: 3585, series: 2 },
			{ value: 8.8 },
		],
		en: {
			title: "10,000 objects to a worker and back",
			sub: "Time of one round trip, microseconds. Shorter is better.",
			axis: "microseconds",
			legend: ["bad", "good"],
			rows: [
				{ label: "New region", sub: "region.run every round trip", text: "3,585 µs" },
				{ label: "One region", sub: "move there and back", text: "8.8 µs", note: "about 400 times faster" },
			],
			tableHead: ["Method", "Median", "Five runs"],
			table: [
				["Recreate the region", "3,585 µs", "3,598 · 3,576 · 3,585 · 3,762 · 3,531"],
				["Move there and back", "8.8 µs", "9.3 · 8.8 · 8.9 · 8.6 · 8.7"],
			],
		},
		ru: {
			title: "10 000 объектов в воркер и обратно",
			sub: "Время одного круга, микросекунды. Короче значит лучше.",
			axis: "микросекунды",
			legend: ["плохо", "хорошо"],
			rows: [
				{ label: "Новый регион", sub: "region.run каждый круг", text: "3 585 мкс" },
				{ label: "Один регион", sub: "переезд туда-обратно", text: "8,8 мкс", note: "примерно в 400 раз быстрее" },
			],
			tableHead: ["Способ", "Медиана", "Пять запусков"],
			table: [
				["Пересоздавать регион", "3 585 мкс", "3 598 · 3 576 · 3 585 · 3 762 · 3 531"],
				["Переезд туда-обратно", "8,8 мкс", "9,3 · 8,8 · 8,9 · 8,6 · 8,7"],
			],
		},
	},
	"p-build": {
		id: "ch-p12",
		legend: ["s2", "s1"],
		rows: [
			{ value: 377, series: 2 },
			{ value: 165 },
			{ value: 74 },
		],
		en: {
			title: "200,000 products into a region",
			sub: "Time to create the whole array, ms. Shorter is better. A pass over the finished array is almost the same for all three, about 1 ms.",
			axis: "milliseconds",
			legend: ["a copy per object", "good"],
			rows: [
				{ label: "region.run", sub: "one by one, push", text: "377 ms" },
				{ label: "region.run", sub: "plain objects and one copy", text: "165 ms", note: "2.3 times faster than run per object" },
				{ label: "Literal #{}", sub: "one by one, push", text: "74 ms", note: "2.2 times faster than one run and 5 times faster than run per object" },
			],
			tableHead: ["Method", "Median", "Five runs"],
			table: [
				["region.run one by one and push, creation", "377 ms", "387 · 385 · 377 · 371 · 374"],
				["One region.run, creation", "165 ms", "173 · 170 · 160 · 158 · 165"],
				["Literal #{} and push, creation", "74 ms", "78 · 74 · 73 · 75 · 74"],
				["region.run one by one and push, pass", "1.3 ms", "1.2 · 1.4 · 1.3 · 1.3 · 1.2"],
				["One region.run, pass", "0.8 ms", "0.8 · 0.8 · 0.8 · 0.8 · 0.8"],
				["Literal #{} and push, pass", "0.7 ms", "0.7 · 0.7 · 0.7 · 0.7 · 0.7"],
			],
		},
		ru: {
			title: "200 000 товаров в регион",
			sub: "Время создания всего массива, мс. Короче значит лучше. Проход по готовому массиву у всех трёх почти одинаковый, около 1 мс.",
			axis: "миллисекунды",
			legend: ["копия на каждый объект", "хорошо"],
			rows: [
				{ label: "region.run", sub: "по одному, push", text: "377 мс" },
				{ label: "region.run", sub: "обычные объекты и одна копия", text: "165 мс", note: "в 2,3 раза быстрее run на каждый объект" },
				{ label: "Литерал #{}", sub: "по одному, push", text: "74 мс", note: "в 2,2 раза быстрее одного run и в 5 раз быстрее run на каждый объект" },
			],
			tableHead: ["Способ", "Медиана", "Пять запусков"],
			table: [
				["region.run по одному и push, создание", "377 мс", "387 · 385 · 377 · 371 · 374"],
				["Один region.run, создание", "165 мс", "173 · 170 · 160 · 158 · 165"],
				["Литерал #{} и push, создание", "74 мс", "78 · 74 · 73 · 75 · 74"],
				["region.run по одному и push, проход", "1,3 мс", "1,2 · 1,4 · 1,3 · 1,3 · 1,2"],
				["Один region.run, проход", "0,8 мс", "0,8 · 0,8 · 0,8 · 0,8 · 0,8"],
				["Литерал #{} и push, проход", "0,7 мс", "0,7 · 0,7 · 0,7 · 0,7 · 0,7"],
			],
		},
	},
	"p-batch": {
		id: "ch-p3",
		ref: 194,
		legend: ["s2", "s1", "ref"],
		rows: [
			{ value: 57, series: 2 },
			{ value: 52 },
			{ value: 65 },
		],
		en: {
			title: "Primes up to 2,000,000",
			sub: "Total time, ms. Shorter is better. The vertical line is the same work on the main thread without spawn.",
			axis: "milliseconds",
			legend: ["bad", "good", "without spawn: 194 ms"],
			rows: [
				{ label: "10,000 tasks", sub: "200 numbers each", text: "57 ms", note: "5 ms longer than 100 tasks: about 0.5 µs extra per task" },
				{ label: "100 tasks", sub: "20,000 numbers each", text: "52 ms", note: "3.7 times faster than the main thread" },
				{ label: "4 tasks", sub: "one per worker", text: "65 ms", note: "the parts are unequal in work, the last one takes the longest" },
			],
			tableHead: ["Method", "Median", "Five runs"],
			table: [
				["Main thread, without spawn", "194 ms", "194 · 195 · 193 · 194 · 193"],
				["10,000 small tasks", "57 ms", "56 · 58 · 57 · 56 · 57"],
				["100 medium tasks", "52 ms", "52 · 52 · 52 · 52 · 52"],
				["4 large tasks", "65 ms", "65 · 65 · 65 · 65 · 66"],
			],
		},
		ru: {
			title: "Простые числа до 2 000 000",
			sub: "Общее время, мс. Короче значит лучше. Вертикальная линия — та же работа в главном потоке без spawn.",
			axis: "миллисекунды",
			legend: ["плохо", "хорошо", "без spawn: 194 мс"],
			rows: [
				{ label: "10 000 задач", sub: "по 200 чисел", text: "57 мс", note: "на 5 мс дольше 100 задач: около 0,5 мкс лишних на задачу" },
				{ label: "100 задач", sub: "по 20 000 чисел", text: "52 мс", note: "в 3,7 раза быстрее главного потока" },
				{ label: "4 задачи", sub: "по одной на воркер", text: "65 мс", note: "части неравны по работе, последняя считается дольше всех" },
			],
			tableHead: ["Способ", "Медиана", "Пять запусков"],
			table: [
				["Главный поток, без spawn", "194 мс", "194 · 195 · 193 · 194 · 193"],
				["10 000 мелких задач", "57 мс", "56 · 58 · 57 · 56 · 57"],
				["100 средних задач", "52 мс", "52 · 52 · 52 · 52 · 52"],
				["4 крупные задачи", "65 мс", "65 · 65 · 65 · 65 · 66"],
			],
		},
	},
	"p-write": {
		id: "ch-p4a",
		tickDigits: 0,
		legend: ["s2", "s1"],
		rows: [
			{ value: 3.12, series: 2 },
			{ value: 0.75 },
		],
		en: {
			title: "A million steps, two fields on each",
			sub: "Loop time, ms. Shorter is better.",
			axis: "milliseconds",
			legend: ["bad", "good"],
			rows: [
				{ label: "Write to the region", sub: "on every step", text: "3.1 ms", note: "before access was inlined into the compilers it was 14.3 ms, before the once-per-loop check 4.6 ms" },
				{ label: "Local variables", sub: "into the region once", text: "0.75 ms", note: "4.2 times faster" },
			],
			tableHead: ["Method", "Median", "Five runs"],
			table: [
				["Write to the region on every step", "3.12 ms", "3.11 · 3.12 · 3.12 · 3.12 · 3.12"],
				["Locally, into the region once", "0.75 ms", "0.75 · 0.75 · 0.75 · 0.75 · 0.74"],
			],
		},
		ru: {
			title: "Миллион шагов, на каждом два поля",
			sub: "Время цикла, мс. Короче значит лучше.",
			axis: "миллисекунды",
			legend: ["плохо", "хорошо"],
			rows: [
				{ label: "Запись в регион", sub: "на каждом шаге", text: "3,1 мс", note: "до встраивания доступа в компиляторы было 14,3 мс, до проверки один раз на цикл — 4,6 мс" },
				{ label: "Локальные переменные", sub: "в регион один раз", text: "0,75 мс", note: "в 4,2 раза быстрее" },
			],
			tableHead: ["Способ", "Медиана", "Пять запусков"],
			table: [
				["Запись в регион на каждом шаге", "3,12 мс", "3,11 · 3,12 · 3,12 · 3,12 · 3,12"],
				["Локально, в регион один раз", "0,75 мс", "0,75 · 0,75 · 0,75 · 0,75 · 0,74"],
			],
		},
	},
	"p-read": {
		id: "ch-p4b",
		legend: ["s2", "s1"],
		rows: [
			{ value: 7.49, series: 2 },
			{ value: 3.45 },
			{ value: 3.41 },
		],
		en: {
			title: "50 passes over an array of 100,000 numbers",
			sub: "Time including copying, ms. Shorter is better.",
			axis: "milliseconds",
			legend: ["bad", "good"],
			rows: [
				{ label: "Region array", sub: "prices[i] every pass", text: "7.5 ms", note: "before access was inlined into the compilers it was 34.6 ms, before the once-per-loop check 13.1 ms" },
				{ label: "Array.from copy", sub: "then a plain array", text: "3.5 ms", note: "2.2 times faster than the region array; before the fast paths for array methods it was 17.8 ms" },
				{ label: "Loop copy", sub: "then a plain array", text: "3.4 ms", note: "2.2 times faster than the region array" },
			],
			tableHead: ["Method", "Median", "Five runs"],
			table: [
				["Region array", "7.49 ms", "7.47 · 7.49 · 7.49 · 7.50 · 7.50"],
				["Copy through Array.from", "3.45 ms", "3.45 · 3.45 · 3.45 · 3.45 · 3.45"],
				["Copy with an indexed loop", "3.41 ms", "3.41 · 3.40 · 3.41 · 3.40 · 3.41"],
			],
		},
		ru: {
			title: "50 проходов по массиву из 100 000 чисел",
			sub: "Время вместе с копированием, мс. Короче значит лучше.",
			axis: "миллисекунды",
			legend: ["плохо", "хорошо"],
			rows: [
				{ label: "Массив региона", sub: "prices[i] каждый проход", text: "7,5 мс", note: "до встраивания доступа в компиляторы было 34,6 мс, до проверки один раз на цикл — 13,1 мс" },
				{ label: "Копия Array.from", sub: "потом обычный массив", text: "3,5 мс", note: "в 2,2 раза быстрее массива региона; до быстрых путей для методов массивов было 17,8 мс" },
				{ label: "Копия циклом", sub: "потом обычный массив", text: "3,4 мс", note: "в 2,2 раза быстрее массива региона" },
			],
			tableHead: ["Способ", "Медиана", "Пять запусков"],
			table: [
				["Массив региона", "7,49 мс", "7,47 · 7,49 · 7,49 · 7,50 · 7,50"],
				["Копия через Array.from", "3,45 мс", "3,45 · 3,45 · 3,45 · 3,45 · 3,45"],
				["Копия циклом по индексу", "3,41 мс", "3,41 · 3,40 · 3,41 · 3,40 · 3,41"],
			],
		},
	},
	"p-methods": {
		id: "ch-p5",
		legend: ["s2", "s1"],
		rows: [
			{ value: 23.92, series: 2 },
			{ value: 22.1, series: 2 },
			{ value: 18.95, series: 2 },
			{ value: 2.13 },
			{ value: 3.54 },
			{ value: 1.72 },
		],
		en: {
			title: "Sum of squares of even numbers, array of 1,000,000",
			sub: "One pass, ms. Shorter is better.",
			axis: "milliseconds",
			legend: ["array methods", "for loop"],
			rows: [
				{ label: "Region", sub: "filter / map / reduce", text: "23.9 ms", note: "before the fast paths for array methods it was 216 ms" },
				{ label: "Loop copy", sub: "filter / map / reduce", text: "22.1 ms", note: "the copy gains almost nothing" },
				{ label: "Plain array", sub: "filter / map / reduce", text: "19.0 ms", note: "the region is 1.3 times slower" },
				{ label: "Region", sub: "for loop", text: "2.1 ms", note: "11 times faster than methods on the region; before the once-per-loop check it was 3.3 ms" },
				{ label: "Loop copy", sub: "for loop", text: "3.5 ms", note: "the copy costs more than it gains on one pass" },
				{ label: "Plain array", sub: "for loop", text: "1.7 ms", note: "11 times faster than methods on a plain array" },
			],
			tableHead: ["Method", "Median", "Five runs"],
			table: [
				["Region, filter/map/reduce", "23.92 ms", "23.91 · 23.92 · 23.90 · 23.98 · 24.00"],
				["Loop copy, filter/map/reduce", "22.10 ms", "22.10 · 21.89 · 21.88 · 22.20 · 22.26"],
				["Plain array, filter/map/reduce", "18.95 ms", "18.95 · 18.80 · 19.00 · 19.63 · 18.79"],
				["Region, for loop", "2.13 ms", "2.13 · 2.14 · 2.14 · 2.13 · 2.13"],
				["Loop copy, for loop", "3.54 ms", "3.55 · 3.54 · 3.53 · 3.55 · 3.54"],
				["Plain array, for loop", "1.72 ms", "1.72 · 1.72 · 1.72 · 1.72 · 1.72"],
			],
		},
		ru: {
			title: "Сумма квадратов чётных чисел, массив из 1 000 000",
			sub: "Один проход, мс. Короче значит лучше.",
			axis: "миллисекунды",
			legend: ["методы массива", "цикл for"],
			rows: [
				{ label: "Регион", sub: "filter / map / reduce", text: "23,9 мс", note: "до быстрых путей для методов массивов было 216 мс" },
				{ label: "Копия циклом", sub: "filter / map / reduce", text: "22,1 мс", note: "копия почти ничего не выигрывает" },
				{ label: "Обычный массив", sub: "filter / map / reduce", text: "19,0 мс", note: "регион медленнее в 1,3 раза" },
				{ label: "Регион", sub: "цикл for", text: "2,1 мс", note: "в 11 раз быстрее методов на регионе; до проверки один раз на цикл было 3,3 мс" },
				{ label: "Копия циклом", sub: "цикл for", text: "3,5 мс", note: "копия стоит дороже, чем выигрывает на одном проходе" },
				{ label: "Обычный массив", sub: "цикл for", text: "1,7 мс", note: "в 11 раз быстрее методов на обычном массиве" },
			],
			tableHead: ["Способ", "Медиана", "Пять запусков"],
			table: [
				["Регион, filter/map/reduce", "23,92 мс", "23,91 · 23,92 · 23,90 · 23,98 · 24,00"],
				["Копия циклом, filter/map/reduce", "22,10 мс", "22,10 · 21,89 · 21,88 · 22,20 · 22,26"],
				["Обычный массив, filter/map/reduce", "18,95 мс", "18,95 · 18,80 · 19,00 · 19,63 · 18,79"],
				["Регион, цикл for", "2,13 мс", "2,13 · 2,14 · 2,14 · 2,13 · 2,13"],
				["Копия циклом, цикл for", "3,54 мс", "3,55 · 3,54 · 3,53 · 3,55 · 3,54"],
				["Обычный массив, цикл for", "1,72 мс", "1,72 · 1,72 · 1,72 · 1,72 · 1,72"],
			],
		},
	},
	"p-shapes": {
		id: "ch-p6",
		ticks: 6,
		legend: ["s1", "s2"],
		rows: [
			{ value: 4.5 },
			{ value: 5.6, series: 2 },
			{ value: 10.9, series: 2 },
		],
		en: {
			title: "Sum of field x over 100,000 region objects, 20 passes",
			sub: "Time, ms. Shorter is better. Shapes are different orders of the same four keys.",
			axis: "milliseconds",
			legend: ["one shape", "mixed shapes"],
			rows: [
				{ label: "One shape", sub: "x, y, z, w everywhere", text: "4.5 ms", note: "before access was inlined into the compilers it was 20.2 ms" },
				{ label: "4 shapes", sub: "polymorphic IC", text: "5.6 ms", note: "24% slower than one shape" },
				{ label: "24 shapes", sub: "megamorphic IC", text: "10.9 ms", note: "2.4 times slower than one shape; for plain objects it is 5.2 times slower here" },
			],
			tableHead: ["Shapes", "Region objects", "Plain objects", "Region, five runs"],
			table: [
				["1", "4.5 ms", "1.5 ms", "4.5 · 4.5 · 4.5 · 4.5 · 4.6"],
				["4", "5.6 ms", "1.7 ms", "5.6 · 5.6 · 5.6 · 5.6 · 5.6"],
				["24", "10.9 ms", "7.8 ms", "10.8 · 10.9 · 10.9 · 10.9 · 11.0"],
			],
		},
		ru: {
			title: "Сумма поля x по 100 000 объектам региона, 20 проходов",
			sub: "Время, мс. Короче значит лучше. Формы — разные порядки одних и тех же четырёх ключей.",
			axis: "миллисекунды",
			legend: ["одна форма", "формы вперемешку"],
			rows: [
				{ label: "Одна форма", sub: "x, y, z, w везде", text: "4,5 мс", note: "до встраивания доступа в компиляторы было 20,2 мс" },
				{ label: "4 формы", sub: "полиморфный IC", text: "5,6 мс", note: "на 24% медленнее одной формы" },
				{ label: "24 формы", sub: "мегаморфный IC", text: "10,9 мс", note: "в 2,4 раза медленнее одной формы; у обычных объектов здесь в 5,2 раза медленнее" },
			],
			tableHead: ["Форм", "Объекты региона", "Обычные объекты", "Регион, пять запусков"],
			table: [
				["1", "4,5 мс", "1,5 мс", "4,5 · 4,5 · 4,5 · 4,5 · 4,6"],
				["4", "5,6 мс", "1,7 мс", "5,6 · 5,6 · 5,6 · 5,6 · 5,6"],
				["24", "10,9 мс", "7,8 мс", "10,8 · 10,9 · 10,9 · 10,9 · 11,0"],
			],
		},
	},
	"p-await": {
		id: "ch-p7",
		legend: ["s2", "s1"],
		rows: [
			{ value: 192.5, series: 2 },
			{ value: 0.3 },
		],
		en: {
			title: "The longest main thread pause while a task computes for ~0.2 s",
			sub: "How long the main thread could not respond to any event, ms. Shorter is better.",
			axis: "milliseconds",
			legend: ["bad", "good"],
			rows: [
				{ label: "join()", sub: "the thread is blocked", text: "192.5 ms", note: "the main thread responded once, after the task" },
				{ label: "await", sub: "the thread is free", text: "0.3 ms", note: "the main thread responded about 257 thousand times" },
			],
			tableHead: ["Method", "Task", "Main thread responses", "Longest pause"],
			table: [
				["join()", "192 ms", "1", "192.5 ms"],
				["await", "192 ms", "≈257,000", "0.3 ms"],
			],
		},
		ru: {
			title: "Самая длинная пауза главного потока, пока задача считается ~0,2 с",
			sub: "Сколько главный поток не мог ответить ни на одно событие, мс. Короче значит лучше.",
			axis: "миллисекунды",
			legend: ["плохо", "хорошо"],
			rows: [
				{ label: "join()", sub: "поток стоит", text: "192,5 мс", note: "главный поток ответил 1 раз, уже после задачи" },
				{ label: "await", sub: "поток свободен", text: "0,3 мс", note: "главный поток ответил около 257 тысяч раз" },
			],
			tableHead: ["Способ", "Задача", "Ответов главного потока", "Самая длинная пауза"],
			table: [
				["join()", "192 мс", "1", "192,5 мс"],
				["await", "192 мс", "≈257 000", "0,3 мс"],
			],
		},
	},
	"p-typed": {
		id: "ch-p9",
		tickDigits: 1,
		legend: ["s2", "s1"],
		rows: [
			{ value: 1.44, series: 2 },
			{ value: 0.68 },
			{ value: 0.68 },
		],
		en: {
			title: "Sum of 1,000,000 numbers",
			sub: "One pass with a for loop, ms. Shorter is better.",
			axis: "milliseconds",
			legend: ["bad", "good"],
			rows: [
				{ label: "Array of numbers", sub: "in a region", text: "1.4 ms", note: "before access was inlined into the compilers it was 6.9 ms, before the once-per-loop check 2.4 ms" },
				{ label: "Float64Array", sub: "in a region", text: "0.68 ms", note: "2.1 times faster than the region array" },
				{ label: "Float64Array", sub: "plain, without regions", text: "0.68 ms", note: "the same as in a region" },
			],
			tableHead: ["Method", "Median", "Five runs"],
			table: [
				["Sum, array of numbers in a region", "1.44 ms", "1.41 · 1.50 · 1.44 · 1.50 · 1.41"],
				["Sum, Float64Array in a region", "0.68 ms", "0.69 · 0.68 · 0.68 · 0.69 · 0.68"],
				["Sum, plain Float64Array", "0.68 ms", "0.68 · 0.68 · 0.68 · 0.68 · 0.68"],
				["Write, array of numbers in a region", "1.96 ms", "1.96 · 1.96 · 1.96 · 1.96 · 1.96"],
				["Write, Float64Array in a region", "1.68 ms", "0.85 · 1.68 · 1.69 · 1.68 · 0.85"],
				["Write, plain Float64Array", "1.67 ms", "0.84 · 1.67 · 1.67 · 1.67 · 0.84"],
			],
		},
		ru: {
			title: "Сумма 1 000 000 чисел",
			sub: "Один проход циклом for, мс. Короче значит лучше.",
			axis: "миллисекунды",
			legend: ["плохо", "хорошо"],
			rows: [
				{ label: "Массив чисел", sub: "в регионе", text: "1,4 мс", note: "до встраивания доступа в компиляторы было 6,9 мс, до проверки один раз на цикл — 2,4 мс" },
				{ label: "Float64Array", sub: "в регионе", text: "0,68 мс", note: "в 2,1 раза быстрее массива региона" },
				{ label: "Float64Array", sub: "обычный, без регионов", text: "0,68 мс", note: "столько же, сколько в регионе" },
			],
			tableHead: ["Способ", "Медиана", "Пять запусков"],
			table: [
				["Сумма, массив чисел в регионе", "1,44 мс", "1,41 · 1,50 · 1,44 · 1,50 · 1,41"],
				["Сумма, Float64Array в регионе", "0,68 мс", "0,69 · 0,68 · 0,68 · 0,69 · 0,68"],
				["Сумма, обычный Float64Array", "0,68 мс", "0,68 · 0,68 · 0,68 · 0,68 · 0,68"],
				["Запись, массив чисел в регионе", "1,96 мс", "1,96 · 1,96 · 1,96 · 1,96 · 1,96"],
				["Запись, Float64Array в регионе", "1,68 мс", "0,85 · 1,68 · 1,69 · 1,68 · 0,85"],
				["Запись, обычный Float64Array", "1,67 мс", "0,84 · 1,67 · 1,67 · 1,67 · 0,84"],
			],
		},
	},
};
