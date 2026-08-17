# Locks Testing Guide

## Test Runner

Vitest. Config in `vitest.config.ts`.

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Specific file
npx vitest run path/to/file.test.ts

# By pattern
npx vitest run -t "pattern"
```

## Test Layers

### Unit Tests (co-located)

Every source file has a co-located `.test.ts`:

| Layer | Location | What to Test |
|---|---|---|
| Shared | `shared/*.test.ts` | Type behavior, key patterns, team mappings |
| Backend lib | `backend/lib/*.test.ts` | Odds API client, ESPN scoreboard client, game mapper |
| Backend functions | `backend/functions/*.test.ts` | Handler logic with mocked DynamoDB |
| Frontend | `src/**/*.test.tsx` | Component rendering, user interactions, API mock |
| Scripts | `scripts/*.test.ts` | Deploy config, runtime config, npm command helpers |

### CDK Assertion Tests (`infrastructure/test/`)

Use `@aws-cdk-lib/assertions` to verify stack resources:

- IAM invariants (no `*` resources, correct trust policies)
- Resource existence (Lambda, API routes, DynamoDB table)
- Permissions (table grants, SSM access, boundary attachment)
- Outputs (required stack outputs exist)

```typescript
import { Template } from '@aws-cdk-lib/assertions';

const template = Template.fromStack(stack);
template.hasResourceProperties('AWS::Lambda::Function', { ... });
template.hasResourceProperties('AWS::IAM::Role', { ... });
```

### Test Patterns

#### Mocking DynamoDB (Backend)

```typescript
import { vi } from 'vitest';

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { send: vi.fn() },
  GetCommand: vi.fn(),
  QueryCommand: vi.fn(),
  // ...
}));
```

#### Mocking API Calls (Frontend)

```typescript
vi.mock('../api', () => ({
  getCurrentWeek: vi.fn(),
  submitPicks: vi.fn(),
}));
```

#### Testing Components

Use `@testing-library/react`. Examples: `GameCard.test.tsx`, `WeekView.test.tsx`.

```typescript
import { render, screen } from '@testing-library/react';

it('displays the game title', () => {
  render(<GameCard game={mockGame} />);
  expect(screen.getByText(' Chiefs @ Bills')).toBeInTheDocument();
});
```

#### Testing API Gateway Event Parsing

Mock the event shape from API Gateway HTTP API:

```typescript
const mockEvent = {
  requestContext: {
    authorizer: { jwt: { claims: { sub: 'player-1', email: 'test@test.com' } } },
  },
  body: JSON.stringify({ gameId: 'g1', pickedTeam: 'KC' }),
};
```

## What to Test Per Layer

- **Shared types:** Not directly — test via consumers
- **DynamoDB helpers:** Key construction correctness, edge cases
- **Lambda handlers:** Happy path, error cases (not found, unauthorized, validation), DynamoDB mock
- **CDK:** Resource existence, IAM invariants, no wildcard resources, authorizer on routes
- **Frontend components:** Rendering with props, user interactions, loading/error states
- **Scripts:** Config generation, deployment order, npm command helpers
