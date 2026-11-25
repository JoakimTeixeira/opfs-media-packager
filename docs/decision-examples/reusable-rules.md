# Reusable rules

**Scenario:** A page needs a safe number of parallel segment requests. Browser state and the calculation have separate responsibilities.

Incorrect illustrative example. The rule reads the page and changes it in the same function, so testing the calculation requires a page.

```ts
function readConcurrency() {
  const field = document.querySelector<HTMLInputElement>("#parallel")!;
  field.value = String(Math.min(10, Number(field.value)));
  return Number(field.value);
}
```

Better illustrative example. The page reads its input and calls the shared rule. The actual rule also handles non-finite values and applies the default.

```ts
import { clampConcurrency } from "./lib/downloads/segments.ts";

const requested = Number(parallelField.value);
const allowed = clampConcurrency(requested);
```

For example, `clampConcurrency(15)` returns `10`. The shared rule can be tested without creating a browser page.
