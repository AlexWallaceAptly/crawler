import { useCallback, useMemo, useRef, useState } from "react";
import type { Engine, World } from "@crawler/engine";
import { loadWorld, saveWorld, wipeSave } from "./storage";

export function useGame(engine: Engine) {
  const [world, setWorld] = useState<World>(() => loadWorld(engine));
  // The engine call happens outside the state updater so StrictMode's double-invoke can't roll dice twice.
  const current = useRef(world);

  const submit = useCallback(
    (text: string) => {
      const r = engine.input(current.current, text);
      if (r.world === current.current) return;
      current.current = r.world;
      saveWorld(r.world);
      setWorld(r.world);
    },
    [engine],
  );

  const resetEverything = useCallback(() => {
    wipeSave();
    const fresh = engine.newWorld().world;
    current.current = fresh;
    saveWorld(fresh);
    setWorld(fresh);
  }, [engine]);

  const view = useMemo(() => engine.view(world), [engine, world]);
  const commands = useMemo(() => engine.commands(world), [engine, world]);

  return { world, view, commands, submit, resetEverything };
}
