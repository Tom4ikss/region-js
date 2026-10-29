// d8 --harmony-regions offload.js

// The method to run off the main thread. It has to be plain code: the worker
// gets its source text, not the function object, so it cannot use closures.
function buildIndex(words) {
  const index = {};
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const key = word[0];
    if (!index[key]) index[key] = [];
    index[key].push(word);
  }
  return { count: words.length, letters: Object.keys(index).length, index };
}

function runInWorker(fn, input) {
  const worker = new Worker(
    `
    const fn = ${fn.toString()};
    onmessage = ({ data }) => {
      const result = new Region();
      const value = result.run(() => fn(data.input));
      postMessage({ value }, [result]);
    };
    `,
    { type: 'string' },
  );
  const inputRegion = new Region();
  const shared = inputRegion.run(() => input);
  worker.postMessage({ input: shared }, [inputRegion]);
  const { value } = worker.getMessage();
  worker.terminate();
  return value;
}

const words = [];
for (let i = 0; i < 200000; i++) words.push(String.fromCharCode(97 + (i % 26)) + i);

const start = performance.now();
const result = runInWorker(buildIndex, words);
print(`done in ${(performance.now() - start).toFixed(1)} ms`);
print('count:', result.count, 'letters:', result.letters);
print('first words for "c":', result.index.c[0], result.index.c[1]);
