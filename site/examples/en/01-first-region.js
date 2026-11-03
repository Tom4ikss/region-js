// First region: create, read, change.
const region = new Region();

const user = region.run(() => ({
  name: 'Anya',
  tags: ['admin', 'beta'],
  settings: { theme: 'dark' },
}));

print('name:', user.name);
print('theme:', user.settings.theme);
print('tags:', user.tags.length);

user.name = 'Anna';            // the owner can write
user.settings.theme = 'light';
print('after the write:', user.name, user.settings.theme);

print('region id:', region.id, '| owner (isolate):', region.owner);
