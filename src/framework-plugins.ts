import { compile } from "svelte/compiler";
import { compileScript, compileStyle, compileTemplate, parse } from "@vue/compiler-sfc";
import type { BunPlugin } from "bun";

/** Turns `.vue` and `.svelte` files into browser JavaScript during a pane build. */
export const frameworkPlugins: BunPlugin[] = [
  {
    name: "tape-vue",
    setup(build) {
      build.onLoad({ filter: /\.vue$/ }, async (args) => {
        if (args.path.includes(`${sep}node_modules${sep}`)) return;
        const source = await Bun.file(args.path).text();
        return { contents: compileVue(source, args.path), loader: "js" };
      });
    },
  },
  {
    name: "tape-svelte",
    setup(build) {
      build.onLoad({ filter: /\.svelte$/ }, async (args) => {
        if (args.path.includes(`${sep}node_modules${sep}`)) return;
        const source = await Bun.file(args.path).text();
        const result = compile(source, {
          filename: args.path,
          generate: "client",
          css: "injected",
        });
        const warnings = result.warnings.map((warning) => warning.message).join("\n");
        if (warnings) console.warn(warnings);
        return { contents: result.js.code, loader: "js" };
      });
    },
  },
];

const sep = process.platform === "win32" ? "\\" : "/";

function compileVue(source: string, filename: string): string {
  const parsed = parse(source, { filename });
  if (parsed.errors.length > 0) throw parsed.errors[0];
  const id = `data-v-${Bun.hash(filename).toString(16)}`;
  const scoped = parsed.descriptor.styles.some((style) => style.scoped);
  let script: string;
  if (parsed.descriptor.script || parsed.descriptor.scriptSetup) {
    script = compileScript(parsed.descriptor, {
      id,
      inlineTemplate: Boolean(parsed.descriptor.template),
      templateOptions: { scoped, id, filename },
    }).content;
  } else if (parsed.descriptor.template) {
    const template = compileTemplate({
      source: parsed.descriptor.template.content,
      filename,
      id,
      scoped,
    });
    if (template.errors.length > 0) throw template.errors[0];
    script = `${template.code}\nexport default { render };\n`;
  } else {
    script = "export default {};\n";
  }

  let css = "";
  for (const style of parsed.descriptor.styles) {
    const compiled = compileStyle({
      source: style.content,
      filename,
      id,
      scoped: style.scoped ?? false,
    });
    if (compiled.errors.length > 0) throw compiled.errors[0];
    css += `${compiled.code}\n`;
  }

  return `${script}
const __tapeStyleId = ${JSON.stringify(`tape-vue:${filename}`)};
if (typeof document !== "undefined" && ${JSON.stringify(css)}) {
  let style = document.querySelector(\`style[data-tape-style="\${__tapeStyleId}"]\`);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("data-tape-style", __tapeStyleId);
    document.head.appendChild(style);
  }
  style.textContent = ${JSON.stringify(css)};
}
`;
}
