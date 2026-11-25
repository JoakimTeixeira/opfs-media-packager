import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi } from "vitest";

export function loadPage(filename: string): void {
  const html = readFileSync(resolve(process.cwd(), "src", filename), "utf8");

  const markup = html
    .replace(/<link\b[^>]*>/g, "")
    .replace(/<script\b[^>]*><\/script>/g, "");

  const parsed = new DOMParser().parseFromString(markup, "text/html");

  document.body.innerHTML = parsed.body.innerHTML;

  vi.stubGlobal("Option", function option(label: string, value: string) {
    const element = document.createElement("option");

    element.textContent = label;
    element.value = value;

    return element;
  });
}
