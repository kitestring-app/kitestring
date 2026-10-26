import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";

it.each([false, true])("marks desktop=%s before React can paint", desktop => {
  const root = { dataset: {} as Record<string, string> };
  const render = vi.fn(() => expect(root.dataset.desktop).toBe(String(desktop)));
  const pending = new Promise(() => {});
  const modules: Record<string, unknown> = {
    "react-dom/client": { createRoot: () => ({ render }) },
    "react/jsx-runtime": { jsx: vi.fn(), jsxs: vi.fn() },
    "./state/settings": { settings: { ready: pending }, localPreferencesReady: pending, calmFoundationReady: pending },
    "./state/timer": { startTicker: vi.fn() },
    "./ui/floatingDesktop": { connectFloatingSettings: vi.fn() },
  };
  const source = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(compiled, {
    exports: {}, require: (name: string) => modules[name] ?? {}, URLSearchParams,
    window: { desktop: desktop ? { mini: true } : undefined }, location: { search: "?mini=1" },
    document: { documentElement: root, getElementById: () => ({}) },
  });
  expect(render).toHaveBeenCalledOnce();
});
