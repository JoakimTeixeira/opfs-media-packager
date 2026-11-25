import {
  Check,
  Copy,
  Download,
  FileOutput,
  Folder,
  Pencil,
  RotateCw,
  Search,
  SlidersHorizontal,
  X,
  Zap,
  createElement,
} from "lucide";

const icons = Object.freeze({
  check: Check,
  copy: Copy,
  download: Download,
  folder: Folder,
  format: FileOutput,
  parallel: Zap,
  quality: SlidersHorizontal,
  refresh: RotateCw,
  rename: Pencil,
  scan: Search,
  close: X,
});

export type IconName = keyof typeof icons;

/**
 * Creates one locally bundled, tree-shaken Lucide icon. The library handles
 * SVG geometry; callers only choose the semantic icon name and CSS class.
 */
export function icon(
  name: IconName,
  classNames: readonly string[] = [],
): SVGElement {
  return createElement(icons[name], {
    "aria-hidden": "true",
    class: ["lucide-icon", ...classNames].join(" "),
    "stroke-width": 2,
  });
}
