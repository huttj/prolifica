export const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{1,23}$/

export const RESERVED_HANDLES = new Set([
  'admin', 'api', 'app', 'auth', 'authorize', 'data', 'd', 'i', 'isle', 'isles', 'library', 'login', 'logout',
  'mcp', 'me', 'new', 'oauth', 'prolifica', 'register', 'settings', 'support', 'tree', 'www', 'help', 'about',
])
