/**
 * The languages Shiki's full bundle highlights, and the other names it accepts
 * for them. Code blocks check a fence's language against this list, so Shiki
 * itself can load with the first highlighted block instead of with every
 * window. `codeLanguages.test.ts` fails when a Shiki update changes its list.
 */
const LANGUAGE_IDS = `
abap actionscript-3 ada angular-html angular-ts apache apex apl applescript
ara asciidoc asm astro awk ballerina bat beancount berry bibtex bicep bird2
blade bsl c c3 cadence cairo clarity clojure cmake cobol codeowners codeql
coffee common-lisp coq cpp crystal csharp css csv cue cypher d dart dax
desktop diff docker dotenv dream-maker edge elixir elm emacs-lisp erb erlang
fennel fish fluent fortran-fixed-form fortran-free-form fsharp gdresource
gdscript gdshader genie gherkin git-commit git-rebase gleam glimmer-js
glimmer-ts glsl gn gnuplot go graphql groovy hack haml handlebars haskell
haxe hcl hjson hlsl html html-derivative http hurl hxml hy imba ini java
javascript jinja jison json json5 jsonc jsonl jsonnet jssm jsx julia just
kdl kotlin kusto latex lean less liquid llvm log logo lua luau make markdown
marko matlab mdc mdx mermaid mipsasm mojo moonbit move narrat nextflow
nextflow-groovy nginx nim nix nushell objective-c objective-cpp ocaml odin
openscad pascal perl php pkl plsql po polar postcss powerquery powershell
prisma prolog proto pug puppet purescript python qml qmldir qss r racket
raku razor reg regexp rel riscv ron rosmsg rst ruby rust sas sass scala
scheme scss sdbl shaderlab shellscript shellsession smalltalk solidity soy
sparql splunk sql ssh-config stata stylus surrealql svelte swift
system-verilog systemd talonscript tasl tcl templ terraform tex toml ts-tags
tsv tsx turtle twig typescript typespec typst v vala vb verilog vhdl viml
vue vue-html vue-vine vyper wasm wenyan wgsl wikitext wit wolfram xml xsl
yaml zenscript zig
`;

const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  adoc: "asciidoc",
  batch: "bat",
  be: "berry",
  bird: "bird2",
  "1c": "bsl",
  cdc: "cadence",
  clj: "clojure",
  ql: "codeql",
  coffeescript: "coffee",
  lisp: "common-lisp",
  "c++": "cpp",
  "c#": "csharp",
  cs: "csharp",
  cql: "cypher",
  dockerfile: "docker",
  elisp: "emacs-lisp",
  erl: "erlang",
  ftl: "fluent",
  f: "fortran-fixed-form",
  for: "fortran-fixed-form",
  f77: "fortran-fixed-form",
  f90: "fortran-free-form",
  f95: "fortran-free-form",
  f03: "fortran-free-form",
  f08: "fortran-free-form",
  f18: "fortran-free-form",
  "f#": "fsharp",
  fs: "fsharp",
  tscn: "gdresource",
  tres: "gdresource",
  gd: "gdscript",
  gjs: "glimmer-js",
  gts: "glimmer-ts",
  gql: "graphql",
  hbs: "handlebars",
  hs: "haskell",
  properties: "ini",
  js: "javascript",
  cjs: "javascript",
  mjs: "javascript",
  fsl: "jssm",
  jl: "julia",
  kt: "kotlin",
  kts: "kotlin",
  kql: "kusto",
  lean4: "lean",
  makefile: "make",
  md: "markdown",
  mmd: "mermaid",
  mips: "mipsasm",
  mbt: "moonbit",
  mbti: "moonbit",
  nar: "narrat",
  nf: "nextflow",
  nu: "nushell",
  objc: "objective-c",
  scad: "openscad",
  pot: "po",
  potx: "po",
  ps: "powershell",
  ps1: "powershell",
  protobuf: "proto",
  jade: "pug",
  py: "python",
  perl6: "raku",
  regex: "regexp",
  rb: "ruby",
  rs: "rust",
  "1c-query": "sdbl",
  shader: "shaderlab",
  bash: "shellscript",
  sh: "shellscript",
  shell: "shellscript",
  zsh: "shellscript",
  console: "shellsession",
  "closure-templates": "soy",
  spl: "splunk",
  styl: "stylus",
  surql: "surrealql",
  talon: "talonscript",
  tf: "terraform",
  tfvars: "terraform",
  lit: "ts-tags",
  ts: "typescript",
  cts: "typescript",
  mts: "typescript",
  tsp: "typespec",
  typ: "typst",
  cmd: "vb",
  vim: "viml",
  vimscript: "viml",
  vy: "vyper",
  文言: "wenyan",
  mediawiki: "wikitext",
  wiki: "wikitext",
  wl: "wolfram",
  yml: "yaml",
};

const ids = new Set(LANGUAGE_IDS.trim().split(/\s+/));

/** Every language id and alias, as Shiki's `bundledLanguages` keys them. */
export const CODE_LANGUAGES: readonly string[] = [
  ...ids,
  ...Object.keys(LANGUAGE_ALIASES),
];

/** The Shiki language id for a fence's language, or the name as written. */
export function normalizeCodeLanguage(language: string): string {
  const lower = language.trim().toLowerCase();
  return Object.hasOwn(LANGUAGE_ALIASES, lower)
    ? LANGUAGE_ALIASES[lower]
    : lower;
}

/** Whether Shiki can highlight a fence written in this language. */
export function isCodeLanguage(language: string): boolean {
  return ids.has(normalizeCodeLanguage(language));
}
