import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, lstat, rm} from 'node:fs/promises';
import {join, resolve, sep} from 'node:path';
import {tmpdir} from 'node:os';
import {PlatformClient, DEFAULT_SERVICE_URL, errorResult} from '../src/client.mjs';
import {createCredentialStore} from '../src/credentials.mjs';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport, getDefaultEnvironment} from '@modelcontextprotocol/client/stdio';

const serviceUrl = 'https://service.example.test/comment/';
const future = '2099-01-01T00:00:00.000Z';
const sessionToken = 'platform-session-secret-0123456789012345';
const session = () => ({version: 1, serviceUrl, accessToken: sessionToken, expiresAt: future, account: {username: 'sample_business'}});
function memoryStore(initial = null) {
  let value = initial;
  const calls = [];
  return {calls, async read() { return value; }, async write(next) { calls.push('write'); value = next; }, async remove() { calls.push('remove'); value = null; }, value: () => value};
}
function fixture(handler = () => ({}), initial = null) {
  const store = memoryStore(initial); const calls = [];
  const fetchImpl = async (url, options) => {
    const call = {url: String(url), options, body: JSON.parse(options.body)}; calls.push(call);
    const result = await handler(call, calls.length);
    return result instanceof Response ? result : Response.json(result);
  };
  return {client: new PlatformClient({serviceUrl, fetchImpl, store}), store, calls};
}
const started = () => ({id: 'pair-0123456789abcdef', loginUrl: `${serviceUrl}connect/authorize?pair=pair-0123456789abcdef`, expiresAt: future});
const deletion = (status = 'completed') => ({content: [], structuredContent: {result: {status, confirmationCode: 'c'.repeat(43), statusUrl: `${serviceUrl}data-deletion/status/${'c'.repeat(43)}`}}});
const deletionInput = {confirmationUsername: 'sample_business', requestId: 'ba6e36ea-22f1-4f34-aa8f-d7245e51adac'};

test('missing/unsafe service URL never asks customers for provider secrets or makes requests', async () => {
  for (const value of ['', 'http://localhost:1234/', 'https://user:pass@example.test/', 'https://example.test/?token=secret', 'https://example.test/#fragment']) {
    let called = false;
    const client = new PlatformClient({serviceUrl: value, store: memoryStore(), fetchImpl: () => { called = true; }});
    await assert.rejects(client.connect(), error => ['SERVICE_NOT_CONFIGURED', 'INVALID_SERVICE_URL'].includes(error.code));
    assert.equal(called, false);
  }
});

test('customer install uses the built-in HTTPS operator address without environment configuration', async () => {
  const previous = process.env.THREADS_SERVICE_URL;
  delete process.env.THREADS_SERVICE_URL;
  let requested;
  try {
    const client = new PlatformClient({store: memoryStore(), fetchImpl: async url => {
      requested = String(url);
      return Response.json({...started(), loginUrl: `${DEFAULT_SERVICE_URL}connect/authorize?pair=pair-0123456789abcdef`});
    }});
    const result = await client.connect();
    assert.equal(requested, 'https://mcp.rabbitdevelopment.net/connect/start');
    assert.equal(result.structuredContent.result.loginUrl, 'https://mcp.rabbitdevelopment.net/connect/authorize?pair=pair-0123456789abcdef');
  } finally {
    if (previous === undefined) delete process.env.THREADS_SERVICE_URL;
    else process.env.THREADS_SERVICE_URL = previous;
  }
});

test('logged out status is local; protected tool cannot run', async () => {
  const {client, calls} = fixture();
  assert.deepEqual((await client.call('connection_status')).structuredContent.result, {connected: false, loginRequired: true, next: 'connect_threads'});
  await assert.rejects(client.call('search_threads', {query: 'sample'}), {code: 'LOGIN_REQUIRED'});
  assert.equal(calls.length, 0);
});

test('connect uses S256 and returns only a same-origin login URL, never verifier', async () => {
  const {client, calls, store} = fixture(call => call.url.endsWith('connect/start') ? started() : {status: 'pending'});
  const begin = await client.connect();
  await client.finish();
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].body.clientLabel, 'Codex Threads comment client');
  assert.match(calls[0].body.challenge, /^[A-Za-z0-9_-]{43}$/);
  const verifier = calls[1].body.verifier;
  assert.equal(createHash('sha256').update(verifier).digest('base64url'), calls[0].body.challenge);
  assert.ok(!JSON.stringify(begin).includes(verifier));
  assert.ok(!('verifier' in calls[0].body));
  assert.ok(!calls[0].options.headers.Authorization);
  assert.equal(store.value(), null);
  assert.equal((await client.connect()).structuredContent.result.loginUrl, started().loginUrl);
  assert.equal(calls.length, 2, 'repeated connect reuses pending pair rather than duplicating');
});

