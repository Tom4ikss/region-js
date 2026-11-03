// Захват переменных: spawn сам находит, что нужно колбэку.
const words = ['арбуз', 'банан', 'вишня', 'груша', 'дыня', 'ежевика'];
const minLength = 4;
function score(word) {
  return word.length * 10;
}

// words и minLength копируются, score передаётся исходным текстом.
const long = spawn(() => words.filter((w) => w.length > minLength).map((w) => w + '=' + score(w))).join();
print('захваченные данные и функция:', long.join(' '));

// Объект региона переезжает в задачу и возвращается после неё.
const region = new Region();
const stats = region.run(() => ({ runs: 0 }));
spawn(() => { stats.runs += 1; }).join();
spawn(() => { stats.runs += 1; }).join();
print('регион вернулся, runs =', stats.runs);

// Аргументом объект региона едет так же: переезжает и возвращается.
spawn((s) => { s.runs += 10; }, stats).join();
print('аргументом, runs =', stats.runs);

// Замороженный регион общий: главный поток читает его, пока читает задача.
const dictRegion = new Region();
const dict = dictRegion.run(() => ({ hello: 'привет', bye: 'пока' }));
dictRegion.freeze();
const translated = spawn(() => dict.hello + ' / ' + dict.bye).join();
print('замороженный регион:', translated, '| главный поток читает:', dict.hello);
