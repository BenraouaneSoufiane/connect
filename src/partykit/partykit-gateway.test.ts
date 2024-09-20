import { fireproof, Database, bs } from "@fireproof/core";
import { registerPartyKitStoreProtocol } from "./gateway";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { URI } from "@adviser/cement";

interface ExtendedGateway extends bs.Gateway {
  logger: { _attributes: { module: string; url?: string } };
  headerSize: number;
  subscribe?: (url: URI, callback: (meta: Uint8Array) => void) => Promise<bs.VoidResult>;
}

interface ExtendedStore {
  gateway: ExtendedGateway;
  _url: URI;
  name: string;
}

async function smokeDB(db: Database) {
  const ran = Math.random().toString();
  for (let i = 0; i < 10; i++) {
    await db.put({ _id: `key${i}:${ran}`, hello: `world${i}` });
  }
  for (let i = 0; i < 10; i++) {
    expect(await db.get<{ hello: string }>(`key${i}:${ran}`)).toEqual({
      _id: `key${i}:${ran}`,
      hello: `world${i}`,
    });
  }
  const docs = await db.allDocs();
  expect(docs.rows.length).toBeGreaterThan(9);
  return docs.rows.map((row) => row.value);
}

describe("PartyKitGateway", () => {
  let db: Database;
  let unregister: () => void;

  beforeAll(() => {
    unregister = registerPartyKitStoreProtocol("partykit:");
  });

  beforeEach(() => {
    const config = {
      store: {
        stores: {
          base: process.env.FP_STORAGE_URL || "partykit://localhost:1999",
        },
      },
    };
    const name = "partykit-test-db-" + Math.random().toString(36).substring(7);
    db = fireproof(name, config);
  });

  afterEach(() => {
    // Clear the database before each test
    if (db) {
      db.destroy();
    }
  });

  afterAll(() => {
    unregister();
  });

  it("env setup is ok", () => {
    expect(process.env.FP_STORAGE_URL).toMatch(/partykit:\/\/localhost:1999/);
  });

  it("should have loader and options", () => {
    const loader = db.blockstore.loader;
    expect(loader).toBeDefined();
    if (!loader) {
      throw new Error("Loader is not defined");
    }
    expect(loader.ebOpts).toBeDefined();
    expect(loader.ebOpts.store).toBeDefined();
    expect(loader.ebOpts.store.stores).toBeDefined();
    if (!loader.ebOpts.store.stores) {
      throw new Error("Loader stores is not defined");
    }
    if (!loader.ebOpts.store.stores.base) {
      throw new Error("Loader stores.base is not defined");
    }

    const baseUrl = new URL(loader.ebOpts.store.stores.base.toString());
    expect(baseUrl.protocol).toBe("partykit:");
    expect(baseUrl.hostname).toBe("localhost");
    expect(baseUrl.port || "").toBe("1999");
  });

  it("should initialize and perform basic operations", async () => {
    const docs = await smokeDB(db);

    // // get a new db instance
    // db = new Database(name, config);

    // Test update operation
    const updateDoc = await db.get<{ content: string }>(docs[0]._id);
    updateDoc.content = "Updated content";
    const updateResult = await db.put(updateDoc);
    expect(updateResult.id).toBe(updateDoc._id);

    const updatedDoc = await db.get<{ content: string }>(updateDoc._id);
    expect(updatedDoc.content).toBe("Updated content");

    // Test delete operation
    await db.del(updateDoc._id);
    try {
      await db.get(updateDoc._id);
      throw new Error("Document should have been deleted");
    } catch (e) {
      const error = e as Error;
      expect(error.message).toContain("Not found");
    }

    // Clean up
    await db.destroy();
  });

  it("should subscribe to changes", async () => {
    // Extract stores from the loader
    const metaStore = (await db.blockstore.loader?.metaStore()) as unknown as ExtendedStore;

    const metaGateway = metaStore?.gateway;

    const metaUrl = await metaGateway?.buildUrl(metaStore?._url, "main");
    await metaGateway?.start(metaStore?._url);

    let didCall = false;

    if (metaGateway.subscribe) {
      let resolve: () => void;
      const p = new Promise<void>((r) => {
        resolve = r;
      });

      const metaSubscribeResult = await metaGateway?.subscribe?.(metaUrl?.Ok(), async (data: Uint8Array) => {
        const decodedData = new TextDecoder().decode(data);
        expect(decodedData).toContain("parents");
        didCall = true;
        resolve();
      });
      expect(metaSubscribeResult?.Ok()).toBeTruthy();
      const ok = await db.put({ _id: "key1", hello: "world1" });
      expect(ok).toBeTruthy();
      expect(ok.id).toBe("key1");
      await p;
      expect(didCall).toBeTruthy();
    }
  });
});
