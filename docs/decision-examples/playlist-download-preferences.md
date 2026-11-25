# Playlist download preferences

**Scenario:** A person selects MKV and retries a playlist. The retry should keep the selected format.

Incorrect illustrative example. A hard-coded format on retry discards the user's selection.

```ts
const retryFormat = "mp4";
await resumePlaylist({ format: retryFormat });
```

Better illustrative example. The saved playlist plan supplies the chosen value and the shared preference rule handles invalid values.

```ts
import { outputFormatOrDefault } from "./lib/download-preferences.ts";

const retryFormat = outputFormatOrDefault(savedPlan.outputFormat);
await resumePlaylist({ format: retryFormat });
```

The snippets illustrate the ownership of the preference and omit the other playlist-plan fields. The active plan is stored in Chrome session storage. The extension also saves some general preferences locally. Session storage is not a permanent backup across every browser restart.
