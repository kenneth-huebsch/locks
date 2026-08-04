# Managing Cognito Users

## Current Users

| User | Status |
|---|---|
| `kenneth.huebsch@gmail.com` | Active, password changed |
| Jack | Pending — email address needed |
| Eric | Pending — email address needed |

## User Pool Details

- **Pool ID:** `us-east-1_6a7XXnD43`
- **Client ID:** `7vojip3hod4ioile2vi4n4mkmj`
- **Domain:** `https://locks-580956784928.auth.us-east-1.amazoncognito.com`
- **Registration:** Invite-only (public registration disabled)

## Creating a New User

**Requires explicit approval.** Use the AWS CLI with an admin profile (host)
or the `locks-publish` profile if it has Cognito permissions:

```bash
# Create user with temporary password
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_6a7XXnD43 \
  --username "<email>" \
  --user-attributes Name=email,Value="<email>" Name=email_verified,Value=true \
  --temporary-password "<temp-password>" \
  --message-action SUPPRESS \
  --region us-east-1
```

Or send an invitation email (Cognito sends it):

```bash
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_6a7XXnD43 \
  --username "<email>" \
  --user-attributes Name=email,Value="<email>" Name=email_verified,Value=true \
  --region us-east-1
```

## Resetting a User's Password

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id us-east-1_6a7XXnD43 \
  --username "<email>" \
  --password "<new-password>" \
  --permanent \
  --region us-east-1
```

## Listing Users

Read-only:

```bash
AWS_PROFILE=coding-agent aws cognito-idp list-users \
  --user-pool-id us-east-1_6a7XXnD43 \
  --output json
```

## Disabling a User

**Requires explicit approval.**

```bash
aws cognito-idp admin-disable-user \
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
