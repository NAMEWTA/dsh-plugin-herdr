// Only accept the launch URL printed by our own loopback Web child.
export function readWebStartupUrl(output, origin) {
  for (const match of output.matchAll(/https?:\/\/[^\s\u001b<>"']+/g)) {
    try {
      const url = new URL(match[0])
      const token = url.searchParams.get('token')
      if (url.origin !== origin || url.pathname !== '/' || url.username || url.password) continue
      if (!token || !/^[A-Za-z0-9_-]{16,256}$/.test(token)) continue
      const launch = new URL('/', origin)
      launch.searchParams.set('token', token)
      return launch.href
    } catch { /* incomplete stdout chunk; retry when more data arrives */ }
  }
  return null
}

export function redactLaunchTokens(text) {
  return text.replace(/([?&]token=)[^&\s"'<>]+/g, '$1[redacted]')
}
