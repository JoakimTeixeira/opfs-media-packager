# Download and resume

An HLS manifest lists segments, which are small pieces of the video. The Downloader page fetches the selected quality, stores temporary pieces on disk, and asks FFmpeg to package them into the selected file format.

**Download: completed output and interrupted work**

```mermaid
%%{init: {"flowchart": {"curve": "linear"}}}%%
flowchart TD
  Start["Start a video download"] --> Resume["Read a saved checkpoint if one exists"]
  Resume --> Fetch["Fetch missing video parts with retries"]
  Fetch --> Outcome{"Parts available?"}
  Outcome -->|"Yes"| Package["FFmpeg packages video and audio"]
  Outcome -->|"Stopped or failed"| Preserve["Keep verified parts when a checkpoint can be saved"]
  Package -->|"Packaging succeeded"| Save["Ask Chrome Downloads to save the output"]
  Package -->|"Packaging failed"| PackagingFailure["Keep verified parts when a checkpoint can be saved"]
  Save --> Result{"Chrome download result"}
  Result -->|"Completed"| Cleanup["Remove temporary workspace"]
  Result -->|"Interrupted or cancelled"| Report["Report that the file was not saved"]
```

**Save sequence: request acceptance and completed output**

This sequence shows the current save path. Chrome can report that a file has already completed when the extension checks its status. Otherwise, Chrome sends a later status event. Dashed event arrows are the visual convention used in this documentation. Unified Modeling Language (UML) normally uses a solid open arrow for an asynchronous signal.

```mermaid
sequenceDiagram
  actor Person as Person using Chrome
  participant Extension as Extension downloader
  participant Downloads as Chrome Downloads
  Person->>Extension: Start the video download
  Extension->>Downloads: Request the output file save
  Downloads-->>Extension: Return the download identifier
  Extension->>Downloads: Check the download status
  Downloads-->>Extension: Return the current status
  alt Chrome reports completion or interruption
    Extension-->>Person: Show the save result
  else Download still in progress
    Note over Downloads: Chrome continues saving the file
    Downloads-->>Extension: Event: download completed or interrupted
    Extension-->>Person: Show the save result
  end
```

For a playlist, the extension also checks Chrome's download history and can skip a file that still exists. If private storage is unavailable, the memory-backed fallback does not provide the same disk checkpoint. The diagram omits individual segment retries and subtitle handling.

OPFS is Chrome's private disk area for the extension. It reduces the need to hold downloaded parts in browser memory when available. If OPFS cannot be opened, the download uses a memory-backed fallback. A checkpoint records which parts have completed. The downloader attempts to save a checkpoint after each complete part and when a download stops, so it can reuse verified parts later.

Chrome's downloads history may report a deleted file as existing until an asynchronous filesystem check finishes. Chrome limits how frequently it checks. See [maintenance and troubleshooting](maintenance.md) before diagnosing a skipped file. The bundled browser test waits for Chrome to update its record before checking a retry.

FFmpeg performs a remux. A remux copies the existing video and audio into MP4 or MKV without changing their quality. An MP4 download can save a matching WebVTT subtitle file. An MKV download can store the selected subtitle inside the video file.

Related docs: [Architecture](architecture.md), [Maintenance and troubleshooting](maintenance.md), and [Testing and quality](testing-and-quality.md).
