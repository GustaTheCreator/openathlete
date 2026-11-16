# Security

Report vulnerabilities privately through this repository's **Security → Report a vulnerability** feature. Do not put credentials, athlete data or production database copies in public issues or pull requests. Secret scanning and push protection are enabled for this fork.

## Session and permission changes

- Browser/PWA access tokens stay in memory. Refresh credentials use a host-only `HttpOnly` cookie, with `Secure` on HTTPS and `SameSite=Lax`; refresh and logout also check the configured origin and a CSRF token. Browser responses do not expose the refresh credential.
- Optional native builds keep access and refresh credentials in memory and preserve the bearer API protocol. They require a new login after the app process restarts. Adding persistent native sign-in would require an OS-backed secure store; localStorage is not used for session tokens.
- Sessions are recorded per device, refresh credentials are stored as hashes and rotated atomically, and reuse revokes the session. Logout revokes that device; password reset changes the credential version and revokes the user's app sessions. WebSockets close when a token expires or a session is revoked.
- Invitation issuance requires a persisted coach role and completed onboarding. Invitation types grant the corresponding role; onboarding may select only from roles already granted by the server. Any registered coach may invite, rather than an owner-only rule.
- Custom AI URLs are disabled by default. Enabling arbitrary/local endpoints is an explicit operator trust decision.
- The web proxy redirects HTTP reported by a trusted edge to HTTPS, sends HSTS on HTML responses, and omits URLs and referrers from its access log. HTML has a Content Security Policy and is not cached. The service worker caches the app shell and hashed assets, not API responses.

Legacy JWTs are intentionally invalidated by this release. Sign in again after upgrading. Browser/PWA refresh cookies retain the normal return-to-session flow; the native memory-only restriction is separate.

## Dependency advisory still visible

As of 2026-11-16, the dependency audit still reports [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) for `deepmerge@4.3.1`. It is a low-severity finding in development tooling used by Nest CLI/Jest; no production dependency path or application call receiving untrusted data was identified. No patched upstream release was available. The finding is retained in audit output rather than suppressed or hidden by a version alias. Recheck it when updating the toolchain and build only trusted projects.

This is a scoped hardening effort, not a guarantee that the program has no vulnerabilities. Keep deployment secrets private, install security updates, maintain backups and grant access only to appropriate users.
