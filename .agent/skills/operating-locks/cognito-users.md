# Managing Cognito Users

## Current Users

| User | Status |
|---|---|
| `kenneth.huebsch@gmail.com` | Active, password changed |
| Jack (`Jdmanning88@gmail.com`) | Pending — invite not yet issued (awaiting IAM deploy and user creation) |
| Eric | Pending — email address needed |

## User Pool Details

- **Pool ID:** `us-east-1_6a7XXnD43`
- **Client ID:** `7vojip3hod4ioile2vi4n4mkmj`
- **Domain:** `https://locks-580956784928.auth.us-east-1.amazoncognito.com`
- **Registration:** Invite-only (public registration disabled)

## AWS Profile for User Operations

Mutating Cognito user operations require explicit approval. After the
`LocksAppPublishRole` Cognito user-ops policy is deployed, use the Mira
shared-credentials profile that assumes that role:

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
