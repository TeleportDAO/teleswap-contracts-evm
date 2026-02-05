# Feature: [Name]

## Table of Contents
- [Problem](#problem)
- [Solution](#solution)
- [Key Design Decisions](#key-design-decisions)
- [Implementation](#implementation)
- [Testing](#testing)
- [Phases](#phases)
- [Limitations](#limitations)
- [Changelog](#changelog)

## Problem

What problem does this solve? Why does it matter?

```
CURRENT STATE
─────────────
├── Step 1: What happens now
├── Step 2: The issue
└── Result: Why this is a problem
```

```
GOAL STATE
──────────
├── Step 1: What should happen
├── Step 2: The improvement
└── Result: Why this is better
```

## Solution

Brief description of the approach.

### Flow

```
STEP 1: [Action]
├── Input:  What goes in
├── Process: What happens
└── Output: What comes out

STEP 2: [Action]
├── Input:  ...
└── Output: ...
```

## Key Design Decisions

| Decision | Choice | Rationale | Prevents |
|----------|--------|-----------|----------|
| Decision 1 | What was chosen | Why | What it avoids |
| Decision 2 | What was chosen | Why | What it avoids |

### Security Properties

| # | Verification | What It Prevents | Status |
|---|--------------|------------------|--------|
| 1 | What is checked | Attack prevented | Done |
| 2 | What is checked | Attack prevented | Pending |

## Implementation

### Files

```
project-root/
├── src/
│   ├── feature/
│   │   ├── index.ts
│   │   └── types.ts
│   └── contracts/
│       └── Feature.sol
├── scripts/
│   └── feature/
│       └── run.ts
└── test/
    └── feature.test.ts
```

### Types

```typescript
interface FeatureConfig {
  id: string;
  enabled: boolean;
}
```

### Commands

```bash
# Build
npm run feature:build

# Run
npm run feature:run

# Deploy
npm run feature:deploy --network <network>
```

### Performance

| Metric | Value |
|--------|-------|
| Execution time | ~X seconds |
| Gas cost | ~X gas |

### Deployments

| Network | Contract | Address |
|---------|----------|---------|
| mainnet | Feature | `0x...` |

## Testing

### Prerequisites

- Node.js v18+
- Docker running

```bash
cp .env.example .env
docker-compose up -d
```

### Unit Tests

```bash
npm run test:unit -- --grep "feature"
```

### Integration Tests

```bash
# 1. Setup
npm run feature:setup

# 2. Run
npm run feature:run

# 3. Verify
npm run feature:verify
```

### Security Tests

| Scenario | Action | Result |
|----------|--------|--------|
| Attack 1 | What was tried | Fails because X |
| Attack 2 | What was tried | Fails because Y |

## Phases

### Phase 1: Foundation [done]
- [x] Task 1
- [x] Task 2

### Phase 2: Core [in-progress]
- [x] Task 1
- [ ] Task 2

### Phase 3: Production [pending]
- [ ] Task 1
- [ ] Task 2

## Limitations

- **Limitation 1** — explanation
- **Limitation 2** — explanation

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| YYYY-MM-DD | 0.1.0 | Initial design |
| YYYY-MM-DD | 1.0.0 | First release |
