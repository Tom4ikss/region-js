// Стрелочная функция видит this и arguments внешней функции. spawn их тоже захватывает.
function report(prefix) {
  return spawn(() => `${prefix}${this.title}: ${this.rows.length} строки, аргументов ${arguments.length}`).join();
}
print(report.call({ title: 'неделя', rows: [3, 1, 2] }, '>> ', 'лишний'));

// А если в this есть методы, отправить его нельзя.
const store = {
  items: [1, 2, 3],
  count() {
    return spawn(() => this.items.length).join();
  },
};
try {
  store.count();
} catch (e) {
  print(e.name + ':', e.message);
}
