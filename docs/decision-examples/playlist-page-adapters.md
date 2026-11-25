# Playlist page adapters

**Scenario:** Two sites use the same item route on different hosts. The page-reader selection should work for both sites.

Incorrect illustrative example. A hard-coded host rejects an equivalent playlist on another domain.

```ts
const supported = new URL(pageUrl).hostname === "media.example";
```

Better example. Run the following TypeScript from the project root with the documented Node.js version. Both fictional URLs select the same playlist reader.

```ts
import { playlistAdapterId } from "./lib/playlist-adapters.ts";

playlistAdapterId("https://media.example/c/topic/sections/1/lessons/2");
// "sidebar-playlist"
playlistAdapterId("https://learning.example/c/topic/sections/1/lessons/2");
// "sidebar-playlist"
playlistAdapterId("https://media.example/about");
// null
```

A matching route selects a reader. The page still needs compatible playlist content.
