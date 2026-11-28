# Track scan pacing

**Scenario:** A media host responds with HTTP 429, meaning it is asking the extension to slow its requests. The following sequence shows the page-request retry path. A second consecutive rate-limit response stops the scan and keeps items already found.

```mermaid
sequenceDiagram
  actor Person as Person using Chrome
  participant Scanner as Track scanner
  participant Host as Media host
  Person->>Scanner: Start scanning the playlist
  Scanner->>Host: Request item information
  Host-->>Scanner: Return HTTP 429 and optional Retry-After
  Note over Scanner: Wait within the configured delay bounds
  Scanner->>Host: Retry the request once
  Host-->>Scanner: Return HTTP 429 again
  Scanner-->>Person: Report that the scan stopped
```

The dashed return arrows show responses. The scanner spaces requests by at least 550 milliseconds and bounds the host-provided retry delay to 1.5 through 15 seconds. Other scan outcomes and fallback methods are shown in the [track scan flow](../track-scan.md).
