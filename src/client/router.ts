const RESULT_PATH = /^\/scans\/([0-9a-f-]{36})$/i

export type AppRoute =
  | { name: 'home' }
  | { name: 'example' }
  | { name: 'scan'; scanId: string }
  | { name: 'not-found' }

export function readRoute(pathname = window.location.pathname): AppRoute {
  if (pathname === '/') return { name: 'home' }
  if (pathname === '/example') return { name: 'example' }
  const result = RESULT_PATH.exec(pathname)
  return result ? { name: 'scan', scanId: result[1] } : { name: 'not-found' }
}

export function onRouteChange(listener: () => void): () => void {
  window.addEventListener('popstate', listener)
  return () => window.removeEventListener('popstate', listener)
}

export function navigateTo(path: string): void {
  if (path !== '/' && path !== '/example' && !RESULT_PATH.test(path)) return
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
