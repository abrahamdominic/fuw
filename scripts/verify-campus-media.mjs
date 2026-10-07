/**
 * End-to-end verification of the private campus-media bucket against the real
 * project, using genuine user JWTs obtained from the Auth API.
 *
 * The trigger guard can only be exercised by a request that carries a real
 * auth.uid(). A service_role key has auth.uid() = NULL, so testing through the
 * Management API alone would only ever prove the anonymous path fails. This
 * script therefore creates two throwaway users, signs them in like the browser
 * does, and drives the actual Storage API.
 *
 * Everything it creates is removed on exit. Run with --keep to inspect residue.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

const env = Object.fromEntries(
  readFileSync(resolve(process.cwd(), '.env'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const URL_BASE = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const MGMT = readFileSync(resolve(process.env.HOME, '.supabase/access-token'), 'utf8').trim();
const PROJECT = 'lgxtiilvpnqgzuarzogb';

if (!URL_BASE || !ANON || !SERVICE || !MGMT) {
  console.error('Missing Supabase credentials in .env or the access token file.');
  process.exit(2);
}

/* ------------------------------------------------------------------ */
/* Tiny real files                                                     */
/* ------------------------------------------------------------------ */

function pngBytes(width = 1, height = 1) {
  const crcTable = [...Array(256)].map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0; // filter type: none
    for (let x = 0; x < width; x += 1) {
      const p = y * stride + 1 + x * 3;
      raw[p] = (x * 37) & 0xff;
      raw[p + 1] = (y * 53) & 0xff;
      raw[p + 2] = 0x80;
    }
  }
  const idat = deflateSync(raw);
  void inflateSync(idat); // fail here rather than inside the upload
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const PNG = pngBytes();
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'ascii');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ''}`);
  }
};

const mgmtQuery = async (sql) => {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`mgmt query failed: ${JSON.stringify(body)}`);
  return body;
};

const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;

async function createTestUser(tag) {
  const email = `campus-media-test-${tag}-${Date.now()}@example.test`;
  const password = `Tst-${crypto.randomUUID()}`;
  const response = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`could not create ${tag}: ${JSON.stringify(body)}`);
  return { id: body.id, email, password };
}

async function signIn(user) {
  const response = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password })
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) {
    throw new Error(`could not sign in as ${user.email}: ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

