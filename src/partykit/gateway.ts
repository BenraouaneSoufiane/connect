import PartySocket, { PartySocketOptions } from "partysocket";
import { Result, URI, BuildURI, Level, KeyedResolvOnce, runtimeFn, exception2Result } from "@adviser/cement";
import { bs, ensureLogger, exceptionWrapper, getStore, Logger, rt, SuperThis } from "@fireproof/core";
// @ts-ignore - calling a private method
URI.protocolHasHostpart("partykit:");
export class PartyKitGateway implements bs.Gateway {
  readonly logger: Logger;
  readonly sthis: SuperThis;
  readonly id: string;
  party?: PartySocket;
  url?: URI;
  messagePromise: Promise<Uint8Array>;
  messageResolve?: (value: Uint8Array | PromiseLike<Uint8Array>) => void;

  constructor(sthis: SuperThis) {
    this.sthis = sthis;
    this.id = sthis.nextId().str.toString();
    this.logger = ensureLogger(sthis, "PartyKitGateway", {
      url: () => this.url?.toString(),
      this: this.id,
    }).EnableLevel(Level.DEBUG);
    this.logger.Debug().Msg("constructor");
    this.messagePromise = new Promise<Uint8Array>((resolve) => {
      this.messageResolve = resolve;
    });
  }

  async buildUrl(baseUrl: URI, key: string): Promise<Result<URI>> {
    return Result.Ok(baseUrl.build().setParam("key", key).URI());
  }

  pso?: PartySocketOptions;
  async start(uri: URI): Promise<Result<URI>> {
    this.logger.Debug().Msg("Starting PartyKitGateway with URI: " + uri.toString());

    await this.sthis.start();

    this.url = uri;
    const ret = uri.build().defParam("version", "v0.1-partykit").URI();

    let dbName = uri.getParam("name");
    if (!dbName) {
      this.logger.Error().Msg("Database name (name) parameter is missing in the URI");
      return Result.Err(this.logger.Error().Msg("name not found").AsError());
    }
    if (this.url.hasParam("index")) {
      dbName = dbName + "-idx";
    }
    const party = uri.getParam("party") || "fireproof";
    const proto = uri.getParam("protocol") || "wss";
    let possibleUndef = {};
    if (proto) {
      possibleUndef = { protocol: proto };
    }

    const protocolsStr = uri.getParam("protocols");
    if (protocolsStr) {
      const ps = protocolsStr
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x);
      if (ps.length > 0) {
        possibleUndef = { ...possibleUndef, protocols: ps };
      }
    }
    const prefixStr = uri.getParam("prefix");
    if (prefixStr) {
      possibleUndef = { ...possibleUndef, prefix: prefixStr };
    }

    const query: PartySocketOptions["query"] = {};

    const partySockOpts: PartySocketOptions = {
      id: this.id,
      // @ts-ignore - calling a private method
      // _pk: this.id,
      // @ts-ignore - calling a private method
      host: this.url.host,
      room: dbName,
      party,
      ...possibleUndef,
      query,
      path: this.url.pathname.replace(/^\//, ""),
    };

    if (runtimeFn().isNodeIsh) {
      const { WebSocket } = await import("ws");
      partySockOpts.WebSocket = WebSocket;
    }
    this.pso = partySockOpts;
    console.log("Party socket config", this.id);
    return Result.Ok(ret);
  }

  async ready() {
    const pkKeyThis = pkKey(this.pso);
    console.log("Ready", this.id, pkKeyThis);
    return pkSockets.get(pkKeyThis).once(async () => {
      // this.logger.Debug().Any("partySockOpts", this.pso).Str("this.id", this.id).Msg("Party socket options");
      if (!this.pso) {
        throw new Error("Party socket options not found");
      }
      console.log("Party socket options2", this.id, this.pso);

      this.party = new PartySocket(this.pso);
      console.log("Party socket created", this.id, this.party.url);

      let exposedResolve: (value: boolean) => void;

      const openFn = () => {
        this.logger.Debug().Msg("party open");

        /// we shouldn't open the party socket until we have a subscriber

        console.log("Party socket open", this.id, this.party?.url);

        // add our event listener
        this.party?.addEventListener("message", async (event: MessageEvent<string>) => {
          this.logger.Debug().Msg(`got message: ${event.data}`);
          const enc = new TextEncoder();
          this.messageResolve?.(enc.encode(event.data));
          setTimeout(() => {
            this.messagePromise = new Promise<Uint8Array>((resolve) => {
              this.messageResolve = resolve;
            });
          }, 0);
        });
        this.logger.Debug().Msg("Resolving exposed resolve");
        exposedResolve(true);
      };

      return await new Promise<boolean>((resolve) => {
        exposedResolve = resolve;
        console.log("Party socket wait", this.id, this.party?.url);
        this.party?.addEventListener("open", openFn);
      });
    });
  }

