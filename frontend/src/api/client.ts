/** Cliente HTTP único. Erros da API chegam como ApiError {status, code, message}. */
export class ApiError extends Error {
  status: number
  code: string
  details: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

const TOKEN_KEY = 'clinica.token'
const REFRESH_KEY = 'clinica.refresh'
const CLINIC_KEY = 'clinica.clinic'
/** Token de acesso (curto) + token de renovação (30 dias) + clínica atual. */
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  refresh: () => localStorage.getItem(REFRESH_KEY),
  clinic: () => localStorage.getItem(CLINIC_KEY),
  set: (s: { token: string; refreshToken?: string; clinicId?: string }) => {
    localStorage.setItem(TOKEN_KEY, s.token)
    if (s.refreshToken) localStorage.setItem(REFRESH_KEY, s.refreshToken)
    if (s.clinicId) localStorage.setItem(CLINIC_KEY, s.clinicId)
  },
  clear: () => [TOKEN_KEY, REFRESH_KEY, CLINIC_KEY].forEach((k) => localStorage.removeItem(k)),
}

let onUnauthorized: () => void = () => {}
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn }

/** Rotas de login/renovação: nunca levam o token de acesso (um token vencido faria o servidor recusar). */
const PUBLIC = /^\/(auth\/(login|signup|refresh|logout|forgot|reset)|public\/)/

let refreshing: Promise<boolean> | null = null
/**
 * Renova a sessão uma vez só, mesmo com várias chamadas recebendo 401 ao mesmo tempo. Outra aba
 * pode ter renovado antes: aí basta usar o token que ela gravou.
 */
function renew(staleToken: string | null): Promise<boolean> {
  if (tokenStore.get() !== staleToken) return Promise.resolve(true)
  refreshing ??= (async () => {
    const rt = tokenStore.refresh()
    if (!rt) return false
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt, clinicId: tokenStore.clinic() ?? undefined }),
      })
      if (res.status === 409) return tokenStore.get() !== staleToken
      if (!res.ok) return false
      tokenStore.set(await res.json())
      return true
    } catch {
      return false
    }
  })().finally(() => { refreshing = null })
  return refreshing
}

/** 401 numa chamada autenticada: tenta renovar e repetir; sem sucesso, encerra a sessão. */
async function withAuth(path: string, send: (token: string | null) => Promise<Response>): Promise<Response> {
  const token = PUBLIC.test(path) ? null : tokenStore.get()
  const res = await send(token)
  if (res.status !== 401 || !token) return res
  if (await renew(token)) {
    const again = await send(tokenStore.get())
    if (again.status !== 401) return again
  }
  onUnauthorized()
  throw new ApiError(401, 'UNAUTHENTICATED', 'Sua sessão expirou. Entre de novo.')
}

export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let res: Response
  try {
    res = await withAuth(path, (token) => fetch('/api' + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }))
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError(0, 'NETWORK', 'Sem conexão com o servidor. Confira sua internet e tente de novo.')
  }
  const text = await res.text()
  const json = text ? JSON.parse(text) : null
  if (!res.ok) {
    throw new ApiError(res.status, json?.code ?? 'ERROR', json?.message ?? 'Não foi possível concluir. Tente de novo.', json?.details)
  }
  return json as T
}

export const get = <T>(p: string) => api<T>('GET', p)
export const post = <T>(p: string, b?: unknown, h?: Record<string, string>) => api<T>('POST', p, b ?? {}, h)
export const patch = <T>(p: string, b: unknown) => api<T>('PATCH', p, b)
export const del = (p: string) => api<void>('DELETE', p)
export const put = <T>(p: string, b: unknown) => api<T>('PUT', p, b)

/** Arquivo protegido (PDF, imagem): baixa com o token; a tela mostra por URL local (blob:). */
export async function getBlob(path: string): Promise<Blob> {
  const res = await withAuth(path, (token) => fetch('/api' + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} }))
  if (!res.ok) {
    const j = await res.json().catch(() => null)
    throw new ApiError(res.status, j?.code ?? 'ERROR', j?.message ?? 'Não foi possível abrir o arquivo.')
  }
  return res.blob()
}

/** Abre um PDF da API numa aba nova. A aba é aberta já no clique (senão o navegador bloqueia o pop-up). */
export async function openPdf(path: string) {
  const w = window.open('', '_blank')
  try {
    const url = URL.createObjectURL(await getBlob(path))
    if (w) w.location.href = url
    else window.location.href = url
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e) {
    w?.close()
    throw e
  }
}

/** Envio multipart com progresso (fetch não informa progresso de upload). */
export async function upload<T>(path: string, form: FormData, onProgress?: (pct: number) => void): Promise<T> {
  try {
    return await uploadOnce<T>(path, form, onProgress)
  } catch (e) {
    const stale = tokenStore.get()
    if (!(e instanceof ApiError) || e.status !== 401 || !stale) throw e
    if (await renew(stale)) return uploadOnce<T>(path, form, onProgress)
    onUnauthorized()
    throw new ApiError(401, 'UNAUTHENTICATED', 'Sua sessão expirou. Entre de novo.')
  }
}

function uploadOnce<T>(path: string, form: FormData, onProgress?: (pct: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api' + path)
    const token = tokenStore.get()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)) }
    xhr.onload = () => {
      const j = (() => { try { return JSON.parse(xhr.responseText) } catch { return null } })()
      if (xhr.status >= 200 && xhr.status < 300) resolve(j as T)
      else reject(new ApiError(xhr.status, j?.code ?? 'ERROR', j?.message ?? (xhr.status === 413 ? 'Arquivo grande demais.' : 'Não foi possível enviar.')))
    }
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK', 'Sem conexão com o servidor.'))
    xhr.send(form)
  })
}
