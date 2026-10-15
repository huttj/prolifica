import { AuthorizationError, CimdFetchError, OAuthProvider, type OAuthHelpers } from '@cloudflare/workers-oauth-provider'
import { api } from './api'
import { appOrigin, getAuth, isIslesHost, readBearer } from './auth'
import { Db } from './db'
import { handleIslesHost } from './islehost'
import { handleMcp } from './mcp'
import { consentPage, esc, isleShareTags, page, signInPage } from './pages'
import { shotTag } from './store'

/**
 * One worker, two hosts:
 *   isles.prolifica.app   people's pages (islehost.ts), nothing else
 *   prolifica.app         the app: /api, /mcp (OAuth-protected), /authorize, and the SPA
 */

type Props = { userId: string }
type EnvWithOAuth = Env & { OAUTH_PROVIDER: OAuthHelpers }

async function authorize(request: Request, env: EnvWithOAuth): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER
  try {
    if (request.method === 'POST') {
      const auth = await getAuth(request, env)
      if (!auth || auth.viaToken) return page('Sign in', '<h1>Your sign-in expired</h1><p>Start connecting again from your app.</p>', undefined, 401)
      const form = await request.formData()
      const handle = String(form.get('handle') ?? '')
      if (form.get('decision') !== 'approve') {
        const denied = await oauth.denyConsent(request, handle)
        return new Response(null, { status: 302, headers: denied.headers })
      }
      const approved = await oauth.approveConsent(request, handle, { scope: ['prolifica'] })
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: auth.user.id,
        metadata: { email: auth.user.email },
        scope: approved.request.scope,
        props: { userId: auth.user.id } satisfies Props,
      })
      approved.headers.set('Location', redirectTo)
      return new Response(null, { status: 302, headers: approved.headers })
    }

    const authRequest = await oauth.parseAuthRequest(request)
    const details = await oauth.describeConsent(authRequest)
    const auth = await getAuth(request, env)
    if (!auth || auth.viaToken) {
      const url = new URL(request.url)
      return signInPage(url.pathname + url.search, details.clientName)
    }
    const consent = await oauth.beginConsent({ ...authRequest, scope: ['prolifica'] })
    const who = auth.user.handle ? `@${auth.user.handle}` : auth.user.email
    return page('Connect', consentPage(details, consent.handle, who), consent.headers)
  } catch (e) {
    if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302)
    if (e instanceof AuthorizationError || e instanceof CimdFetchError) {
      const message = e instanceof AuthorizationError ? e.description : 'This app could not be verified.'
      return page('Could not connect', `<h1>Could not connect</h1><p>${esc(message ?? 'Something about this request was off.')}</p>`, undefined, 400)
    }
    throw e
  }
}

/**
 * An isle's page in the app, with link-preview tags so a shared link unfurls with its title and picture.
 * Only what anyone may see: a private isle gets the plain page.
 */
async function islePage(request: Request, env: Env, id: string): Promise<Response> {
  const res = await env.ASSETS.fetch(new Request(new URL('/', request.url), request))
  const row = await env.DB.prepare('SELECT i.id, i.title, i.description, i.visibility, i.shot_version, i.squashes, u.handle FROM isles i JOIN users u ON u.id = i.owner_id WHERE i.id = ? AND i.deleted_at IS NULL')
    .bind(id)
    .first<{ id: string; title: string; description: string | null; visibility: string; shot_version: number | null; squashes: number; handle: string | null }>()
  if (!row || row.visibility === 'private' || !res.headers.get('content-type')?.includes('text/html')) return res
  const origin = appOrigin(request, env)
  const share = isleShareTags({ title: row.title, description: row.description, owner: row.handle, url: `${origin}/i/${row.id}`, image: `${origin}/api/isles/${row.id}/shot?og&v=${shotTag(row)}` })
  return new HTMLRewriter()
    .on('title', { element: (e) => void e.setInnerContent(share.title) })
    .on('meta[name="description"]', { element: (e) => void e.setAttribute('content', share.description) })
    .on('head', { element: (e) => void e.append(share.tags, { html: true }) })
    .transform(res)
}

const app: ExportedHandler<EnvWithOAuth> = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname === '/authorize') return authorize(request, env)
    if (url.pathname.startsWith('/api/') || url.pathname === '/auth/verify') return api.fetch(request, env, ctx)
    const isle = request.method === 'GET' && /^\/i\/([a-z0-9]+)(?:\/family)?\/?$/.exec(url.pathname)
    if (isle) return islePage(request, env, isle[1]!)
    if (url.pathname === '/login' && url.searchParams.has('next')) return env.ASSETS.fetch(new Request(new URL('/', url), request))
    return env.ASSETS.fetch(request)
  },
}

const mcp: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    const props = (ctx as ExecutionContext & { props?: Props }).props
    if (!props?.userId) return new Response('Unauthorized', { status: 401 })
    return handleMcp(request, env, props.userId, ctx)
  },
}

/** One provider per app origin, so local dev (http://localhost:port) gets metadata that points at itself. */
const providers = new Map<string, OAuthProvider<Env>>()
function provider(origin: string) {
  let p = providers.get(origin)
  if (!p) {
    p = new OAuthProvider<Env>({
      apiRoute: '/mcp',
      apiHandler: mcp as never,
      defaultHandler: app as never,
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      scopesSupported: ['prolifica'],
      resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin] },
      clientIdMetadataDocumentEnabled: true,
      accessTokenTTL: 60 * 60,
      refreshTokenTTL: 90 * 24 * 60 * 60,
      // a personal key (pro_…) also opens /mcp, for clients configured with a header (Claude Code, scripts)
      resolveExternalToken: async ({ token, env }) => {
        if (!token.startsWith('pro_')) return null
        const user = await new Db(env.DB).userByApiToken(token)
        return user ? { props: { userId: user.id } satisfies Props, audience: `${origin}/mcp` } : null
      },
    })
    providers.set(origin, p)
  }
  return p
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (isIslesHost(request, env)) return handleIslesHost(request, env)
    const url = new URL(request.url)
    // keys in the URL, for clients that can only paste one (/mcp?key=pro_…)
    if (url.pathname === '/mcp' && url.searchParams.get('key')?.startsWith('pro_') && !readBearer(request)) {
      const headers = new Headers(request.headers)
      headers.set('authorization', `Bearer ${url.searchParams.get('key')}`)
      request = new Request(request, { headers })
    }
    return provider(appOrigin(request, env)).fetch(request, env, ctx)
  },
}
