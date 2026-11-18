<script>
  let { title = "Notes", focused = false, runtimeState = "live" } = $props();
  let items = $state([
    { text: "Keep the camera on the focused column", done: true },
    { text: "Load a Vue file into a new pane", done: false },
    { text: "Leave a blank split for later", done: false },
  ]);
  let draft = $state("");

  function add() {
    const text = draft.trim();
    if (!text) return;
    items = [...items, { text, done: false }];
    draft = "";
  }
</script>

<section class="notes">
  <header>
    <p>{title}</p>
    <span>{focused ? "Focused" : "Idle"} · {runtimeState}</span>
  </header>
  <ul>
    {#each items as item, index (item.text)}
      <li>
        <label>
          <input type="checkbox" bind:checked={items[index].done} />
          <span class:done={item.done}>{item.text}</span>
        </label>
      </li>
    {/each}
  </ul>
  <form onsubmit={(event) => { event.preventDefault(); add(); }}>
    <input bind:value={draft} placeholder="Add a note" aria-label="Add a note" />
    <button type="submit">Add</button>
  </form>
</section>

<style>
  .notes {
    height: 100%;
    min-height: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 22px;
    color: #f3f6ef;
    background: #14211b;
    font-family: "Avenir Next", "Segoe UI", sans-serif;
  }
  header { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
  p { margin: 0; letter-spacing: 0.16em; text-transform: uppercase; font-size: 11px; color: #b7c4b8; }
  span { font-size: 12px; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; overflow: auto; }
  li { background: rgba(243, 246, 239, 0.05); border-radius: 12px; }
  label { display: flex; gap: 10px; align-items: center; padding: 12px; }
  .done { text-decoration: line-through; color: #8ea194; }
  form { display: flex; gap: 8px; margin-top: auto; }
  form input {
    flex: 1;
    border-radius: 12px;
    border: 1px solid rgba(243, 246, 239, 0.16);
    background: transparent;
    color: inherit;
    padding: 10px 12px;
  }
  button { border: 0; border-radius: 12px; background: #d6f0c2; color: #14211b; padding: 0 14px; cursor: pointer; }
</style>
