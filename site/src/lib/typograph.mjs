// Russian typography: a non-breaking space after one- and two-letter words and numbers, and
// before dashes, as in printed books. The same rules the old site applied to Russian pages.

const SHORT_WORD = /(?<![\p{L}\p{N}_-])([А-Яа-яЁё]{1,2}|[0-9]+) (?=\S)/gu;
const DASH = / (—|–) /g;

export function typograph(text) {
	return text.replace(SHORT_WORD, '$1\u00a0').replace(DASH, '\u00a0$1 ');
}
