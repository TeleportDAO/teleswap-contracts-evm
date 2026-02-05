# Feature: TST Staking

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

| Aspect | Description |
|--------|-------------|
| What is the problem? | There is no utility for TST, and we are unable to encourage users to hold it long-term. |
| What do we want to achieve? | Create utility for TST by enabling users to stake and earn fees from Lockers. Provide an easy way for users to stake their TST directly from Ethereum. |
| Main benefit for users | Users earn additional rewards on top of their TST holdings by receiving a share of Locker fees from every wrap and unwrap request. |
| Main benefit for company | Aligns incentives between TST holders and protocol success — stakers benefit when Lockers process more volume. |

```
CURRENT STATE
─────────────
├── Step 1: User holds TST tokens
├── Step 2: TST has no utility beyond speculation
└── Result: No incentive to hold TST, high circulating supply
```

```
GOAL STATE
──────────
├── Step 1: User stakes TST for a specific Locker
├── Step 2: User earns share of Locker fees (TeleBTC, RUNE, etc.)
└── Result: TST has utility, reduced circulating supply, aligned incentives
```

## Solution

Users stake TST for a specific Locker and earn a `stakingPercentage` of the Locker's fee. Reward token depends on Locker type (BTC Locker → TeleBTC, RUNE Locker → RUNE). Stakers receive veTST (non-transferable) for governance voting.

### Flow

```
STEP 1: Register Locker (Owner)
├── Input:  locker address, stakingPercentage, rewardToken, stakingPeriod
├── Process: Store staking configuration for locker
└── Output: Locker enabled for staking

STEP 2: Stake TST (User)
├── Input:  locker address, TST amount, user address
├── Process: Transfer TST, mint veTST, set unstakingTime, update initRewardPerToken
└── Output: User has staking position, receives veTST

STEP 3: Deposit Reward (LockersManager)
├── Input:  locker address, reward amount
├── Process: If no stakers → send all rewards to Locker
├── Process: Else split reward (stakingPercentage to stakers, rest to Locker)
├── Process: Update currentRewardPerToken += (reward * PRECISION) / totalStakedAmount
└── Output: Rewards distributed proportionally to all current stakers (or to Locker if none)

STEP 4: Claim Reward (User)
├── Input:  locker address, user address
├── Process: Calculate: reward = stakedAmount * (currentRewardPerToken - initRewardPerToken) / PRECISION
├── Process: Transfer reward tokens to user
└── Output: User receives accumulated rewards

STEP 5: Unstake TST (User)
├── Input:  locker address, user address
├── Process: Verify stakingPeriod elapsed, claim remaining rewards, burn veTST
├── Process: Transfer TST back to user, delete staking position
└── Output: User receives TST + final rewards
```

### Cross-Chain Staking Flow

```
STEP 1: User on Ethereum
├── Input:  TST on Ethereum
├── Process: Send TST via LayerZero OFT to Polygon with payload (locker, user)
└── Output: TST arrives on Polygon

STEP 2: OFT Receiver (Polygon)
├── Input:  onOFTReceived callback with amount and payload
├── Process: Decode payload, call stake(locker, amount, user)
└── Output: User has staking position on Polygon, veTST minted to user
```

## Key Design Decisions

| Decision | Choice | Rationale | Prevents |
|----------|--------|-----------|----------|
| Reward Distribution | Pro-rata based on stake at time of deposit | Fair distribution, no retroactive rewards | Late stakers claiming old rewards |
| veTST Non-transferable | Override _transfer to revert | Governance power tied to actual stakers | Vote buying/selling |
| Full Unstake Only | No partial unstake | Simplifies accounting and prevents gaming | Complexity in reward calculation |
| Controller Pattern | Controllers can only stake on behalf of users (not claim/unstake) | Enables cross-chain staking while ensuring only users control their funds | Controllers stealing rewards or unstaking without user consent |
| Staking Period Reset | Timer resets on additional stake | Prevents gaming with small top-ups | Users circumventing lockup |
| Precision Constant | 1e27 for reward calculations | Prevents precision loss in division | Rounding errors accumulating |

### Security Properties

| # | Verification | What It Prevents | Status |
|---|--------------|------------------|--------|
| 1 | ReentrancyGuard on all state-changing functions | Reentrancy attacks on stake/unstake/claim | Done |
| 2 | Pausable by owner | Emergency stop for all operations | Done |
| 3 | Controller can only stake, not claim or unstake | Malicious controller stealing rewards or funds | Done |
| 4 | stakingPeriod enforced on unstake | Early withdrawal before lockup ends | Done |
| 5 | Locker must be registered before staking | Staking to non-existent/malicious lockers | Done |
| 6 | SafeERC20 for all token transfers | Failed transfer not detected | Done |
| 7 | If no stakers, rewards go to locker | Division by zero in reward calculation | Done |

## Implementation

### Files

```
contracts/
└── staking/
    ├── TstStakingLogic.sol      # Main staking logic
    ├── TstStakingProxy.sol      # Transparent upgradeable proxy
    ├── TstStakingStorage.sol    # Storage layout
    └── interfaces/
        └── ITstStaking.sol      # Interface and structs
```

### Types

```solidity
struct StakingPosition {
    uint stakedAmount;          // Amount of TST staked
    uint unstakedAmount;        // (unused in current implementation)
    uint unstakingTime;         // Timestamp when user can unstake
    uint claimedReward;         // Total rewards claimed so far
    uint initRewardPerToken;    // Snapshot of currentRewardPerToken at stake time
    address controller;         // Controller address (for cross-chain staking)
}

struct StakingInfo {
    uint stakingPercentage;     // Percentage of fees to stakers (basis points, max 10000)
    address rewardToken;        // Token used for rewards (TeleBTC, RUNE, etc.)
    uint totalStakedAmount;     // Total TST staked for this locker
    uint totalReward;           // Total rewards deposited
    uint totalClaimedReward;    // Total rewards claimed by users
    uint currentRewardPerToken; // Accumulated reward per token (scaled by PRECISION)
    uint stakingPeriod;         // Lock duration in seconds
}
```

