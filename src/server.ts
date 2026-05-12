// Stub for test designer's red phase. The real implementation must
// replace everything below the marker. Tests in tests/server-auth.test.ts
// and tests/server.test.ts exercise contracts defined in
// docs/specs/web-ui.md §4.4 / §6 / §7.
//
// This stub returns a trivially-wrong server (every request → 200) so tests
// compile and produce real assertion-mismatch failures (not "cannot find
// module" fake-red failures). The implementer of Slice B should delete
// everything below the marker line.

export interface StartServerOptions {
  port?: number;
  token: string;
  cwd: string;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

// ---- IMPLEMENTATION GOES BELOW ----

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export async function startServer(
  opts: StartServerOptions,
): Promise<RunningServer> {
  const server = createServer((_req, res) => {
    // Stub: always 200, no auth, no routing — tests should fail with
    // status mismatches and missing-header expectations.
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end("{}");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 4747, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo | null;
  const port = address?.port ?? opts.port ?? 4747;

  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
