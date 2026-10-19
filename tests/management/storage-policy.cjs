const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { createDatabase } = require('../database.cjs')
async function run() {
  const db = await createDatabase('040')
  try {
    await db.exec(
      "create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id integer,bucket_id text);alter table storage.objects enable row level security;create policy historical_broad_public_read on storage.objects for select to authenticated,anon using(true);grant usage on schema storage to authenticated,anon,service_role;grant select on storage.objects to authenticated,anon;insert into storage.objects values(1,'struct-firmware'),(2,'public-images');",
    )
    await db.exec(
      fs.readFileSync(
        'supabase/migrations/041_secure_device_operations.sql',
        'utf8',
      ),
    )
    assert.equal(
      (
        await db.query(
          "select public from storage.buckets where id='struct-firmware'",
        )
      ).rows[0].public,
      false,
    )
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role)
      assert.deepEqual(
        (await db.query('select id from storage.objects order by id')).rows,
        [{ id: 2 }],
      )
      await assert.rejects(
        db.query('select * from firmware_artifacts'),
        /permission denied/,
      )
      await db.exec('reset role')
    }
    console.log(
      'PASS 5 private firmware bucket/restrictive storage-policy checks, including pre-existing broad read policy',
    )
  } finally {
    await db.exec('reset role')
    await db.close()
  }
}
run().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
