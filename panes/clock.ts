class TapeClock extends HTMLElement {
  static tag = "tape-clock";

  #root: ShadowRoot;
  #time: HTMLElement;
  #date: HTMLElement;
  #hand: SVGLineElement;
  #timer = 0;
  #live = true;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
    this.#root.innerHTML = `
      <style>
        :host { display: flex; height: 100%; min-height: 0; color: #f4efe4; background:
          radial-gradient(120% 80% at 10% 0%, rgba(255, 196, 120, 0.16), transparent 46%),
          #1a211c; }
        .face { margin: auto; display: grid; justify-items: center; gap: 10px; }
        svg { width: min(46vw, 180px); height: auto; }
        time { font-variant-numeric: tabular-nums; font-size: 52px; letter-spacing: -0.04em; font-family: "Iowan Old Style", Palatino, Georgia, serif; }
        p { margin: 0; color: #c9c2b2; letter-spacing: 0.14em; text-transform: uppercase; font-size: 12px; }
        .state { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #8f887a; }
      </style>
      <div class="face">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(244,239,228,0.18)" stroke-width="2"></circle>
          <line x1="50" y1="50" x2="50" y2="14" stroke="#f0b56a" stroke-width="2" stroke-linecap="round"></line>
        </svg>
        <time>00:00:00</time>
        <p></p>
        <span class="state">live</span>
      </div>
    `;
    this.#time = this.#root.querySelector("time")!;
    this.#date = this.#root.querySelector("p")!;
    this.#hand = this.#root.querySelector("line")!;
    this.addEventListener("tape-pane-state", (event) => {
      const detail = (event as CustomEvent<{ runtimeState?: string }>).detail;
      this.#live = detail?.runtimeState === "live";
      const state = this.#root.querySelector(".state");
      if (state) state.textContent = this.#live ? "live" : (detail?.runtimeState ?? "hidden");
      this.#sync();
    });
  }

  connectedCallback(): void {
    this.#sync();
    this.#timer = window.setInterval(() => this.#sync(), 200);
  }

  disconnectedCallback(): void {
    window.clearInterval(this.#timer);
  }

  #sync(): void {
    if (!this.#live) return;
    const now = new Date();
    this.#time.textContent = now.toLocaleTimeString([], { hour12: false });
    this.#date.textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    const angle = (now.getSeconds() / 60) * Math.PI * 2 - Math.PI / 2;
    this.#hand.setAttribute("x2", String(50 + Math.cos(angle) * 34));
    this.#hand.setAttribute("y2", String(50 + Math.sin(angle) * 34));
  }
}

export default TapeClock;
export const tag = "tape-clock";

if (!customElements.get(tag)) customElements.define(tag, TapeClock);
