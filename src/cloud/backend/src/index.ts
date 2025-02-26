import { ExportedHandler, Request as CFRequest, Response as CFResponse } from "@cloudflare/workers-types";
import { routePartykitRequest, Server } from "partyserver";

import type { Connection } from "partyserver";

import type { Env } from "../worker-configuration.js";

import { AwsClient } from "aws4fetch";
import { BuildURI, URI } from "@adviser/cement";

export class Fireproof extends Server<Env> {
  clockHead = new Map<string, CRDTEntry>();

  async onStart() {
    // eslint-disable-next-line no-console
    console.log("starting");
    return this.ctx.storage.get("main").then((head) => {
      if (head) {
        // eslint-disable-next-line no-console
        console.log("loaded existing clock head", head);
        this.clockHead = head as Map<string, CRDTEntry>;
      }
    });
  }

  async onRequest(request: Request): Promise<Response> {
    // eslint-disable-next-line no-console
    console.log("request!", request.method, request.url);
    // Check if it's a preflight request (OPTIONS) and handle it
    if (request.method === "OPTIONS") {
      return ok() as unknown as Response;
    }

    const url = URI.from(request.url);
    // eslint-disable-next-line no-console
    console.log("url", url.toString());
    const carId = url.getParam("car");
    if (carId) {
      // eslint-disable-next-line no-console
      console.log("carid", request.method, carId, request.url);
      if (request.method === "PUT") {
        // const carArrayBuffer = await request.arrayBuffer();
        // if (carArrayBuffer) {
        //   await this.ctx.storage.put(`car-${carId}`, carArrayBuffer);
        //   return json({ ok: true }, 201);
        // }
        const res = await prepareSignedUpload(request, this.env as Env);

        return res;
      } else if (request.method === "GET") {
        // const carArrayBuffer = (await this.ctx.storage.get(`car-${carId}`)) as Uint8Array;
        // if (carArrayBuffer) {
        //   return new Response(carArrayBuffer, { status: 200, headers: CORS });
        // }
        return json({ ok: false, error: "Bad route" }, 404);
      } else if (request.method === "DELETE") {
        const deleted = await this.ctx.storage.delete(`car-${carId}`);
        if (deleted) {
          return json({ ok: true }, 200);
        }
        return json({ ok: false, error: "CAR not found" }, 404);
      } else {
        return json({ error: "Method not allowed" }, 405);
      }
    } else {
      // eslint-disable-next-line no-console
      console.log("meta", request.method, request.url);
      if (request.method === "GET") {
        const metaValues = Array.from(this.clockHead.values());
        // eslint-disable-next-line no-console
        console.log("meta GOT", metaValues);
        return json(metaValues, 200);
      } else if (request.method === "DELETE") {
        await this.ctx.storage.deleteAll();
        this.clockHead.clear();
        await this.ctx.storage.put("main", this.clockHead);
        return json({ ok: true }, 200);
      } else if (request.method === "PUT") {
        const requestBody = await request.text();
        // eslint-disable-next-line no-console
        console.log("meta PUT", requestBody);
        this.onMessage({ id: "server" } as Connection, requestBody);
        return json({ ok: true }, 200);
      }
      return json({ error: "Invalid URL path" }, 400);
    }
  }

  async onConnect(conn: Connection) {
    // eslint-disable-next-line no-console
    console.log("connected", this.ctx.id, conn.id, [...this.clockHead.values()].length);
    for (const value of this.clockHead.values()) {
      conn.send(JSON.stringify(value));
    }
  }

  onMessage(sender: Connection, message: string) {
    // eslint-disable-next-line no-console
    console.log("got", message);
    const entries = JSON.parse(message) as CRDTEntry[];
    const { cid, parents } = entries[0];
    this.clockHead.set(cid, entries[0]);
    for (const p of parents) {
      this.clockHead.delete(p);
    }

    this.broadcast(message, [sender.id]);
    void this.ctx.storage.put("main", this.clockHead);
  }
}

async function prepareSignedUpload(request: Request, env: Env): Promise<Response> {
  const R2 = new AwsClient({
    accessKeyId: env.ACCESS_KEY_ID,
    secretAccessKey: env.SECRET_ACCESS_KEY,
  });

  // Parse URL
  const origUrl = URI.from(request.url);
  const carId = origUrl.getParam("car");

  const dbName = origUrl.pathname.split("/").pop();

  // eslint-disable-next-line no-console
  console.log("origUrl.url", request.url.toString());

  const expiresInSeconds = 60 * 60 * 24; // 1 day

  const storageUrl = URI.from(env.STORAGE_URL);
  const endpoint = BuildURI.from(storageUrl).pathname(storageUrl.pathname + `/${dbName}/${carId}`)
  // `https://${env.BUCKET_NAME}.${env.ACCOUNT_ID}.r2.cloudflarestorage.com/${dbName}/${carId}`;

  const url = BuildURI.from(endpoint);
  url.setParam("X-Amz-Expires", expiresInSeconds.toString());

  const signedUrl = await R2.sign(
    new Request(url.asURL(), {
      method: "PUT",
    }),
    {
      aws: { signQuery: true },
    }
  );
  // eslint-disable-next-line no-console
  console.log("signedUrl", signedUrl.url);
  return json({
    ok: true,
    status: "upload",
    // allocated: size,
    // link,
    url: signedUrl.url,
  });
}

// async function handlePresignedUpload(request: Request, env: Env): Promise<Response | null> {
//   const url = new URL(request.url);
//   const presign = url.pathname.match(/^\/presignUpload\/([^(\/|$)]+)\/?$/);
//   if (presign && presign[1]) {
//     console.log("trying to handle presigned")
//     const res = await prepareSignedUpload(request, env)
//     return res
//   }
//   return null
// }

export default {
  async fetch(request: CFRequest, env: Env): Promise<CFResponse> {
    const url = URI.from(request.url);
    if (url.pathname === "/health") {
      return json({ ok: true }) as unknown as CFResponse;
    }
    return (
      // (await handlePresignedUpload(request, env)) ||
      ((await routePartykitRequest(
        request as unknown as Request,
        env as unknown as Record<string, string>
      )) as unknown as CFResponse) || json({ ok: false, error: "Not Found" }, 404)
    );
  },
} satisfies ExportedHandler<Env>;

interface CRDTEntry {
  readonly data: string;
  readonly cid: string;
  readonly parents: string[];
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, PUT,  DELETE",
  "Access-Control-Max-Age": "86400", // Cache pre-flight response for 24 hours
};

const json = <T>(data: T, status = 200) => Response.json(data, { status, headers: CORS });

const ok = () => json({ ok: true });
