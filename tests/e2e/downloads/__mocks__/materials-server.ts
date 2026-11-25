import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { type AddressInfo } from "node:net";
import {
  E2E_EXCALIDRAW_HTML,
  DIRECT_MP4_E2E_BYTES,
  buildDoubleEncodedPortugueseVtt,
  SAMPLE_PDF_BYTES,
  TINY_PNG_BYTES,
  E2E_SLIDES_HTML,
} from "../__fixtures__/download-data.ts";

export function handleMaterialsE2eRequest(
  req: IncomingMessage,
  res: ServerResponse,
  port: number,
  segmentBuffer: Buffer,
  recordHit: (key: string) => void,
): void {
  const origin = req.headers.origin;

  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();

    return;
  }

  const host = req.headers.host || "";

  const pathname = new URL(req.url || "/", `http://${host || "127.0.0.1"}`)
    .pathname;

  if (host.startsWith("e2e.excalidraw.com")) {
    if (pathname === "/s/test-room/scene-1") recordHit("diagram");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(E2E_EXCALIDRAW_HTML);

    return;
  }

  if (pathname === "/redirect-pdf") {
    recordHit("redirect-pdf");

    res.writeHead(302, {
      Location: `http://materials.example.test:${port}/files/apostila.pdf`,
    });

    res.end();

    return;
  }

  if (pathname === "/redirect-img") {
    recordHit("redirect-img");

    res.writeHead(302, {
      Location: `http://materials.example.test:${port}/files/diagrama.png`,
    });

    res.end();

    return;
  }

  const staticRoutes = new Map<
    string,
    {
      readonly contentType: string;
      readonly body: string | Buffer;
      readonly hitKey?: string;
    }
  >([
    [
      "/video/playlist.m3u8",
      {
        contentType: "application/vnd.apple.mpegurl",
        body: "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXTINF:0.1,\nseg0.ts\n#EXT-X-ENDLIST\n",
      },
    ],
    [
      "/video/seg0.ts",
      { contentType: "video/mp2t", body: segmentBuffer, hitKey: "seg0" },
    ],
    [
      "/video/live-event.mp4",
      {
        contentType: "video/mp4",
        body: DIRECT_MP4_E2E_BYTES,
        hitKey: "direct-mp4",
      },
    ],
    [
      "/video/mojibake.vtt",
      // Server omits `; charset=utf-8` AND serves double-encoded UTF-8 bytes.
      {
        contentType: "text/vtt",
        body: buildDoubleEncodedPortugueseVtt(),
        hitKey: "vtt",
      },
    ],
    [
      "/files/apostila.pdf",
      {
        contentType: "application/pdf",
        body: SAMPLE_PDF_BYTES,
        hitKey: "pdf",
      },
    ],
    [
      "/files/diagrama.png",
      { contentType: "image/png", body: TINY_PNG_BYTES, hitKey: "image" },
    ],
    [
      "/slides",
      {
        contentType: "text/html; charset=utf-8",
        body: E2E_SLIDES_HTML,
        hitKey: "slides",
      },
    ],
  ]);

  const matched = staticRoutes.get(pathname);

  if (matched) {
    if (matched.hitKey) recordHit(matched.hitKey);
    res.writeHead(200, { "Content-Type": matched.contentType });
    res.end(matched.body);

    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
}

export async function startMaterialsE2eServer(segmentBuffer: Buffer): Promise<{
  readonly port: number;
  readonly hitCount: (key: string) => number;
  readonly close: () => Promise<void>;
}> {
  const portRef = { value: 0 };
  const hits = new Map<string, number>();

  const recordHit = (key: string): void => {
    hits.set(key, (hits.get(key) ?? 0) + 1);
  };

  const server: Server = createServer((req, res) => {
    handleMaterialsE2eRequest(
      req,
      res,
      portRef.value,
      segmentBuffer,
      recordHit,
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);

    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const address = server.address() as AddressInfo;

  portRef.value = address.port;

  return {
    port: address.port,
    hitCount: (key: string) => hits.get(key) ?? 0,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });

        server.closeAllConnections();
      }),
  };
}
