# Roles, invitations and initial administration

This fork separates sports roles from global administration. Schema migrations
do not grant roles or repair existing accounts automatically.

## Permissions

| Account roles | Issue invitations | Personal training | Coached athletes | Global administration |
| --- | --- | --- | --- | --- |
| ATHLETE | No | Yes | No | No |
| COACH | Yes | If ATHLETE is also assigned | Own associations | No |
| ATHLETE + COACH | Yes | Yes | Own associations | No |
| SUPER_ADMIN | Yes | According to sports roles | According to sports roles | Yes |

An administrator is not a third sports profile. The sports selector shows only
the personal and coaching areas allowed by ATHLETE and COACH. Administrative
access does not grant implicit access to every athlete's training data.

The API checks the authenticated user's current database roles. Changing a
role invalidates existing sessions. Signup, onboarding, profile edits and
client-supplied role fields cannot grant COACH or SUPER_ADMIN. Ordinary signup
starts with ATHLETE. Every authorized new COACH grant includes ATHLETE.

Only coaches with completed onboarding, or super administrators, issue
invitations. An athlete can still accept or reject an invitation addressed to
their account, view their coaches and remove their own associations.

## Invitation purposes

- **Invite an athlete:** after acceptance, the recipient's existing Athlete
  profile is associated with the issuing coach.
- **Invite my coach (PERSONAL):** after acceptance, the recipient coaches only
  the issuer's personal Athlete profile. Existing invitations keep this meaning.
- **Invite a colleague (COLLEAGUE):** the recipient gets ATHLETE + COACH without
  any coaching association or access to the issuer's athletes.
- **Share athletes (SHARE):** after the recipient accepts the selected roster,
  both coaches retain the selected associations.
- **Transfer athletes (TRANSFER):** acceptance creates the recipient's selected
  associations before removing those same associations from the sender.

Sharing and transfer reuse Athlete and CoachAthlete. Calendars, historical
activities, metrics and connectors stay on the same profile. The recipient
receives the normal permissions of an associated coach, including existing
training history; unrelated private data and other athletes are not shared.

Roster operations are atomic. The server checks the sender's access again on
acceptance, validates the recipient and counts only new associations against
their subscription limit. Cancellation, expiry or a concurrent acceptance
cannot apply half an operation. Invitations never grant SUPER_ADMIN.

A new roster recipient first creates their coach/athlete account. Registration
reserves that email invitation but does not share or transfer any athlete.
After signing in and completing onboarding, they review the selected names in
received invitations and explicitly accept or reject the roster operation.

Email invitations remain bound to their original recipient. Open links require
no email and send no email when generated or copied. They expire after seven
days and may be used once by the first eligible recipient. A preview explains
the purpose before explicit acceptance. Treat an unused link as private: anyone
holding it may try to use it. Tokens must not be pasted into issues or logs.

Invitation signup uses email and password. Existing accounts can sign in with
their configured method and return to the live invitation for acceptance.
Provider signup is hidden for invitation flows; open-link provider signup is
also rejected by the API. Ordinary account signup and provider connections are
unchanged.

## First super administrator

Use the existing operator CLI inside the API container. There is no public
bootstrap endpoint and no special account-name or email rule in authorization.
Identify the account by its exact database ID and canonical login email first.

```bash
docker compose exec api openathlete list-users
docker compose exec api openathlete bootstrap-super-admin 42 operator@example.com
```

Without `--apply`, the command only previews the account, existing roles,
proposed role union and preserved Athlete profile ID. Review the exact target
and obtain approval for the production account change before running:

```bash
docker compose exec api openathlete bootstrap-super-admin 42 operator@example.com --apply
```

The command requires an exact ID/email match and adds ATHLETE, COACH and
SUPER_ADMIN to that account only. It preserves the existing Athlete profile,
calendars, activities, provider connections and coach associations. A real role
change revokes sessions; sign in again. Repeating the same operation is a no-op.

Subsequent role changes use the protected administration page/API. Removing the
last super administrator is rejected, including concurrent demotions. Before
removing COACH, remove active coaching links and cancel open athlete invitations
and pending SHARE/TRANSFER operations sent by that user. Previously authorized
PERSONAL/COLLEAGUE invitations remain valid until expiry or cancellation: their
acceptance does not require the owner to retain COACH. New issuance always
requires the current coach/administrator permission.
Administrative responses use explicit projections and exclude credentials,
session tokens and invitation links.

## Repairing legacy coach-only accounts

Use exact IDs and canonical emails, and review each account separately:

```bash
docker compose exec api openathlete repair-coach-athlete-role 42 coach@example.com
docker compose exec api openathlete inspect-athlete-coaches 42 coach@example.com
```

The repair defaults to preview and adds only ATHLETE to an existing COACH
account. It never grants COACH or SUPER_ADMIN, recreates a profile or unlinks
coaches. An actual `--apply` requires approval and invalidates that account's
sessions once; an identical repeat changes nothing. A mismatched ID/email or
inconsistent missing Athlete profile is rejected.

The separate inspection lists coaches of the account's personal Athlete
profile. Review those association IDs before requesting any removal. A coach
being listed does not prove that their association is unwanted. Remove only an
explicitly approved relation through administration; keep all training data.

## Migration and release checks

The migrations add SUPER_ADMIN, invitation purposes and open-link support. No
existing account is promoted or repaired by migration. Existing coach
invitations default to PERSONAL, preserving old links and their meaning.

Before applying the coach-athlete uniqueness constraint, run this read-only
preflight on the intended database:

```sql
SELECT user_id, athlete_id, COUNT(*) AS link_count
FROM coach_athlete
GROUP BY user_id, athlete_id
HAVING COUNT(*) > 1;
```

An empty result is required. If duplicates exist, stop and prepare a separate
reviewed repair; the migration deliberately refuses to delete relationships.
Back up the database and follow [the release procedure](DEPLOYMENT.md). New
migration trees require explicit operator validation in the deployment puller.

The schema changes do not justify dropping invitation rows or restoring an
older database over new data. Prefer a forward correction; assess old-code
compatibility before rolling back a release that has emitted new purposes.

The 1.6.1 Prisma client cannot read a user whose roles include SUPER_ADMIN.
Perform initial grants only after the new application is healthy. Automatic
activation rollback can recover the previous image before those grants; after
granting roles or using new invitation purposes, prefer a compatible forward
fix. Returning to 1.6.1 requires an explicitly reviewed role/invitation recovery
before changing images. Do not restore an old database over newer athlete data.

## Verification

Use Node 22 and pnpm 9 and the repository's verification entry point:

```bash
scripts/verify.sh --build
scripts/verify.sh --integration
scripts/verify.sh --e2e
```

Integration and full E2E need the documented disposable Docker stack. Never
point integration fixtures or bootstrap test helpers at a live installation.
When using an isolated native PostgreSQL test database instead, record that
environment and run migrations followed by `pnpm api test:integration` with
`INTEGRATION_DATABASE_URL` set explicitly.