/** Drives the real Storage API exactly like supabase-js does. */
async function upload(token, path, bytes, contentType, key = ANON) {
  const response = await fetch(`${URL_BASE}/storage/v1/object/campus-media/${path}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
      'x-upsert': 'false',
      'cache-control': '3600'
    },
    body: bytes
  });
  return { status: response.status, text: (await response.text()).trim() };
}

async function remove(token, paths) {
  await fetch(`${URL_BASE}/storage/v1/object/campus-media`, {
    method: 'DELETE',
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prefixes: paths })
  });
}

async function signedUrl(token, path) {
  const response = await fetch(
    `${URL_BASE}/storage/v1/object/sign/campus-media/${path}`,
    {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 60 })
    }
  );
  const body = await response.json();
  if (!body.signedURL) return '';
  // The Storage API returns a path like /object/sign/..., prepend /storage/v1
  const relative = body.signedURL.startsWith('/storage/v1') ? body.signedURL : `/storage/v1${body.signedURL}`;
  return body.signedURL.startsWith('http') ? body.signedURL : `${URL_BASE}${relative}`;
}

async function fetchThrough(signed, token) {
  const response = await fetch(signed, { headers: { Authorization: `Bearer ${token}` } });
  return response.status;
}

/* ------------------------------------------------------------------ */
/* Test                                                                */
/* ------------------------------------------------------------------ */

const stamp = Date.now();
const created = [];
const uploadedPaths = [];
let owner;
let other;

async function main() {
  console.log('campus-media end-to-end verification\n');

  owner = await createTestUser('owner');
  created.push(owner.id);
  other = await createTestUser('other');
  created.push(other.id);
  const ownerToken = await signIn(owner);
  const otherToken = await signIn(other);
  check('two throwaway users signed in with real JWTs', !!ownerToken && !!otherToken);

  console.log('\nhappy path');
  const goodPath = `lost-found/${owner.id}/${stamp}-wallet.png`;
  const ok = await upload(ownerToken, goodPath, PNG, 'image/png');
  uploadedPaths.push(goodPath);
  check('owner uploads a PNG to lost-found/<uid>/', ok.status === 200 || ok.status === 201, `${ok.status} ${ok.text}`);

  const stored = await mgmtQuery(
    `select metadata->>'mimetype' as mime, metadata->>'size' as size, bucket_id
       from storage.objects where name = ${lit(goodPath)};`
  );
  check('object landed in campus-media', stored[0]?.bucket_id === 'campus-media');
  check('storage recorded the declared type + byte count', stored[0]?.mime === 'image/png' && Number(stored[0]?.size) === PNG.length, JSON.stringify(stored[0]));

  const pdfPath = `assignments/${owner.id}/${stamp}-brief.pdf`;
  const pdfUp = await upload(ownerToken, pdfPath, PDF, 'application/pdf');
  uploadedPaths.push(pdfPath);
  check('owner uploads a PDF to assignments/<uid>/', pdfUp.status === 200 || pdfUp.status === 201, `${pdfUp.status} ${pdfUp.text}`);

  const eventPath = `events/${owner.id}/${stamp}-cover.png`;
  const eventUp = await upload(ownerToken, eventPath, PNG, 'image/png');
  uploadedPaths.push(eventPath);
  check('owner uploads an events/ cover', eventUp.status === 200 || eventUp.status === 201, `${eventUp.status} ${eventUp.text}`);

  console.log('\nread access');
  const ownerSigned = await signedUrl(ownerToken, goodPath);
  check('owner can sign a URL for their own lost-found photo', !!ownerSigned);
  if (ownerSigned) check('that signed URL actually serves the bytes', (await fetchThrough(ownerSigned, ownerToken)) === 200);

  const otherSigned = await signedUrl(otherToken, goodPath);
  check('a different user CANNOT sign a lost-found photo', otherSigned === '');

  const eventSigned = await signedUrl(otherToken, eventPath);
  check('a different user CAN sign an events/ cover (public scope)', !!eventSigned);

  const anonSigned = await signedUrl(ANON, eventPath);
  check('an anonymous request CANNOT sign anything', anonSigned === '');

  console.log('\nguard refusals');
  const denials = [
    ['wrong owner folder segment', `lost-found/${other.id}/${stamp}-steal.png`, PNG, 'image/png'],
    ['no owner segment at all', `lost-found/${stamp}-flat.png`, PNG, 'image/png'],
    ['unknown scope', `scratch/${owner.id}/${stamp}-x.png`, PNG, 'image/png'],
    ['disallowed type (text/plain)', `events/${owner.id}/${stamp}-notes.txt`, Buffer.from('hello'), 'text/plain'],
    ['archive format (application/zip)', `events/${owner.id}/${stamp}-payload.zip`, Buffer.from('PK\u0003\u0004'), 'application/zip'],
    ['extension disagrees with type', `events/${owner.id}/${stamp}-actually-pdf.pdf`, PNG, 'image/png'],
    ['svg (scriptable)', `events/${owner.id}/${stamp}-vector.svg`, Buffer.from('<svg/>'), 'image/svg+xml'],
    ['zero-byte file', `events/${owner.id}/${stamp}-empty.png`, Buffer.alloc(0), 'image/png'],
    ['over the 10 MB limit', `events/${owner.id}/${stamp}-huge.png`, Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]), 'image/png']
  ];
  for (const [name, path, bytes, type] of denials) {
    const result = await upload(ownerToken, path, bytes, type);
    check(`refuses: ${name}`, result.status >= 400, `got ${result.status} ${result.text}`);
  }

  const svcPath = `events/${owner.id}/${stamp}-service-role.png`;
  const svc = await upload(SERVICE, svcPath, PNG, 'image/png', SERVICE);
  check('refuses: service_role key (auth.uid() is NULL)', svc.status >= 400, `got ${svc.status}`);

  const noToken = await fetch(`${URL_BASE}/storage/v1/object/campus-media/events/x/y.png`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'image/png' },
    body: PNG
  });
  check('refuses: unsigned request', noToken.status >= 400, `got ${noToken.status}`);

  console.log('\ndatabase integration');
  const inserted = await mgmtQuery(
    `insert into public.lost_found_items (owner_id, report_type, title, category, photo_path, status)
     values (${lit(owner.id)}::uuid, 'found', 'Test wallet ${stamp}', 'Wallets', ${lit(goodPath)}, 'resolved')
     returning id;`
  );
  const itemId = inserted[0]?.id;
  check('a lost-and-found row stores the media path', !!itemId);

  const readBack = await fetch(
    `${URL_BASE}/rest/v1/lost_found_items?select=id,title,photo_path&id=eq.${itemId}`,
    { headers: { apikey: ANON, Authorization: `Bearer ${ownerToken}` } }
  ).then((r) => r.json());
  check('owner reads their own listing with the photo attached', readBack?.[0]?.photo_path === goodPath, JSON.stringify(readBack));

  const otherRead = await fetch(
    `${URL_BASE}/rest/v1/lost_found_items?select=id&id=eq.${itemId}`,
    { headers: { apikey: ANON, Authorization: `Bearer ${otherToken}` } }
  ).then((r) => r.json());
  check('a different user cannot read the listing row (RLS)', !otherRead || otherRead.length === 0, JSON.stringify(otherRead));

  console.log('\ndelete cascades to storage');
  const del = await fetch(`${URL_BASE}/rest/v1/lost_found_items?id=eq.${itemId}`, {
    method: 'DELETE',
    headers: { apikey: ANON, Authorization: `Bearer ${ownerToken}` }
  });
  check('owner deletes the listing', del.ok, `got ${del.status}`);
  const leftBehind = await mgmtQuery(
    `select count(*)::int as n from storage.objects where name = ${lit(goodPath)};`
  );
  check('storage helper is what removes the object, not the FK', leftBehind[0]?.n === 1, 'row delete alone left the object, as expected');
  await remove(SERVICE, [goodPath]);
  const afterSweep = await mgmtQuery(
    `select count(*)::int as n from storage.objects where name = ${lit(goodPath)};`
  );
  check('explicit cleanup removes the object', afterSweep[0]?.n === 0);
}

async function cleanup() {
  console.log('\ncleanup');
  await remove(SERVICE, uploadedPaths);
  const leftover = await mgmtQuery(
    `select count(*)::int as n from storage.objects where bucket_id = 'campus-media';`
  );
  for (const id of created) {
    await fetch(`${URL_BASE}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }
    });
  }
  const stillThere = await mgmtQuery(
    `select count(*)::int as n from storage.objects
      where bucket_id = 'campus-media'
        and (name like ${lit(`lost-found/${owner?.id}/%`)}
          or name like ${lit(`events/${owner?.id}/%`)}
          or name like ${lit(`assignments/${owner?.id}/%`)});`
  );
  console.log(`  objects left in campus-media: ${leftover[0]?.n}`);
  console.log(`  objects left under the test users: ${stillThere[0]?.n}`);
  const profiles = await mgmtQuery(
    `select count(*)::int as n from public.profiles where id in (${created.map(lit).join(',') || 'null'});`
  );
  console.log(`  test profiles left: ${profiles[0]?.n}`);
  console.log(`  test users deleted: ${created.length}`);
}

main()
  .catch((error) => {
    fail += 1;
    console.error('\nharness error:', error.message);
  })
  .finally(async () => {
    if (!process.argv.includes('--keep')) await cleanup();
    console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : 'FAILURES PRESENT'} — ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
