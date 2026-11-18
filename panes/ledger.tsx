import { useState } from "react";

interface LedgerProps {
  focused?: boolean;
  runtimeState?: string;
  title?: string;
}

const accounts = [
  { name: "Studio", tint: "#f0b56a" },
  { name: "Travel", tint: "#8eb8a2" },
  { name: "Tools", tint: "#d7c4f2" },
];

export default function Ledger({ focused = false, runtimeState = "live", title = "Ledger" }: LedgerProps) {
  const [amounts, setAmounts] = useState([1280, 640, 240]);
  const total = amounts.reduce((sum, amount) => sum + amount, 0);

  return (
    <section className="ledger">
      <header>
        <div>
          <p>{title}</p>
          <strong>${total.toLocaleString()}</strong>
        </div>
        <span data-live={runtimeState === "live"}>
          {focused ? "Focused" : "Idle"} · {runtimeState}
        </span>
      </header>
      <ul>
        {accounts.map((account, index) => (
          <li key={account.name}>
            <i style={{ background: account.tint }} />
            <span>{account.name}</span>
            <b>${(amounts[index] ?? 0).toLocaleString()}</b>
            <button type="button" onClick={() => nudge(index, -20)} aria-label={`Decrease ${account.name}`}>
              −
            </button>
            <button type="button" onClick={() => nudge(index, 20)} aria-label={`Increase ${account.name}`}>
              +
            </button>
          </li>
        ))}
      </ul>
      <style>{css}</style>
    </section>
  );

  function nudge(index: number, delta: number) {
    setAmounts((current) => current.map((amount, item) => (item === index ? Math.max(0, amount + delta) : amount)));
  }
}

const css = `
.ledger { height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 18px; padding: 22px; box-sizing: border-box; color: #f6f1ea; background: linear-gradient(180deg, #241c18, #1a1614 40%); font-family: "Avenir Next", "Segoe UI", sans-serif; }
.ledger header { display: flex; justify-content: space-between; align-items: end; gap: 12px; }
.ledger p { margin: 0 0 4px; letter-spacing: 0.16em; text-transform: uppercase; font-size: 11px; color: #b7aa9e; }
.ledger strong { font-family: "Iowan Old Style", Palatino, Georgia, serif; font-size: 42px; font-weight: 500; letter-spacing: -0.04em; }
.ledger header span { font-size: 12px; color: #d7cfc4; border: 1px solid rgba(255,244,230,0.14); border-radius: 999px; padding: 6px 10px; }
.ledger header span[data-live="true"] { color: #f0b56a; }
.ledger ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.ledger li { display: grid; grid-template-columns: 14px 1fr auto auto auto; gap: 10px; align-items: center; background: rgba(255,244,230,0.04); border-radius: 14px; padding: 12px; }
.ledger i { width: 14px; height: 14px; border-radius: 50%; display: block; }
.ledger b { font-variant-numeric: tabular-nums; }
.ledger button { width: 32px; height: 32px; border-radius: 10px; border: 0; background: #f6f1ea; color: #241c18; font-size: 18px; cursor: pointer; }
.ledger button:hover { background: #f0b56a; }
`;
