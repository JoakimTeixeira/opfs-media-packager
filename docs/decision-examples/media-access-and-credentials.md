# Media access and credentials

**Scenario:** An untrusted page supplies a video URL. The extension must validate the URL before privileged network access. Some hosts also require the signed-in page's request context.

```mermaid
%%{init: {"flowchart": {"curve": "linear"}}}%%
flowchart TD
  Page["Page supplies media information"] --> Validate["Validate message sender and media URL"]
  Validate --> Allowed{"Media request allowed?"}
  Allowed -->|"Yes"| Scoped["Apply a temporary rule scoped to the selected media when needed"]
  Allowed -->|"No"| Reject["Reject the media request"]
  Scoped --> Request["Request the media using the permitted browser context"]
```

The extension does not export the browser's session credentials. A host can still reject a request or an access token can expire. The [security controls](../../SECURITY.md) describe the checks and their limits.
