/* eslint-disable no-console */
import { fireproof } from "@fireproof/core";
import { URI } from "@adviser/cement";

async function main() {
  // const sthis = ensureSuperThis();
  const url = URI.from("file://./dist/connect_to?storekey=@bla@");
  console.log("--1");
  const wdb = fireproof("my-database", {
    storeUrls: {
      base: "file://./dist/connector?storekey=@bla@",
    },
  });
  // db.connect("s3://testbucket/connector");
  // console.log("--2");
  // const connection = await connectionFactory(sthis, url);
  // console.log("--3");
  // await connection.connect(wdb.ledger.crdt.blockstore);

  // await new Promise((res) => setTimeout(res, 1000));

  console.log("--4");
  const ran = Math.random().toString();
  const count = 3;
  for (let i = 0; i < count; i++) {
    console.log("--4.01", i);
    await wdb.put({ _id: `key${i}:${ran}`, hello: `world${i}` });
    console.log("--4.02", i);
  }
  console.log("--4.1");
  for (let i = 0; i < count; i++) {
    expect(await wdb.get<{ hello: string }>(`key${i}:${ran}`)).toEqual({
      _id: `key${i}:${ran}`,
      hello: `world${i}`,
    });
  }
  console.log("--5");
  const docs = await wdb.allDocs();
  console.log("--6");
  expect(docs.rows.length).toBeGreaterThanOrEqual(count);
  (await wdb.ledger.crdt.blockstore.loader.attachedStores.local().active.wal)?.processQueue.waitIdle();
  // console.log("--7")
  await wdb.ledger.crdt.blockstore.destroy();
  // console.log("--8")

  const rdb = fireproof("", {
    storeUrls: {
      base: url,
    },
  });
  console.log("--9");
  const rdocs = await rdb.allDocs();
  // console.log("--10", rdocs)
  expect(rdocs.rows.length).toBeGreaterThanOrEqual(count);
  for (let i = 0; i < count; i++) {
    expect(await rdb.get<{ hello: string }>(`key${i}:${ran}`)).toEqual({
      _id: `key${i}:${ran}`,
      hello: `world${i}`,
    });
  }
  console.log("--11", rdocs.rows.length);
}

main().catch(console.error);
