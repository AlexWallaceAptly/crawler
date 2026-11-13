import { useState, type ReactNode } from "react";
import { readPref, writePref } from "../storage";
import s from "./panels.module.css";

interface Props {
  id: string;
  title: string;
  /** Named grid region; lets a later art layer wrap panels without touching their insides. */
  region?: string;
  collapsible?: boolean;
  extra?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Panel({ id, title, region, collapsible = true, extra, className, children }: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(() => readPref(`collapsed.${id}`, false));
  const toggle = () => {
    setCollapsed((c) => {
      writePref(`collapsed.${id}`, !c);
      return !c;
    });
  };
  return (
    <section
      className={`${s.panel} ${collapsed ? s.collapsed : ""} ${className ?? ""}`}
      style={region ? { gridArea: region } : undefined}
      data-panel={id}
      aria-label={title}
    >
      <header className={s.head}>
        {collapsible ? (
          <button className={s.toggle} onClick={toggle} aria-expanded={!collapsed}>
            {collapsed ? "+" : "−"} {title}
          </button>
        ) : (
          <span className={s.title}>{title}</span>
        )}
        {extra}
      </header>
      {!collapsed && <div className={s.body}>{children}</div>}
    </section>
  );
}
