import { AuthorizationError, CimdFetchError, OAuthProvider, type OAuthHelpers } from '@cloudflare/workers-oauth-provider'
import { api } from './api'
import { appOrigin, getAuth, isIslesHost, readBearer } from './auth'
import { Db } from './db'
import { handleIslesHost } from './islehost'
import { handleMcp } from './mcp'
import { consentPage, esc, page, signInPage } from './pages'

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

const app: ExportedHandler<EnvWithOAuth> = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname === '/authorize') return authorize(request, env)
    if (url.pathname.startsWith('/api/') || url.pathname === '/auth/verify') return api.fetch(request, env, ctx)
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
