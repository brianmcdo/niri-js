/** A module pane: exports `mount(host, context)` for the host tests. */
export function mount(host: HTMLElement, context: { title: string; focused: boolean }) {
  const node = document.createElement("p");
  node.className = "module-pane";
  node.textContent = `${context.title}:${context.focused}`;
  host.replaceChildren(node);
  return {
    update(next: { title: string; focused: boolean }) {
      node.textContent = `${next.title}:${next.focused}`;
    },
    destroy() {
      host.replaceChildren();
    },
  };
}
