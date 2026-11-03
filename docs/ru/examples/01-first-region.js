// Первый регион: создать, прочитать, изменить.
const region = new Region();

const user = region.run(() => ({
  name: 'Аня',
  tags: ['admin', 'beta'],
  settings: { theme: 'dark' },
}));

print('имя:', user.name);
print('тема:', user.settings.theme);
print('тегов:', user.tags.length);

user.name = 'Анна';            // владелец может писать
user.settings.theme = 'light';
print('после записи:', user.name, user.settings.theme);

print('id региона:', region.id, '| владелец (isolate):', region.owner);
