import {createHash, randomBytes} from 'node:crypto';
import {createCredentialStore} from './credentials.mjs';

export const DEFAULT_SERVICE_URL = 'https://mcp.rabbitdevelopment.net/';

const ERROR_MESSAGES = {
  SERVICE_NOT_CONFIGURED: '운영자가 배포한 MCP의 HTTPS 서비스 주소 설정이 필요합니다. 이용자의 API 키는 필요하지 않습니다.',
  INVALID_SERVICE_URL: '운영자가 HTTPS 서비스 주소 설정을 확인해야 합니다.',
  LOGIN_REQUIRED: 'connect_threads로 Threads 로그인을 시작하세요.',
  LOGIN_NOT_STARTED: 'connect_threads로 로그인을 먼저 시작하세요. MCP가 다시 시작됐다면 새로 로그인해야 합니다.',
  LOGIN_EXPIRED: '로그인 연결 시간이 만료됐습니다. connect_threads로 다시 시작하세요.',
  CONNECTION_EXISTS: '이미 연결돼 있습니다. 계정을 바꾸려면 disconnect_threads로 연결을 해제하세요.',
  REQUEST_FAILED: '서비스에 연결하지 못했습니다. 게시·유료 실행은 결과 확인 없이 다시 보내지 마세요.',
  INVALID_RESPONSE: '서비스 응답을 확인할 수 없습니다. 운영자에게 문의하세요.',
  CREDENTIAL_STORAGE_FAILED: '이 컴퓨터의 안전한 연결 정보 저장소를 사용할 수 없습니다.',
  SESSION_SAVE_PENDING: '연결은 완료됐지만 이 컴퓨터에 저장하지 못했습니다. finish_threads_login으로 저장을 다시 시도하거나 disconnect_threads로 연결을 해제하세요. MCP를 종료하면 임시 연결 정보가 사라집니다.',
  UNKNOWN_TOOL: '등록되지 않은 도구입니다.',
  INVALID_ARGUMENTS: '도구 입력 형식을 확인하세요.',
};
export class ClientError extends Error {
  constructor(code) { super(ERROR_MESSAGES[code] ?? '요청을 완료하지 못했습니다. 연결·권한·입력값을 확인하세요. 게시·유료 실행을 자동으로 재시도하지 마세요.'); this.code = code; }
}
function errorCode(value) { return typeof value === 'string' && /^[A-Z][A-Z_]{2,79}$/.test(value) ? value : 'REQUEST_FAILED'; }
export function errorResult(error) {
  const safe = error instanceof ClientError ? error : new ClientError('REQUEST_FAILED');
  return {isError: true, content: [{type: 'text', text: JSON.stringify({error: {code: safe.code, message: safe.message}})}]};
}
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function normalizeServiceUrl(value) {
  if (!value) throw new ClientError('SERVICE_NOT_CONFIGURED');
  let url;
  try { url = new URL(value); } catch { throw new ClientError('INVALID_SERVICE_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.hostname) throw new ClientError('INVALID_SERVICE_URL');
  url.pathname = url.pathname.replace(/\/+$/, '') + '/';
  return url.href;
}
function summary(account) {
  if (!object(account)) return undefined;
  const result = {};
  for (const key of ['id', 'username', 'name']) if (typeof account[key] === 'string') result[key] = account[key].slice(0, 200);
  return result;
}
function wrap(result) { return {content: [{type: 'text', text: JSON.stringify(result)}], structuredContent: {result}}; }

export class PlatformClient {
  #serviceInput; #fetch; #store; #pair; #now; #pendingStart; #pendingFinish; #unsavedSession;
  #credentialQueue = Promise.resolve();
  constructor({serviceUrl = process.env.THREADS_SERVICE_URL || DEFAULT_SERVICE_URL, fetchImpl = globalThis.fetch, store = createCredentialStore(), now = Date.now} = {}) {
    this.#serviceInput = serviceUrl; this.#fetch = fetchImpl; this.#store = store; this.#now = now;
  }
  #base() { return normalizeServiceUrl(this.#serviceInput); }
  #withCredentialLock(action) {
    const pending = this.#credentialQueue.then(action);
    this.#credentialQueue = pending.catch(() => {});
    return pending;
  }
  async #clearSessionIfCurrent(session) {
    return this.#withCredentialLock(async () => {
      try {
        const saved = await this.#store.read();
        if (saved?.serviceUrl === session.serviceUrl && saved.accessToken === session.accessToken) await this.#store.remove();
      } catch { throw new ClientError('CREDENTIAL_STORAGE_FAILED'); }
      if (this.#unsavedSession?.accessToken === session.accessToken && this.#unsavedSession.serviceUrl === session.serviceUrl) this.#unsavedSession = undefined;
    });
  }
  async #session() {
    const base = this.#base();
    try {
      const saved = this.#unsavedSession ?? await this.#store.read();
      if (!saved) return null;
      if (saved.serviceUrl !== base || typeof saved.accessToken !== 'string' || !/^[\x21-\x7e]{20,4096}$/.test(saved.accessToken)) throw new ClientError('CREDENTIAL_STORAGE_FAILED');
      // The service may extend an active session; expiresAt is informational.
      return saved;
    } catch (error) { throw error instanceof ClientError ? error : new ClientError('CREDENTIAL_STORAGE_FAILED'); }
  }
  async #request(path, {body, token} = {}) {
    const url = new URL(path, this.#base());
    const headers = {'Accept': 'application/json', 'Content-Type': 'application/json'};
    if (token) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
      response = await this.#fetch(url, {method: 'POST', headers, body: JSON.stringify(body ?? {}), redirect: 'error', signal: AbortSignal.timeout(120_000)});
      if (Number(response.headers.get('content-length')) > 2 * 1024 * 1024) throw new ClientError('INVALID_RESPONSE');
      const chunks = []; let size = 0;
      if (!response.body) throw new ClientError('INVALID_RESPONSE');
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 2 * 1024 * 1024) throw new ClientError('INVALID_RESPONSE');
        chunks.push(chunk);
      }
      const text = Buffer.concat(chunks).toString('utf8');
      let result;
      try { result = JSON.parse(text); } catch { throw new ClientError('INVALID_RESPONSE'); }
      if (!response.ok) {
        // Never expose provider error messages, raw response bodies, or headers.
        if (response.status === 401) throw new ClientError('LOGIN_REQUIRED');
        throw new ClientError(errorCode(result?.error?.code));
      }
      if (!object(result)) throw new ClientError('INVALID_RESPONSE');
      return result;
    } catch (error) { throw error instanceof ClientError ? error : new ClientError('REQUEST_FAILED'); }
  }
  async connect() {
    if (this.#pendingStart) return this.#pendingStart;
    this.#pendingStart = this.#start();
    try { return await this.#pendingStart; } finally { this.#pendingStart = undefined; }
  }
  async #start() {
    if (await this.#session()) {
      try { await this.call('connection_status'); }
      catch (error) {
        // Only an actual HTTP 401 clears the credential in call(). An expired
        // timestamp or a provider/network failure must not discard a session.
        if (!(error instanceof ClientError && error.code === 'LOGIN_REQUIRED' && !(await this.#session()))) throw error;
      }
      if (await this.#session()) throw new ClientError('CONNECTION_EXISTS');
    }
    if (this.#pair && Date.parse(this.#pair.expiresAt) > this.#now()) return this.#connectionPrompt(this.#pair);
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const result = await this.#request('connect/start', {body: {challenge, clientLabel: 'Codex Threads comment client'}});
    const base = new URL(this.#base()); let login;
    try { login = new URL(result.loginUrl); } catch { throw new ClientError('INVALID_RESPONSE'); }
    if (typeof result.id !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(result.id) || login.origin !== base.origin || !login.pathname.startsWith(base.pathname) || login.username || login.password || login.hash || !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= this.#now()) throw new ClientError('INVALID_RESPONSE');
    this.#pair = {id: result.id, loginUrl: login.href, expiresAt: result.expiresAt, verifier};
    return this.#connectionPrompt(this.#pair);
  }
  #connectionPrompt(pair) {
    return wrap({status: 'login_required', loginUrl: pair.loginUrl, expiresAt: pair.expiresAt, next: '사용 가능한 open_in_codex 도구로 이 로그인 주소를 오른쪽 브라우저에 열어 주세요. 도구가 없으면 링크를 보여 주세요. 사용자가 Threads 로그인·동의를 완료하면 finish_threads_login을 호출하세요. 비밀번호·토큰·API 키를 채팅으로 요구하지 마세요.'});
  }
  async finish() {
    if (this.#pendingFinish) return this.#pendingFinish;
    this.#pendingFinish = this.#finish();
    try { return await this.#pendingFinish; } finally { this.#pendingFinish = undefined; }
  }
  async #finish() {
    if (this.#unsavedSession) return this.#withCredentialLock(() => this.#saveReceivedSession());
    if (!this.#pair) throw new ClientError('LOGIN_NOT_STARTED');
    if (Date.parse(this.#pair.expiresAt) <= this.#now()) { this.#pair = undefined; throw new ClientError('LOGIN_EXPIRED'); }
    const pair = this.#pair;
    let result;
    try { result = await this.#request('connect/poll', {body: {id: pair.id, verifier: pair.verifier}}); }
    catch (error) {
      if (error instanceof ClientError && ['PAIRING_UNAVAILABLE', 'PAIRING_EXPIRED', 'PAIRING_CONSUMED', 'PAIR_EXPIRED', 'PAIR_CONSUMED', 'LOGIN_EXPIRED'].includes(error.code) && this.#pair === pair) this.#pair = undefined;
      throw error;
    }
    if (result.status === 'pending') return wrap({status: 'pending', message: 'Threads 로그인·동의를 완료한 뒤 다시 확인하세요.'});
    if (result.status !== 'connected' || typeof result.accessToken !== 'string' || !/^[\x21-\x7e]{20,4096}$/.test(result.accessToken) || !Number.isFinite(Date.parse(result.expiresAt))) throw new ClientError('INVALID_RESPONSE');
    // A successful poll consumes the pairing. Preserve the received credential
    // privately until saving succeeds, so a disk failure never causes re-polling.
    return this.#withCredentialLock(() => {
      this.#unsavedSession = {version: 1, serviceUrl: this.#base(), accessToken: result.accessToken, expiresAt: result.expiresAt, account: summary(result.account)};
      if (this.#pair === pair) this.#pair = undefined;
      return this.#saveReceivedSession();
    });
  }
  async #saveReceivedSession() {
    const session = this.#unsavedSession;
    if (!session) throw new ClientError('LOGIN_NOT_STARTED');
    try { await this.#store.write(session); }
    catch { throw new ClientError('SESSION_SAVE_PENDING'); }
    if (this.#unsavedSession === session) this.#unsavedSession = undefined;
    return wrap({status: 'connected', account: session.account, expiresAt: session.expiresAt});
  }
  async disconnect() {
    const session = await this.#session();
    if (!session) { this.#pair = undefined; return wrap({status: 'disconnected'}); }
    const pair = this.#pair;
    // A failed revoke must not silently discard the only local means to revoke it.
    await this.#request('connect/revoke', {token: session.accessToken});
    await this.#clearSessionIfCurrent(session);
    if (this.#pair === pair) this.#pair = undefined;
    return wrap({status: 'disconnected'});
  }
  async call(name, args = {}) {
    const session = await this.#session();
    if (!session) {
      if (name === 'connection_status') return wrap({connected: false, loginRequired: true, next: 'connect_threads'});
      throw new ClientError('LOGIN_REQUIRED');
    }
    let result;
    try { result = await this.#request(`api/tools/${encodeURIComponent(name)}`, {body: args, token: session.accessToken}); }
    catch (error) {
      if (error instanceof ClientError && error.code === 'LOGIN_REQUIRED') {
        await this.#clearSessionIfCurrent(session);
      }
      throw error;
    }
    if (result.isError) {
      let code = result.structuredContent?.error?.code;
      if (!code) for (const entry of result.content ?? []) { try { code = JSON.parse(entry.text)?.error?.code; } catch {} if (code) break; }
      throw new ClientError(errorCode(code));
    }
    if (!Array.isArray(result.content) || result.content.some(entry => !object(entry) || entry.type !== 'text' || typeof entry.text !== 'string')) throw new ClientError('INVALID_RESPONSE');
    if (name === 'delete_account_data') {
      const receipt = result.structuredContent?.result;
      if (!object(receipt) || !['completed', 'superseded'].includes(receipt.status) || typeof receipt.confirmationCode !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(receipt.confirmationCode) || receipt.statusUrl !== new URL(`data-deletion/status/${receipt.confirmationCode}`, this.#base()).href) throw new ClientError('INVALID_RESPONSE');
      if (receipt.status === 'completed') {
        try { await this.#clearSessionIfCurrent(session); }
        catch {
          // The server operation has succeeded. Keep its receipt rather than
          // presenting local cleanup failure as a reason to repeat deletion.
          result = {...result, structuredContent: {...result.structuredContent, result: {...receipt, localSessionCleared: false, message: '서버의 계정 자료 삭제는 완료됐습니다. 이 컴퓨터의 연결 정보 정리에 실패했습니다. 삭제 요청을 반복하지 말고 상태 링크를 보관한 뒤 운영자에게 문의하세요.'}}};
        }
      }
    }
    // The platform contract never returns provider credentials. Redact accidental
    // credential-shaped values and our own session even in a successful response.
    const forbidden = [session.accessToken, this.#pair?.verifier].filter(Boolean);
    const redact = text => {
      for (const secret of forbidden) text = text.split(secret).join('[REDACTED]');
      return text.replace(/apikey_[A-Za-z0-9_]+/g, '[REDACTED]').replace(/TH\|[^\s"<>]+/g, '[REDACTED]').replace(/Bearer\s+[^\s"<>]+/gi, 'Bearer [REDACTED]');
    };
    const clean = value => JSON.parse(redact(JSON.stringify(value, (key, item) => /^(access_?token|refresh_?token|client_?secret|api_?key|authorization|verifier)$/i.test(key) ? '[REDACTED]' : item)));
    return {content: result.content.map(entry => ({type: 'text', text: redact(entry.text)})), ...(object(result.structuredContent) ? {structuredContent: clean(result.structuredContent)} : {})};
  }
}
