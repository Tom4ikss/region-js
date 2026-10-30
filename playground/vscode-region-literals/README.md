# Region literals for VS Code

Colors the `#` of `#{ ... }` and `#[ ... ]` (d8 `--harmony-region-literals`)
as an operator instead of an error. Highlighting only: TypeScript, Biome and
ESLint still cannot parse these literals.

Install locally:

```sh
ln -s "$PWD" ~/.vscode/extensions/region-js.region-literals-0.0.1
```

then run "Developer: Reload Window".
