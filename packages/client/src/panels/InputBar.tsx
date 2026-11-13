import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { CommandOption } from "@crawler/engine";
import s from "./chrome.module.css";

interface Props {
  commands: CommandOption[];
  onSubmit: (text: string) => void;
  /** Client-side commands (inventory overlay etc). Return true if handled. */
  onLocal: (text: string) => boolean;
  extraButtons?: CommandOption[];
}

export function InputBar({ commands, onSubmit, onLocal, extraButtons = [] }: Props) {
  const [text, setText] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  const run = (cmd: string) => {
    const t = cmd.trim();
    if (!t) return;
    setHistory((h) => [t, ...h.filter((x) => x !== t)].slice(0, 50));
    setCursor(-1);
    if (!onLocal(t)) onSubmit(t);
    input.current?.focus();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(text);
    setText("");
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" && history.length) {
      e.preventDefault();
      const next = Math.min(history.length - 1, cursor + 1);
      setCursor(next);
      setText(history[next] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = cursor - 1;
      setCursor(Math.max(-1, next));
      setText(next >= 0 ? (history[next] ?? "") : "");
    }
  };

  return (
    <footer className={s.input} style={{ gridArea: "input" }}>
      <form onSubmit={submit} className={s.form}>
        <span className={s.prompt}>&gt;</span>
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          className={s.field}
          placeholder="type a command, or click one"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label="Command"
        />
      </form>
      <div className={s.buttons}>
        {[...commands, ...extraButtons].map((c) => (
          <button key={c.label} className={`${s.btn} ${c.primary ? s.primary : ""}`} onClick={() => run(c.input)}>
            {c.label}
          </button>
        ))}
      </div>
    </footer>
  );
}