  async close(url: URI): Promise<bs.VoidResult> {
    await this.ready();
    this.logger.Debug().Msg("close");
    // this.party?.close()
    return Result.Ok(undefined);
  }

  async put(uri: URI, body: Uint8Array): Promise<Result<void>> {
    this.logger.Debug().Msg(`about to put: ${uri.toString()}`);
    await this.ready();
    return exception2Result(async () => {
      const { store } = getStore(uri, this.sthis, (...args) => args.join("/"));
      switch (store) {
        case "meta":
          this.logger.Debug().Msg(`meta store put operation with body: ${new TextDecoder().decode(body)}`);
          // this.party?.send(new TextDecoder().decode(body));
          await this.metaUpload(uri, body);
          break;
        default:
          await this.dataUpload(uri, body);
      }
    });
  }

  async metaUpload(uri: URI, bytes: Uint8Array) {
    const key = uri.getParam("key");
    if (!key) throw new Error("key not found");
    console.log("Meta upload", this.party?.url);
    const uploadUrl = pkMetaURL(this.party, uri, key);
    this.logger.Debug().Msg(`metaUpload URL: ${uploadUrl.toString()}`);
    const response = await fetch(uploadUrl.toString(), { method: "PUT", body: bytes });
    if (response.status === 404) {
      throw new Error("Failure in uploading meta!");
    }
  }

  async dataUpload(uri: URI, bytes: Uint8Array) {
    const key = uri.getParam("key");
    if (!key) throw new Error("key not found");
    console.log("data upload", this.party?.url);

    const uploadUrl = pkCarURL(this.party, uri, key);
    const response = await fetch(uploadUrl.toString(), { method: "PUT", body: bytes });
    if (response.status === 404) {
      throw new Error("Failure in uploading data!");
    }
  }

  async subscribe(uri: URI, callback: (data: Uint8Array) => void): Promise<bs.VoidResult> {
    this.logger.Debug().Msg(`about to subscribe: ${uri.toString()}`);
    await this.ready();
    // await this.connectToParty();
    this.logger.Debug().Msg(`subscribe ready: ${uri.toString()}`);
    return exception2Result(async () => {
      const store = uri.getParam("store");
      switch (store) {
        case "meta":
          this.party?.addEventListener("message", async (event: MessageEvent<string>) => {
            this.logger.Debug().Msg(`got message: ${event.data}`);
            const enc = new TextEncoder();
            callback(enc.encode(event.data));
          });
          break;
        default:
          throw new Error("store must be meta");
      }
    });
  }

  async get(uri: URI): Promise<bs.GetResult> {
    this.logger.Debug().Msg(`about to get: ${uri.toString()}`);
    await this.ready();
    this.logger.Debug().Msg(`get ready: ${uri.toString()}`);
    console.log("Get ready", this.party?.url);
    return exceptionWrapper(async () => {
      const store = uri.getParam("store");
      switch (store) {
        case "meta":
          this.logger.Debug().Msg("Get clock message promise resolution");
          return Result.Ok(await this.metaDownload(uri));
          break;
        default:
          return Result.Ok(await this.dataDownload(uri));
      }
    });
  }

  async metaDownload(uri: URI) {
    const key = uri.getParam("key");
    if (!key) throw new Error("key not found");
    console.log("Meta download", this.party?.url);
    const downloadUrl = pkMetaURL(this.party, uri, key);
    console.log("Meta download URL", downloadUrl.toString());
    this.logger.Debug().Msg(`metaDownload URL: ${downloadUrl.toString()}`);
    const response = await fetch(downloadUrl.toString(), { method: "GET" });
    if (response.status === 404) {
      throw new Error("Failure in downloading meta!");
    }
    const data = await response.arrayBuffer();
    return new Uint8Array(data);
  }

  async dataDownload(uri: URI) {
    const key = uri.getParam("key");
    if (!key) throw new Error("key not found");
    console.log("Data download", this.party?.url);
    const downloadUrl = pkCarURL(this.party, uri, key);
    const response = await fetch(downloadUrl.toString(), { method: "GET" });
    if (response.status === 404) {
      throw new Error("Failure in downloading data!");
    }
    const data = await response.arrayBuffer();
    // const data = Base64.toUint8Array(base64String)
    return new Uint8Array(data);
  }

