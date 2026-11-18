const built = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  root: "./src",
  target: "browser",
  format: "esm",
  packages: "external",
});

if (!built.success) {
  for (const log of built.logs) console.error(log);
  process.exit(1);
}

const css = await Bun.file("src/styles.css").text();
if (/^html, body/m.test(css)) {
  throw new Error("Library CSS still styles the host page.");
}
await Bun.write("dist/styles.css", css);

const types = await Bun.$`bunx tsc -p tsconfig.build.json`.nothrow();
if (types.exitCode !== 0) process.exit(types.exitCode ?? 1);

const declarations = new Bun.Glob("**/*.d.ts");
for await (const file of declarations.scan({ cwd: "dist" })) {
  const path = `dist/${file}`;
  const source = await Bun.file(path).text();
  // TypeScript 7 keeps `.ts` specifiers. Node resolves a `.js` specifier to the `.d.ts` beside it.
  const rewritten = source.replaceAll(/(from\s+["'])(\.{1,2}\/[^"']+?)\.ts(["'])/g, "$1$2.js$3");
  if (rewritten !== source) await Bun.write(path, rewritten);
}

const js = await Bun.file("dist/index.js").text();
const entryTypes = await Bun.file("dist/index.d.ts").text();
if (!entryTypes.includes('from "./workspace/workspace.js"')) {
  throw new Error("dist/index.d.ts does not point at the workspace declaration.");
}
if (!js.includes('from "react"') && !js.includes('import("react")')) {
  throw new Error("React should stay an external import.");
}
if (js.includes("compiler-sfc") || js.includes("Bun.build") || js.includes("Bun.file")) {
  throw new Error("The demo compiler was bundled into the package.");
}

const smoke = await Bun.$`bun -e 'import { TapeWorkspace } from "./dist/index.js"; if (typeof TapeWorkspace !== "function") process.exit(1)'`.nothrow();
if (smoke.exitCode !== 0) {
  throw new Error("dist/index.js does not export TapeWorkspace.");
}

const smokeDir = ".tape-cache/package-smoke";
await Bun.write(
  `${smokeDir}/consumer.ts`,
  `import { TapeWorkspace, type PaneDefinition } from "../../dist/index.js";

const pane: PaneDefinition = {
  paneId: "notes",
  title: "Notes",
  surfaceKind: "html",
  source: { kind: "html", html: "<p>Hello</p>" },
};

export function mount(root: HTMLElement): TapeWorkspace {
  return new TapeWorkspace(root, { storageKey: null, panes: [pane] });
}
`,
);
await Bun.write(
  `${smokeDir}/tsconfig.json`,
  JSON.stringify({
    compilerOptions: {
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      noEmit: true,
      lib: ["ESNext", "DOM"],
      skipLibCheck: true,
      verbatimModuleSyntax: true,
    },
    files: ["consumer.ts"],
  }),
);
const checked = await Bun.$`bunx tsc -p ${smokeDir}/tsconfig.json`.nothrow();
await Bun.file(`${smokeDir}/consumer.ts`).delete();
await Bun.file(`${smokeDir}/tsconfig.json`).delete();
if (checked.exitCode !== 0) process.exit(checked.exitCode ?? 1);