test('foreign login URLs and paths outside the configured service are rejected', async () => {
  for (const loginUrl of ['https://attacker.example/login', 'https://service.example.test/other/login', 'http://service.example.test/comment/login', 'https://u:p@service.example.test/comment/login']) {
    const {client} = fixture(() => ({...started(), loginUrl}));
    await assert.rejects(client.connect(), {code: 'INVALID_RESPONSE'});
  }
});

test('finish polls once, saves only platform credential, and does not reveal it', async () => {
  const {client, store, calls} = fixture(call => call.url.endsWith('connect/start') ? started() : call.url.endsWith('connection_status') ? {content: [], structuredContent: {connected: true}} : {status: 'connected', accessToken: sessionToken, expiresAt: future, account: {id: '123', username: 'sample_business', accessToken: 'must-not-save'}});
  await client.connect();
  const finished = await client.finish();
  assert.equal(calls.length, 2);
  assert.equal(store.value().accessToken, sessionToken);
  assert.equal(store.value().serviceUrl, serviceUrl);
  assert.deepEqual(store.value().account, {id: '123', username: 'sample_business'});
  assert.ok(!JSON.stringify(finished).includes(sessionToken));
  assert.ok(!JSON.stringify(finished).includes('must-not-save'));
  await assert.rejects(client.finish(), {code: 'LOGIN_NOT_STARTED'});
  await assert.rejects(client.connect(), {code: 'CONNECTION_EXISTS'});
});

test('parallel connect and finish coalesce instead of consuming pairing twice', async () => {
  const {client, calls} = fixture(call => call.url.endsWith('connect/start') ? started() : {status: 'connected', accessToken: sessionToken, expiresAt: future});
  await Promise.all([client.connect(), client.connect()]);
  assert.equal(calls.length, 1);
  await Promise.all([client.finish(), client.finish()]);
  assert.equal(calls.length, 2);
});

test('definite unavailable or expired pairing clears cached URL, but network error retains it', async () => {
  for (const code of ['PAIRING_UNAVAILABLE', 'PAIRING_EXPIRED', 'PAIRING_CONSUMED']) {
    let starts = 0;
    const {client, calls} = fixture(call => call.url.endsWith('connect/start') ? {...started(), id: `pair-start-${++starts}-0123456789`} : Response.json({error: {code}}, {status: 410}));
    await client.connect();
    await assert.rejects(client.finish(), {code});
    await client.connect();
    assert.equal(starts, 2);
    assert.equal(calls.length, 3);
  }
  const uncertain = fixture(call => { if (call.url.endsWith('connect/start')) return started(); throw new Error('network unavailable'); });
  const first = await uncertain.client.connect();
  await assert.rejects(uncertain.client.finish(), {code: 'REQUEST_FAILED'});
  assert.deepEqual(await uncertain.client.connect(), first);
  assert.equal(uncertain.calls.length, 2);
});

test('disk failure after one-time poll keeps session private and retries only local saving', async () => {
  const {client, store, calls} = fixture(call => call.url.endsWith('connect/start') ? started() : {status: 'connected', accessToken: sessionToken, expiresAt: future});
  const write = store.write; let fail = true;
  store.write = async value => { if (fail) throw new Error('disk unavailable'); return write(value); };
  await client.connect();
  try { await client.finish(); assert.fail('write should fail'); }
  catch (error) { assert.equal(error.code, 'SESSION_SAVE_PENDING'); assert.ok(!JSON.stringify(errorResult(error)).includes(sessionToken)); }
  assert.equal(store.value(), null);
  fail = false;
  assert.equal((await client.finish()).structuredContent.result.status, 'connected');
  assert.equal(calls.filter(call => call.url.endsWith('connect/poll')).length, 1);
  assert.equal(calls.length, 2);
  assert.equal(store.value().accessToken, sessionToken);
});