  async delete(uri: URI): Promise<bs.VoidResult> {
    await this.ready();
    return exception2Result(async () => {
      // Implement the delete logic for Netlify
      return Result.Ok(undefined);
    });
  }

  async destroy(uri: URI): Promise<Result<void>> {
    await this.ready();
    return exception2Result(async () => {
      // const key = uri.getParam("key");
      // if (!key) throw new Error("key not found");
      const deleteUrl = pkBaseURL(this.party, uri);
      const response = await fetch(deleteUrl.toString(), { method: "DELETE" });
      if (response.status === 404) {
        throw new Error("Failure in deleting data!");
      }
      return Result.Ok(undefined);
    });
  }
}

const pkSockets = new KeyedResolvOnce<PartySocket>();

function pkKey(set?: PartySocketOptions): string {
  const ret = JSON.stringify(
    Object.entries(set || {})
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([k]) => k !== "id")
      .map(([k, v]) => ({ [k]: v }))
  );
  return ret;
}
// ws://localhost:1999/parties/fireproof/test-public-api?_pk=zp9BXhS6u
// partykit://localhost:1999/?name=test-public-api&protocol=ws&store=meta
function pkURL(party: PartySocket | undefined, uri: URI, key: string, type: "car" | "meta"): URI {
  // if (!party) {
  //   throw new Error("party not found");
  // }
  console.log("pkURL", party?.url);
  // let proto = "https";
  // const protocol = uri.getParam("protocol");
  // if (protocol === "ws") {
  //   proto = "http";
  // }
  // return BuildURI.from(party.url).protocol(proto).delParam("_pk").setParam(type, key).URI();

  // function pkURL(party: PartySocket | undefined, uri: URI, key: string, type: "car" | "meta"): URI {
  // console.log("pkURL", party?.url);
  const host = uri.host;
  const name = uri.getParam("name");
  const protocol = uri.getParam("protocol") === "ws" ? "http" : "https";
  const path = `/parties/fireproof/${name}`;
  return BuildURI.from(`${protocol}://${host}${path}`).setParam(type, key).URI();
  // }
}

function pkBaseURL(party: PartySocket | undefined, uri: URI): URI {
  // if (!party) {
  //   throw new Error("party not found");
  // }
  // let proto = "https";
  // const protocol = uri.getParam("protocol");
  // if (protocol === "ws") {
  //   proto = "http";
  // }
  console.log("pkBaseURL", party?.url);
  const host = uri.host;
  const name = uri.getParam("name");
  const protocol = uri.getParam("protocol") === "ws" ? "http" : "https";
  const path = `/parties/fireproof/${name}`;
  return BuildURI.from(`${protocol}://${host}${path}`).URI();
  // return BuildURI.from(party.url).protocol(proto).delParam("_pk").URI();
}

function pkCarURL(party: PartySocket | undefined, uri: URI, key: string): URI {
  return pkURL(party, uri, key, "car");
}

function pkMetaURL(party: PartySocket | undefined, uri: URI, key: string): URI {
  return pkURL(party, uri, key, "meta");
}

export class PartyKitTestStore implements bs.TestGateway {
  readonly logger: Logger;
  readonly sthis: SuperThis;
  readonly gateway: bs.Gateway;
  constructor(gw: bs.Gateway, sthis: SuperThis) {
    this.sthis = sthis;
    this.logger = ensureLogger(sthis, "PartyKitTestStore");
    this.gateway = gw;
  }
  async get(uri: URI, key: string): Promise<Uint8Array> {
    const url = uri.build().setParam("key", key).URI();
    const dbFile = this.sthis.pathOps.join(rt.getPath(url, this.sthis), rt.getFileName(url, this.sthis));
    this.logger.Debug().Url(url.asURL()).Str("dbFile", dbFile).Msg("get");
    const buffer = await this.gateway.get(url);
    this.logger.Debug().Url(url).Str("dbFile", dbFile).Len(buffer).Msg("got");
    return buffer.Ok();
  }
}

export function registerPartyKitStoreProtocol(protocol = "partykit:", overrideBaseURL?: string) {
  return bs.registerStoreProtocol({
    protocol,
    overrideBaseURL,
    gateway: async (logger) => {
      return new PartyKitGateway(logger);
    },
    test: async (sthis: SuperThis) => {
      const gateway = new PartyKitGateway(sthis);
      return new PartyKitTestStore(gateway, sthis);
    },
  });
}
