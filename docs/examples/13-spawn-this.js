// An arrow function sees this and arguments of the outer function. spawn captures them too.
function report(prefix) {
  return spawn(() => `${prefix}${this.title}: ${this.rows.length} rows, ${arguments.length} arguments`).join();
}
print(report.call({ title: 'week', rows: [3, 1, 2] }, '>> ', 'extra'));

// But if this has methods, it cannot be sent.
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
