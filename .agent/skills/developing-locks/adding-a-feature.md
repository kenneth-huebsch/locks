# Adding a Feature to Locks

Step-by-step guide for common feature work patterns.

## New Lambda API Endpoint

Example: Adding `GET /api/standings`

### 1. Shared Types (`shared/types.ts`)

Add the request/response types:

```typescript
export interface StandingsResponse {
  season: number;
  players: PlayerStandings[];
}

export interface PlayerStandings {
  playerId: string;
  displayName: string;
  wins: number;
  losses: number;
  pushes: number;
}
```

### 2. DynamoDB Helpers (`shared/dynamo.ts`)

Add any new key patterns or query helpers needed for the feature.

### 3. Lambda Handler (`backend/functions/standings.ts`)

Create the handler with a co-located test:

```typescript
// backend/functions/standings.ts
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
// ... imports from shared/

export async function handler(event: ApiGatewayEvent): Promise<ApiResponse> {
  // Parse JWT for player identity
  // Query DynamoDB
  // Return typed response
}
```

```typescript
// backend/functions/standings.test.ts
import { describe, it, expect } from 'vitest';
// Test the handler with mocked DynamoDB
```

### 4. CDK Wiring (`infrastructure/lib/locks-app-stack.ts`)

Add the Lambda function and API route:

```typescript
const standingsFunction = new NodejsFunction(this, 'StandingsFunction', {
  entry: 'backend/functions/standings.ts',
  // ... standard config
});
table.grantReadData(standingsFunction);

httpApi.addRoutes({
  path: '/api/standings',
  methods: [HttpMethod.GET],
  integration: new HttpLambdaIntegration('StandingsIntegration', standingsFunction),
  authorizer: cognitoAuthorizer,
});
```

### 5. CDK Test (`infrastructure/test/locks-app-stack.test.ts`)

Add assertions for the new function and route:

```typescript
it('creates a standings Lambda with read access to the table', () => { ... });
it('routes GET /api/standings with the Cognito authorizer', () => { ... });
```

### 6. Frontend API Client (`src/api.ts`)

Add the API call:

```typescript
export async function getStandings(): Promise<StandingsResponse> {
  const res = await fetch(`${apiBase}/api/standings`, { ... });
  return res.json();
}
```

### 7. Frontend Component

Create the component with a co-located test:

```typescript
// src/components/Standings.tsx
// src/components/Standings.test.tsx
```

### 8. Verify

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## New Scheduled Lambda

Example: Adding `grade-games`

### 1. Shared Types

Add types for game results and grading input/output.

### 2. Lambda Handler (`backend/functions/grade-games.ts`)

Create the handler. No API Gateway event — this is EventBridge-triggered.

### 3. CDK Wiring

Add `NodejsFunction`, grant DynamoDB read/write, add EventBridge schedule
in the `ScheduledFunctionsGroup`.

### 4. CDK Test

Assert the function exists, has correct permissions, and is scheduled.

### 5. Verify

Same checks. No frontend work needed for scheduled functions.

## New Frontend Component

### 1. Create Component

```typescript
// src/components/NewComponent.tsx
```

### 2. Create Test

```typescript
// src/components/NewComponent.test.tsx
```

Use the patterns from existing tests (`GameCard.test.tsx`, `WeekView.test.tsx`).
Mock API calls via `vi.mock('../api')`.

### 3. Import in Parent

Add to `WeekView.tsx` or `App.tsx` as appropriate.

### 4. Verify

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

## Modifying DynamoDB Key Patterns

1. Update `shared/dynamo.ts` — add or modify helpers
2. Update `shared/types.ts` if new data shapes are needed
3. Update `docs/data-model.md` with the new patterns
4. Update any Lambda handlers that use the keys
5. Add or update tests for the key helpers
6. Run full verification

**Never inline key construction in handlers.** Always go through `shared/dynamo.ts`.
