// d8-flags: --module
// Задача заморозила регион: право разморозить возвращается вместе с результатом.
const index = await spawn(() => {
  const region = new Region();
  const built = region.run(() => ({ words: ['арбуз', 'банан', 'вишня'], built: true }));
  region.freeze(); // готовый справочник: только для чтения
  return built;
});
const region = Region.of(index);
print('frozen:', region.frozen, '| frozenHere:', region.frozenHere);

// Замороженный результат можно сразу отдать другим задачам без копии.
const lengths = await Promise.all([0, 1, 2].map((i) => spawn(() => index.words[i].length)));
print('длины из трёх задач:', lengths.join(', '));

region.thaw(); // право у главного потока
index.built = false;
print('после thaw главный поток пишет:', index.built);