### Constants

```solidity
uint constant MAX_STAKING_PERCENTAGE = 10000;  // 100% in basis points
uint constant PERCISION = 1e27;                // Precision for reward calculations
```

### Key Functions

| Function | Access | Description |
|----------|--------|-------------|
| `initialize(address _TST)` | Once | Initialize contract with TST address |
| `registerLocker(...)` | Owner | Register locker for staking |
| `updateRegisteredLocker(...)` | Owner | Update staking percentage and period |
| `addController(address)` | Owner | Add controller for cross-chain staking |
| `removeController(address)` | Owner | Remove controller |
| `stake(address, uint, address)` | Public | Stake TST for a locker |
| `unstake(address, address)` | Public | Unstake TST (after period) |
| `claimReward(address, address)` | Public | Claim accumulated rewards |
| `depositReward(address, uint)` | Public | Deposit rewards (called by LockersManager) |
| `onOFTReceived(...)` | Public | LayerZero OFT callback for cross-chain staking |
| `pause() / unpause()` | Owner | Emergency pause/unpause |

### Reward Calculation

```
When staking additional TST:
initRewardPerToken = (stakedAmount * initRewardPerToken + currentRewardPerToken * newAmount)
                     / (stakedAmount + newAmount)

When depositing rewards:
currentRewardPerToken += (PRECISION * rewardAmount) / totalStakedAmount

When claiming rewards:
totalReward = stakedAmount * (currentRewardPerToken - initRewardPerToken) / PRECISION
unclaimedReward = totalReward - claimedReward
```

### APY Formula

```
APY = (365 days * totalReward * rewardPrice) / ((now - startTime) * totalStakedAmount * tstPrice)
```

### Commands

```bash
# Compile
npx hardhat compile

# Test
npx hardhat test test/staking.test.ts

# Deploy
npx hardhat run scripts/staking/deploy.ts --network <network>
```

### Performance

| Metric | Value |
|--------|-------|
| stake() gas | ~150,000 gas |
| unstake() gas | ~100,000 gas |
| claimReward() gas | ~80,000 gas |
| depositReward() gas | ~100,000 gas |

### Deployments

| Network | Contract | Address |
|---------|----------|---------|
| Polygon | TstStakingProxy | `0x19361d42166a1BB7104b3AAF3C00bF71D8aa46e2` |
| Polygon | TstStakingLogic | `0xe4B5587834596aa0315dACb0Ad4567a868dAEfa4` |

## Testing

### Prerequisites

- Node.js v18+
- Hardhat configured

```bash
cp .env.example .env
npm install
```

### Unit Tests

```bash
npx hardhat test --grep "TstStaking"
```

### Integration Tests

```bash
# 1. Deploy to testnet
npx hardhat run scripts/staking/deploy.ts --network mumbai

# 2. Register a locker
npx hardhat run scripts/staking/registerLocker.ts --network mumbai

# 3. Test staking flow
npx hardhat run scripts/staking/testStake.ts --network mumbai
```

### Security Tests

| Scenario | Action | Result |
|----------|--------|--------|
| Reentrancy on stake | Call stake from malicious contract | Fails due to ReentrancyGuard |
| Reentrancy on claim | Call claimReward from malicious contract | Fails due to ReentrancyGuard |
| Early unstake | Attempt unstake before stakingPeriod | Reverts: "staking period not over" |
| Unregistered locker | Attempt to stake for unregistered locker | Reverts: "locker not registered" |
| Transfer veTST | Attempt to transfer veTST | Reverts: "transfers not allowed" |
| Non-controller staking for others | Non-controller calls stake with different user | Reverts: "not controller" |
| Controller claiming rewards | Controller calls claimReward for user | Reverts: "not controller" |
| Controller unstaking | Controller calls unstake for user | Reverts: "not controller" |
| Deposit with no stakers | depositReward called when totalStakedAmount = 0 | All rewards sent to locker |

## Phases

### Phase 1: Core Implementation [done]
- [x] TstStakingStorage with data structures
- [x] TstStakingLogic with stake/unstake/claim
- [x] TstStakingProxy for upgradeability
- [x] veTST (non-transferable ERC20)
- [x] ReentrancyGuard and Pausable

### Phase 2: Cross-Chain Support [done]
- [x] Controller pattern for delegated staking
- [x] onOFTReceived for LayerZero integration
- [x] Ethereum → Polygon staking flow

### Phase 3: Production [done]
- [x] Owner admin functions (unstakeByOwner, claimRewardByOwner)
- [x] Locker registration and update functions
- [x] Deployment to mainnet

## Limitations

- **No partial unstake** — Users must unstake entire position, cannot withdraw partial amount
- **Staking period resets on additional stake** — Adding more TST resets the lockup timer
- **Cross-chain rewards must be claimed on destination chain** — Cannot claim rewards from Ethereum if staked on Polygon
- **Rewards only for current stakers** — Rewards deposited when no one is staking go directly to the locker
- **Only user can claim/unstake** — Controllers can stake on behalf of users but cannot claim rewards or unstake

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| - | 1.0.0 | Initial implementation with core staking logic |
| - | 1.1.0 | Added cross-chain staking via LayerZero OFT |
| - | 1.2.0 | Added owner admin functions for emergency recovery |
| - | 1.2.1 | Fixed division by zero when no stakers (rewards go to locker) |
