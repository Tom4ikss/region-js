// Capturing variables: spawn finds what the callback needs on its own.
const words = ['apple', 'banana', 'cherry', 'durian', 'elderberry', 'fig'];
const minLength = 4;
function score(word) {
  return word.length * 10;
}

// words and minLength are copied, score is sent as source text.
const long = spawn(() => words.filter((w) => w.length > minLength).map((w) => w + '=' + score(w))).join();
print('captured data and function:', long.join(' '));

// A region object moves into the task and comes back after it.
const region = new Region();
const stats = region.run(() => ({ runs: 0 }));
spawn(() => { stats.runs += 1; }).join();
spawn(() => { stats.runs += 1; }).join();
print('the region came back, runs =', stats.runs);

// As an argument, a region object travels the same way: it moves and comes back.
spawn((s) => { s.runs += 10; }, stats).join();
print('as an argument, runs =', stats.runs);

// A frozen region is shared: the main thread reads it while the task reads it.
const dictRegion = new Region();
const dict = dictRegion.run(() => ({ hello: 'hola', bye: 'adiós' }));
dictRegion.freeze();
const translated = spawn(() => dict.hello + ' / ' + dict.bye).join();
print('frozen region:', translated, '| the main thread reads:', dict.hello);
