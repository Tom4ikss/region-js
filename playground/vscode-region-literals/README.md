# Region literals for VS Code

Colors the `#` of `#{ ... }` and `#[ ... ]` (d8 `--harmony-region-literals`)
as an operator instead of an error, and adds a TypeScript server plugin
(`node_modules/region-literals-ts-plugin`) that lets TypeScript read them as
`{ ... }` and `[ ... ]`. The plugin replaces the `#` with a space before
TypeScript parses the file, so positions do not move: errors, hovers and
completions work as for plain literals, and a literal gets the type of the
plain one. An empty `#[]` is `never[]`, as an empty `[]` is; cast it with
`/** @type {T[]} */ (#[])`. Biome and ESLint still cannot parse the literals.

Install locally:

```sh
ln -s "$PWD" ~/.vscode/extensions/region-js.region-literals-0.0.1
```

then run "Developer: Reload Window".