test('unsaved session can be revoked without repeating consumed pairing', async () => {
  const {client, store, calls} = fixture(call => call.url.endsWith('connect/start') ? started() : call.url.endsWith('connect/revoke') ? {revoked: true} : {status: 'connected', accessToken: sessionToken, expiresAt: future});
  store.write = async () => { throw new Error('disk unavailable'); };
  await client.connect();
  await assert.rejects(client.finish(), {code: 'SESSION_SAVE_PENDING'});
  await client.disconnect();
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, `${serviceUrl}connect/revoke`);
  assert.equal(calls[2].options.headers.Authorization, `Bearer ${sessionToken}`);
  assert.equal(store.value(), null);
  await assert.rejects(client.finish(), {code: 'LOGIN_NOT_STARTED'});
});

test('connect revalidates stored expired session; only actual 401 starts replacement pairing', async () => {
  const expired = {...session(), expiresAt: '2000-01-01T00:00:00.000Z'};
  const invalid = fixture(call => call.url.endsWith('connection_status') ? Response.json({error: {code: 'INVALID_SESSION'}}, {status: 401}) : started(), expired);
  assert.equal((await invalid.client.connect()).structuredContent.result.status, 'login_required');
  assert.equal(invalid.calls.length, 2);
  assert.equal(invalid.store.value(), null);
  const valid = fixture(() => ({content: [], structuredContent: {connected: true}}), expired);
  await assert.rejects(valid.client.connect(), {code: 'CONNECTION_EXISTS'});
  assert.equal(valid.calls.length, 1);
  assert.ok(valid.store.value());
  const network = fixture(() => { throw new Error('unavailable'); }, expired);
  await assert.rejects(network.client.connect(), {code: 'REQUEST_FAILED'});
  assert.equal(network.calls.length, 1);
  assert.ok(network.store.value());
  const toolDenied = fixture(() => ({isError: true, content: [{type: 'text', text: JSON.stringify({error: {code: 'LOGIN_REQUIRED'}})}]}), expired);
  await assert.rejects(toolDenied.client.connect(), {code: 'LOGIN_REQUIRED'});
  assert.equal(toolDenied.calls.length, 1);
  assert.ok(toolDenied.store.value(), 'a provider tool error is not HTTP session rejection');
});

