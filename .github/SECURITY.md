# Security

Report vulnerabilities privately through this repository's **Security → Report a vulnerability** feature. Do not put credentials, athlete data or production database copies in public issues or pull requests. Secret scanning and push protection are enabled for this fork.

## Session and permission changes

- Browser/PWA access tokens stay in memory. Refresh credentials use a host-only `HttpOnly` cookie, with `Secure` on HTTPS and `SameSite=Lax`; refresh and logout also check the configured origin and a CSRF token. Browser responses do not expose the refresh credential.
- Optional native builds keep access and refresh credentials in memory and preserve the bearer API protocol. They require a new login after the app process restarts. Adding persistent native sign-in would require an OS-backed secure store; localStorage is not used for session tokens.
- Sessions are recorded per device, refresh credentials are stored as hashes and rotated atomically, and reuse revokes the session. Logout revokes that device; password reset changes the credential version and revokes the user's app sessions. WebSockets close when a token expires or a session is revoked.
- Invitation issuance requires a persisted COACH role with completed onboarding, or SUPER_ADMIN. ATHLETE-only accounts can accept valid invitations but cannot issue them. Authorized COACH grants include ATHLETE; invitations never grant SUPER_ADMIN. Administrative permissions are separate from access to an athlete's training. See [roles and invitations](docs/ROLE-POLICY.md).
- Custom AI URLs are disabled by default. Enabling arbitrary/local endpoints is an explicit operator trust decision.
- The web proxy redirects HTTP reported by a trusted edge to HTTPS, sends HSTS on HTML responses, and omits URLs and referrers from its access log. HTML has a Content Security Policy and is not cached. The service worker caches the app shell and hashed assets, not API responses.

Legacy JWTs are intentionally invalidated by this release. Sign in again after upgrading. Browser/PWA refresh cookies retain the normal return-to-session flow; the native memory-only restriction is separate.

## Dependency advisory status

The standalone documentation lock was audited separately and its minimatch dependency was updated; its audit, type check and production build passed. Ruby Addressable was updated to 2.9.2 with Bundler 2.6.8, preserving CocoaPods and the existing Bundler version. The remaining alert and the withdrawn advisory are recorded below.

On 2026-11-16, GitHub withdrew [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) because it does not describe a security vulnerability. This repository still resolves `deepmerge@4.3.1` through Nest CLI/Jest tooling; no package override is required for the withdrawn advisory. On 2026-11-17, the stale Dependabot alert was reconciled as inaccurate after confirming the official advisory's `withdrawn_at` field. This does not dismiss an active vulnerability or disable scanning.

The optional Ruby mobile-release toolchain also retains the high-severity [ActiveSupport safe_constantize advisory](https://github.com/rails/rails/security/advisories/GHSA-8474-xrp6-wh69). The lock contains ActiveSupport 7.2.4; official fixes are 8.0.5.2/8.1.4.1, while [CocoaPods/Core 1.17.0 requires ActiveSupport below 8](https://rubygems.org/gems/cocoapods-core/versions/1.17.0/dependencies). No compatible official backport was found. The alert remains open; versions were not forced around that constraint and the lock was not removed. The affected Ruby code is not installed or executed in the Node/Nginx server images, which use Socket.IO rather than Rails Action Cable. Native release jobs and local Ruby tooling remain a separate risk when processing untrusted input. Review this advisory before building native apps and update when a compatible upstream fix is available.

This is a scoped hardening effort, not a guarantee that the program has no vulnerabilities. Keep deployment secrets private, install security updates, maintain backups and grant access only to appropriate users.
