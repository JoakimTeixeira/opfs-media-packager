# Playlist queue outcomes

**Scenario:** A person cancels while an item is downloading. The item should remain available for a later retry.

Incorrect illustrative example. The catch block marks the item complete for every interruption, including cancellation.

```ts
try {
  await downloadItem(item);
} catch {
  markCompleted(item);
}
```

Better illustrative example. The coordinator distinguishes cancellation from completion. Failure classification is omitted here and remains necessary in the real queue.

```ts
const attempt = await runItem(item);
if (attempt.status === "cancelled") return "stop";
if (attempt.status === "completed") markCompleted(item);
```

The actual queue also pauses after two consecutive access denials. A failed individual item can be recorded while the queue proceeds to the next item.
