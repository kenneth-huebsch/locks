# Managing Cognito Users

## Current Users

| User | Email | Cognito `sub` | Status |
|---|---|---|---|
| Kenny | `kenneth.huebsch@gmail.com` | `24a8f498-30c1-70ad-4a0e-7e19c41aa52d` | Active (`CONFIRMED`) |
| Jack | `Jdmanning88@gmail.com` | `d4786428-20f1-706e-4859-0106786a1438` | Invited (`FORCE_CHANGE_PASSWORD`) |
| Kenny-2 | `kenny@puffin.dev` | `74886468-f081-7075-48c8-17f35e06d95e` | Invited (`FORCE_CHANGE_PASSWORD`) |

The picks board roster maps display names to Cognito `sub` values in
`src/lib/players.ts` (`KENNY_SUB`, `JACK_SUB`, `KENNY_2_SUB`). Do not change a
live user's `sub` by deleting and recreating the Cognito user.

## User Pool Details

- **Pool ID:** `us-east-1_6a7XXnD43`
- **Client ID:** `7vojip3hod4ioile2vi4n4mkmj`
- **Domain:** `https://locks-580956784928.auth.us-east-1.amazoncognito.com`
- **Registration:** Invite-only (public registration disabled)

## AWS Profile for User Operations

Mutating Cognito user operations require explicit approval. Use the Mira
shared-credentials profile that assumes `LocksAppPublishRole` (see
`APP_PUBLISH_ROLE_NAME` in `infrastructure/lib/github-oidc-stack.ts`):

```bash
AWS_PROFILE=locks-publish
```

The `coding-agent` profile remains read-only for DynamoDB, CloudFormation, and
IAM inspection. It does not grant Cognito permissions — use `locks-publish` for
`list-users` as well as create, disable, enable, and password operations.

## Creating a New User

**Requires explicit approval.** Use `AWS_PROFILE=locks-publish` (assumes
`LocksAppPublishRole`) once the Cognito user-ops IAM change is live:

```bash
# Create user with temporary password
AWS_PROFILE=locks-publish aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_6a7XXnD43 \
  --username "<email>" \
  --user-attributes Name=email,Value="<email>" Name=email_verified,Value=true \
  --temporary-password "<temp-password>" \
  --message-action SUPPRESS \
  --region us-east-1
```

Or send an invitation email (Cognito sends it):

```bash
AWS_PROFILE=locks-publish aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_6a7XXnD43 \
  --username "<email>" \
  --user-attributes Name=email,Value="<email>" Name=email_verified,Value=true \
  --region us-east-1
```

## Resetting a User's Password

**Requires explicit approval.**

```bash
AWS_PROFILE=locks-publish aws cognito-idp admin-set-user-password \
  --user-pool-id us-east-1_6a7XXnD43 \
  --username "<email>" \
  --password "<new-password>" \
  --permanent \
  --region us-east-1
```

## Listing Users

Read-only (use `locks-publish` — `coding-agent` has no Cognito permissions):

```bash
AWS_PROFILE=locks-publish aws cognito-idp list-users \
  --user-pool-id us-east-1_6a7XXnD43 \
  --output json
```

## Disabling a User

**Requires explicit approval.**

```bash
AWS_PROFILE=locks-publish aws cognito-idp admin-disable-user \
  --user-pool-id us-east-1_6a7XXnD43 \
  --username "<email>" \
  --region us-east-1
```

## Important Notes

- The Cognito user pool has a **destroy** removal policy. Deleting the pool
  is irreversible.
- Public registration is disabled. All users must be admin-created.
- Users must change their temporary password on first login.
- The app maps Cognito `sub` to player identity. Do not delete and recreate
  users — this creates a new `sub` and loses the player's pick history.
- `LocksAppPublishRole` grants create, get, list, enable, disable, set/reset
  password on the Locks user pool via the inline `CognitoUserOps` policy
  statement (not the role Description). It does not grant `AdminDeleteUser` or
  pool create/delete.
- Keep the `LocksAppPublishRole` IAM role Description stable in CDK. The
  foundation CloudFormation execution policy does not grant
  `iam:UpdateRoleDescription`; changing the Description blocks OIDC stack updates.