test('expired local informational expiry still checks the server and uses platform bearer only', async () => {
  const saved = {...session(), expiresAt: '2000-01-01T00:00:00.000Z'};
  const {client, calls} = fixture(() => ({content: [{type: 'text', text: '{"connected":true}'}], structuredContent: {connected: true}}), saved);
  const result = await client.call('connection_status');
  assert.equal(result.structuredContent.connected, true);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${sessionToken}`);
  assert.equal(calls[0].url, `${serviceUrl}api/tools/connection_status`);
});

test('stored session cannot be sent to a different service', async () => {
  const {client, calls} = fixture(() => ({}), {...session(), serviceUrl: 'https://other.example/'});
  await assert.rejects(client.call('connection_status'), {code: 'CREDENTIAL_STORAGE_FAILED'});
  assert.equal(calls.length, 0);
});

test('disconnect revokes remotely before removing local state; failed revoke preserves it', async () => {
  const store = memoryStore(session());
  const client = new PlatformClient({serviceUrl, store, fetchImpl: async (url, options) => {
    assert.equal(String(url), `${serviceUrl}connect/revoke`);
    assert.equal(options.headers.Authorization, `Bearer ${sessionToken}`);
    assert.deepEqual(store.calls, []);
    return Response.json({revoked: true});
  }});
  await client.disconnect();
  assert.equal(store.value(), null);
  assert.deepEqual(store.calls, ['remove']);
  const failed = fixture(() => Response.json({error: {code: 'REVOKE_FAILED'}}, {status: 503}), session());
  await assert.rejects(failed.client.disconnect(), {code: 'REVOKE_FAILED'});
  assert.equal(failed.store.value().accessToken, sessionToken);
});

test('HTTP 401 invalidates local session for re-login; 403 does not', async () => {
  const denied = fixture(() => Response.json({error: {code: 'INVALID_SESSION'}}, {status: 401}), session());
  await assert.rejects(denied.client.call('connection_status'), {code: 'LOGIN_REQUIRED'});
  assert.equal(denied.store.value(), null);
  const forbidden = fixture(() => Response.json({error: {code: 'PERMISSION_REQUIRED'}}, {status: 403}), session());
  await assert.rejects(forbidden.client.call('connection_status'), {code: 'PERMISSION_REQUIRED'});
  assert.ok(forbidden.store.value());
});

test('confirmed account deletion clears only the completed session and preserves the receipt', async () => {
  const done = fixture(call => {assert.equal(call.url, `${serviceUrl}api/tools/delete_account_data`);assert.deepEqual(call.body, deletionInput);return deletion();}, session());
  const result = await done.client.call('delete_account_data', deletionInput);
  assert.equal(result.structuredContent.result.status, 'completed');assert.equal(result.structuredContent.result.statusUrl, deletion().structuredContent.result.statusUrl);assert.equal(done.store.value(), null);
  const newer = fixture(() => deletion('superseded'), session());
  assert.equal((await newer.client.call('delete_account_data', deletionInput)).structuredContent.result.status, 'superseded');assert.equal(newer.store.value().accessToken, sessionToken);
});

test('malformed deletion receipt or foreign status URL never clears credentials', async () => {
  for (const change of [{status: 'pending'}, {confirmationCode: 'short'}, {statusUrl: 'https://attacker.example/status'}, {statusUrl: `${serviceUrl}data-deletion/status/${'d'.repeat(43)}`}]) {
    const response = deletion();Object.assign(response.structuredContent.result, change);
    const f = fixture(() => response, session());
    await assert.rejects(f.client.call('delete_account_data', deletionInput), {code: 'INVALID_RESPONSE'});assert.equal(f.store.value().accessToken, sessionToken);
  }
});

test('deletion completion cannot erase a newer login saved while the request was pending', async () => {
  let complete;const pending = new Promise(resolve => {complete = resolve;});
  const freshToken = 'new-platform-session-secret-0987654321';
  const f = fixture(call => call.url.endsWith('/delete_account_data') ? pending : call.url.endsWith('/connect/start') ? started() : call.url.endsWith('/connect/poll') ? {status:'connected',accessToken:freshToken,expiresAt:future} : {revoked:true}, session());
  const deleting = f.client.call('delete_account_data', deletionInput);
  while (!f.calls.some(call => call.url.endsWith('/delete_account_data'))) await new Promise(resolve => setImmediate(resolve));
  await f.client.disconnect();await f.client.connect();await f.client.finish();
  complete(deletion());await deleting;
  assert.equal(f.store.value().accessToken, freshToken);
});

test('deletion retains successful server receipt if local credential cleanup fails', async () => {
  const f = fixture(() => deletion(), session());f.store.remove = async () => {throw new Error('local disk failure');};
  const result = await f.client.call('delete_account_data', deletionInput);
  assert.equal(result.structuredContent.result.status, 'completed');assert.equal(result.structuredContent.result.localSessionCleared, false);assert.equal(result.structuredContent.result.statusUrl, deletion().structuredContent.result.statusUrl);assert.equal(f.calls.length, 1);
});

test('remote HTTP and MCP error messages never reveal credentials', async () => {
  const secret = 'apikey_private_secret_do_not_print';
  for (const response of [Response.json({error: {code: 'PROVIDER_FAILED', message: secret}}, {status: 502}), {isError: true, content: [{type: 'text', text: JSON.stringify({error: {code: 'PROVIDER_FAILED', message: secret}})}]}]) {
    const {client} = fixture(() => response, session());
    try { await client.call('search_threads', {query: 'sample'}); assert.fail('should reject'); }
    catch (error) { const result = JSON.stringify(errorResult(error)); assert.ok(!result.includes(secret)); assert.ok(result.includes('PROVIDER_FAILED')); }
  }
});

test('successful result accidentally containing credential values is redacted', async () => {
  const {client} = fixture(() => ({content: [{type: 'text', text: `hello ${sessionToken} apikey_secret TH|123|secret`}], structuredContent: {accessToken: sessionToken, value: 'apikey_another'}}), session());
  const result = JSON.stringify(await client.call('connection_status'));
  assert.ok(!result.includes(sessionToken)); assert.ok(!result.includes('apikey_secret')); assert.ok(!result.includes('TH|123|secret')); assert.ok(result.includes('[REDACTED]'));
});

test('search failure has no automatic Apify fallback or retry and paid request is sent exactly once', async () => {
  const {client, calls} = fixture(() => Response.json({error: {code: 'PERMISSION_REQUIRED'}}, {status: 403}), session());
  await assert.rejects(client.call('search_threads', {query: 'sample'}));
  assert.equal(calls.length, 1); assert.ok(calls[0].url.endsWith('/search_threads'));
  const paid = fixture(() => { throw new Error('network failed with secret'); }, session());
  await assert.rejects(paid.client.call('start_apify_search', {requestId: 'sample', maxChargeUsd: 0.1}), {code: 'REQUEST_FAILED'});
  assert.equal(paid.calls.length, 1);
});

test('response size and malformed responses are bounded and sanitized', async () => {
  for (const response of [new Response('x'.repeat(2 * 1024 * 1024 + 1)), new Response('raw secret error'), Response.json({content: [{type: 'image', data: 'not-supported'}]})]) {
    const {client} = fixture(() => response, session());
    await assert.rejects(client.call('connection_status'), {code: 'INVALID_RESPONSE'});
  }
});

test('OS credential store roundtrip protects the saved platform session', async () => {
  const parent = resolve(tmpdir());
  const directory = await mkdtemp(join(parent, 'threads-client-credential-test-'));
  const path = join(directory, process.platform === 'win32' ? 'session.dpapi' : 'session.json');
  const store = createCredentialStore({path});
  try {
    assert.equal(await store.read(), null);
    await store.write(session());
    assert.deepEqual(await store.read(), session());
    if (process.platform === 'win32') assert.ok(!(await readFile(path)).includes(Buffer.from(sessionToken)));
    else { assert.equal((await lstat(path)).mode & 0o777, 0o600); assert.equal((await lstat(directory)).mode & 0o777, 0o700); }
    await store.write({...session(), account: {username: 'updated'}});
    assert.equal((await store.read()).account.username, 'updated');
    await store.remove(); assert.equal(await store.read(), null);
  } finally {
    const target = resolve(directory);
    assert.ok(target.startsWith(parent + sep) && target !== parent);
    await rm(target, {recursive: true, force: true});
  }
});

test('packaged entry point serves 19 MCP tools and validates destructive deletion input without URL configuration', async () => {
  const parent = resolve(tmpdir());
  const directory = await mkdtemp(join(parent, 'threads-client-stdio-test-'));
  const client = new Client({name: 'distributed-client-test', version: '1.0.0'});
  const transport = new StdioClientTransport({command: process.execPath, args: [resolve('src/index.mjs')], env: {...getDefaultEnvironment(), LOCALAPPDATA: directory, XDG_STATE_HOME: directory, THREADS_SERVICE_URL: ''}, stderr: 'pipe'});
  try {
    await client.connect(transport);
    const {tools} = await client.listTools();
    assert.equal(tools.length, 19);
    assert.equal(new Set(tools.map(tool => tool.name)).size, 19);
    const search = tools.find(tool => tool.name === 'search_threads');
    assert.equal(search.inputSchema.properties.query.type, 'string');
    assert.equal(search.inputSchema.properties.limit.maximum, 50);
    assert.ok(!search.inputSchema.required.includes('limit'), 'server-defaulted input stays optional');
    assert.equal(tools.find(tool => tool.name === 'publish_reply').inputSchema.properties.userConfirmed.const, true);
    assert.ok(tools.find(tool => tool.name === 'set_business_profile').inputSchema.properties.services);
    const remove = tools.find(tool => tool.name === 'delete_account_data');
    assert.equal(remove.annotations.destructiveHint, true);assert.equal(remove.annotations.readOnlyHint, false);assert.equal(remove.annotations.idempotentHint, true);
    assert.equal(remove.inputSchema.properties.confirmationUsername.type, 'string');assert.equal(remove.inputSchema.properties.requestId.format, 'uuid');assert.deepEqual([...remove.inputSchema.required].sort(), ['confirmationUsername','requestId']);assert.equal(remove.inputSchema.additionalProperties, false);
    const invalidDeletion = await client.callTool({name:'delete_account_data',arguments:{confirmationUsername:'sample_business',requestId:'not-a-uuid'}});
    assert.equal(invalidDeletion.isError, true);assert.ok(!JSON.stringify(invalidDeletion).includes('LOGIN_REQUIRED'), 'invalid deletion input fails before authentication or network');
    const status = await client.callTool({name: 'connection_status', arguments: {}});
    assert.ok(!status.isError);
    assert.equal(status.structuredContent.result.loginRequired, true);
    assert.equal(status.structuredContent.result.next, 'connect_threads');
    assert.ok(!JSON.stringify(status).includes('SERVICE_NOT_CONFIGURED'));
    const invalid = await client.callTool({name: 'search_threads', arguments: {query: 'sample', limit: 5000}});
    assert.equal(invalid.isError, true);
    assert.ok(!JSON.stringify(invalid).includes('SERVICE_NOT_CONFIGURED'), 'schema validation occurs before network/client handling');
  } finally {
    await client.close();
    const target = resolve(directory);
    assert.ok(target.startsWith(parent + sep) && target !== parent);
    await rm(target, {recursive: true, force: true});
  }
});
