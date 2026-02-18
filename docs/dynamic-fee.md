# Feature: Dynamic Locker Fee

## Table of Contents
- [Problem](#problem)
- [Solution](#solution)
- [Key Design Decisions](#key-design-decisions)
- [Amount Range Strategy](#amount-range-strategy)
- [Implementation](#implementation)
- [BurnRouter Chain ID Gap](#burnrouter-chain-id-gap)
- [Testing](#testing)
- [Phases](#phases)
- [Limitations & Edge Cases](#limitations--edge-cases)
- [Changelog](#changelog)

## Problem

Currently, `lockerPercentageFee` is a single `uint` stored per router contract. Every wrap/unwrap transaction pays the same locker fee regardless of chain, token, third-party integrator, or amount.

```
CURRENT STATE
─────────────
├── CcExchangeRouterStorage:  uint lockerPercentageFee   (one value for ALL wraps)
├── BurnRouterStorage:         uint lockerPercentageFee   (one value for ALL unwraps)
├── Fee calc: lockerFee = inputAmount * lockerPercentageFee / 10000
└── Result: No way to differentiate fees per chain/token/integrator/amount
```

```
GOAL STATE
──────────
├── Each (direction, chain, token, thirdPartyId, amountRange) combo can have its own fee
├── Wrap and unwrap fees are independently configurable
├── If no dynamic fee is set → falls back to existing lockerPercentageFee
└── Result: Granular fee control with backward compatibility
```

**Examples of what we can't do today but want to:**
- Charge 0.2% for TrustWallet (thirdPartyId = 4) but 0.5% for others
- Charge a different fee for USDT.BNB-to-BTC unwraps vs USDT.ETH-to-BTC
- Charge a lower fee for amounts between 1,000–100,000 sats and higher for large amounts
- Set wrap fee to 0.1% while unwrap fee stays at 0.3%

## Solution

Add a **nested mapping** `dynamicLockerFee` to both `CcExchangeRouterStorage` and `BurnRouterStorage`. Each router uses named keys that reflect its own semantics (destination chain for wrap, source chain for unwrap). If the mapping returns 0 (not set), the existing `lockerPercentageFee` is used as the default.

### Flow

```
STEP 1: Owner or admin configures fee tiers and dynamic fees
├── setFeeTierBoundaries([1000, 10000, 100000])  → creates 4 tiers
└── setDynamicLockerFee(chainId, token, [thirdPartyId1, ...], [tierIndex1, ...], [fee1, ...])

STEP 2: Transaction arrives (wrap or unwrap)
├── Input:  teleBtcAmount, chain, token, thirdPartyId
├── Process:
│   ├── Compute tierIndex from teleBtcAmount using tier boundaries
│   ├── fee = dynamicLockerFee[chain][token][thirdPartyId][tierIndex]
│   └── If fee == 0 → fee = lockerPercentageFee (default fallback)
└── Output: lockerFee = teleBtcAmount * fee / 10000

STEP 3: Fee is distributed (unchanged from current logic)
├── If rewardDistributor set and thirdParty == 0 → send to distributor
└── Otherwise → send directly to locker
```

### Lookup Logic (per router)

**CcExchangeRouter (wrap: BTC → EVM)**

```solidity
// destChainId: the final destination chain (e.g., Ethereum=1, BNB=56)
// destToken: the token on the destination chain (bytes32), resolved via
//   bridgeTokenIDMapping[tokenIDs[1]][destRealChainId]
function _getLockerPercentageFee(uint destChainId, bytes32 destToken, uint thirdPartyId, uint amount)
    internal view returns (uint)
{
    uint tierIndex = _getTierIndex(amount);
    uint fee = dynamicLockerFee[destChainId][destToken][thirdPartyId][tierIndex];
    return fee > 0 ? fee : lockerPercentageFee;
}
```

**BurnRouter (unwrap: EVM → BTC)**

```solidity
// sourceChainId: the chain where the user originally initiated (e.g., Ethereum=1)
//   - 0 for direct calls on the intermediary chain itself
//   - passed from PolyConnector for cross-chain unwraps
// sourceToken: the token representation on the SOURCE chain (bytes32), resolved via
//   bridgeTokenMappingUniversal[_tokenSent][arguments.chainId] in PolyConnector.
//   NOT the intermediary chain ERC20 address.
//   - bytes32(0) when called via old functions (defaults to lockerPercentageFee)
//   - actual source token when called via new unwrapWithDynamicFee / swapAndUnwrapWithDynamicFee
function _getLockerPercentageFee(uint sourceChainId, bytes32 sourceToken, uint thirdPartyId, uint amount)
    internal view returns (uint)
{
    uint tierIndex = _getTierIndex(amount);
    uint fee = dynamicLockerFee[sourceChainId][sourceToken][thirdPartyId][tierIndex];
    return fee > 0 ? fee : lockerPercentageFee;
}
```

## Key Design Decisions

| Decision | Choice | Rationale | Prevents |
|----------|--------|-----------|----------|
| Nested mapping (not bytes32 hash) | `mapping(uint => mapping(... => uint))` | Readable key structure; each dimension is explicit and queryable | Opaque keys, impossible to inspect on-chain |
| 0 = not set (use default) | Fee value of 0 triggers fallback to `lockerPercentageFee` | No need for separate "isSet" mapping, minimal storage | Extra SLOAD per lookup |
| Direction via contract | Wrap = CcExchangeRouter, Unwrap = BurnRouter | Each contract already has its own storage; no extra param needed | Overcomplicating the key |
| Different key naming per router | `destChainId`/`destToken` vs `sourceChainId`/`sourceToken` | Reflects actual semantics — wrap goes TO a dest chain, unwrap comes FROM a source chain | Confusing which chain the fee applies to |
| `bytes32` token in both routers | Both use `bytes32` from existing bridge token mappings | Identical mapping shape in both routers; reuses existing config; no new token mappings | Type inconsistency, extra storage |
| Token resolved from bridge mappings | CcExchange: `bridgeTokenIDMapping[tokenIDs[1]][destRealChainId]`, Burn: `bridgeTokenMappingUniversal[_tokenSent][chainId]` | Admin sets fees using the same token values already configured for bridging | Extra mapping to maintain, inconsistency with bridge config |
| Non-breaking changes only | Old functions kept, new V2 functions added | No callers break; gradual migration possible | Deployment coordination issues, downtime |
| Batch setter with arrays | `setDynamicLockerFee(chain, token, thirdPartyIds[], tierIndexes[], fees[])` | One tx to configure multiple thirdParty/tier combos for a (chain, token) pair | Multiple txs for each combo, higher gas overhead |
| Reuse existing admin roles | CcExchange: `acrossAdmin`, Burn: `bitcoinFeeOracle` | No new storage; routine fee adjustments don't require multisig; these addresses are already trusted | Requiring owner (multisig) for every fee change; new role = extra storage |
| Global tier boundaries | One shared `feeTierBoundaries` array for all fee rules | Simple, consistent ranges across rules, ~200 gas per tier | Per-rule boundary storage explosion |
| Fallback to `lockerPercentageFee` | Default when no dynamic fee is set | Backward compatible, zero-config for existing deployments | Breaking existing behavior |

### Security Properties

| # | Verification | What It Prevents | Status |
|---|--------------|------------------|--------|
| 1 | `fee <= MAX_PERCENTAGE_FEE` in setter | Admin accidentally setting fee > 100% | Pending |
| 2 | `onlyOwnerOrAdmin` on fee setters (CcExchange: `acrossAdmin`, Burn: `bitcoinFeeOracle`) | Unauthorized fee changes; admin reuses existing trusted role | Pending |
| 3 | Fallback to default when dynamic fee = 0 | Transactions failing when no dynamic fee configured | Pending |
| 4 | Tier boundaries must be sorted ascending | Incorrect tier assignment from misordered boundaries | Pending |
| 5 | Total fees (locker + protocol + thirdParty + network) < amount | Underflow revert on fee deduction | Pending |
| 6 | Array length equality in batch setter | Mismatched thirdPartyIds/tierIndexes/fees arrays | Pending |

## Amount Range Strategy

The main challenge is mapping a continuous amount to a discrete fee tier efficiently on-chain.

### How It Works (Global Tier Boundaries)

The admin defines a single sorted array of **upper bounds** that is **universal** — the same tier boundaries apply to every token/network/thirdParty combination in that contract. Different combos can have different fee percentages per tier, but they all share the same tier breakpoints.

**Important: tiers are always based on the teleBTC amount.**
- In CcExchangeRouter (wrap): this is `inputAmount` — the BTC amount the user sent, which gets minted 1:1 as teleBTC.
- In BurnRouter (unwrap): this is `_amount` passed to `_getFees` — the teleBTC amount to be burned (after swapping from the input token, if applicable).

This ensures consistent range semantics regardless of direction. Fees are always tiered by "how much teleBTC is flowing through."

**Concrete example:**

```
Admin calls: setFeeTierBoundaries([1000, 10000, 100000])

This creates 4 tiers (same for ALL token/chain/thirdParty combos in this contract):

    teleBTC amount (sats)
    ─────────────────────────────────────────────────────────►
    0          1,000       10,000       100,000
    |           |            |             |
    ├───────────┼────────────┼─────────────┼──────────────►
    │  Tier 0   │   Tier 1   │   Tier 2    │   Tier 3
    │ < 1,000   │ ≥1,000     │ ≥10,000     │ ≥100,000
    │           │ <10,000    │ <100,000    │ (no upper bound)

Rule: the first boundary GREATER THAN the amount determines the tier.
  - amount = 500     → 500 < 1000     → Tier 0
  - amount = 1000    → 1000 < 10000   → Tier 1  (boundary is exclusive)
  - amount = 9999    → 9999 < 10000   → Tier 1
  - amount = 10000   → 10000 < 100000 → Tier 2
  - amount = 500000  → above all      → Tier 3
```

**Setting fees for this example:**

```
Admin wants:
  - TrustWallet (id=4), USDT on BNB, small amounts (tier 1): 0.2% fee
  - TrustWallet (id=4), USDT on BNB, medium amounts (tier 2): 0.15% fee
  - Everything else: use default lockerPercentageFee (e.g., 0.3%)

CcExchangeRouter (wrap):
  destToken = bridgeTokenIDMapping[USDT_TOKEN_ID][56]  // bytes32 USDT representation on BNB
  setDynamicLockerFee(56, destToken, [4, 4], [1, 2], [20, 15])
  // → thirdParty=4, tier 1: 0.2%
  // → thirdParty=4, tier 2: 0.15%
  // Tier 0 and 3: not set → falls back to 0.3% default

BurnRouter (unwrap):
  sourceToken = bridgeTokenMappingUniversal[USDT_BNB][1]  // bytes32 USDT representation on Ethereum
  setDynamicLockerFee(1, sourceToken, [4], [1], [25])
  // → thirdParty=4, tier 1: 0.25% for Ethereum→BTC via TrustWallet
  // Everything else: default
```

### Updating Tier Boundaries

`setFeeTierBoundaries` **replaces the entire array**. You can freely go from 5 boundaries to 3, or from 3 to 7.

```
Example: shrinking from 5 to 3 boundaries

BEFORE:  setFeeTierBoundaries([500, 1000, 5000, 10000, 100000])  → 6 tiers (0–5)
AFTER:   setFeeTierBoundaries([1000, 10000, 100000])              → 4 tiers (0–3)

What happens to existing dynamic fee entries:
  - Entry set for tierIndex=4 (old: 10,000–100,000) → tierIndex 4 no longer exists
    in the new scheme. The entry stays in storage but is unreachable because
    _getTierIndex will never return 4 with only 3 boundaries.
  - Entry set for tierIndex=1 (old: 500–1,000) → tierIndex 1 now means 1,000–10,000.
    The fee that was meant for 500–1,000 is now applied to 1,000–10,000. WRONG.

CONCLUSION: after changing boundaries, admin MUST re-set all dynamic fee entries.
```

**Implementation:**

```solidity
uint[] public feeTierBoundaries;  // sorted upper bounds (exclusive)

function setFeeTierBoundaries(uint[] calldata _boundaries) external onlyOwner {
    // Validate sorted ascending
    for (uint i = 1; i < _boundaries.length; i++) {
        require(_boundaries[i] > _boundaries[i - 1], "boundaries must be sorted ascending");
    }
    feeTierBoundaries = _boundaries;  // replaces entire array
}

function _getTierIndex(uint amount) internal view returns (uint) {
    for (uint i = 0; i < feeTierBoundaries.length; i++) {
        if (amount < feeTierBoundaries[i]) return i;
    }
    return feeTierBoundaries.length;  // last tier (above all boundaries)
}
```

**If no boundaries are set** (empty array), `_getTierIndex` always returns 0. This means the mapping simplifies to `dynamicLockerFee[chain][token][thirdParty][0]` — effectively disabling the amount dimension. Good for initial rollout.

### Why This Approach

| Aspect | Detail |
|--------|--------|
| Universal | One boundary array shared by ALL token/chain/thirdParty combos. No per-rule config. |
| Gas cost | Linear scan over 3–5 boundaries: ~600–1,000 gas. Negligible vs. the SLOAD. |
| Storage | One `uint[]` array per contract. No per-rule storage. |
| Admin UX | Set boundaries once, then set fees by (chain, token, thirdParty, tierIndex). |
| Flexible sizing | Can go from 0 to N boundaries at any time via `setFeeTierBoundaries`. |
| Simplicity | ~5 lines of logic. Easy to audit. |

### Alternatives Considered

**Log-scale buckets (hardcoded):** Zero storage, but inflexible — boundaries can't be changed without contract upgrade. Not recommended unless we're certain about bucket sizes forever.

**Per-rule range arrays:** Maximum flexibility but expensive storage (array per combo), complex admin UX, and higher gas. Overkill for current needs.

## Implementation

### Files

```
contracts/routers/
├── CcExchangeRouterStorage.sol   ← add dynamicLockerFee mapping + feeTierBoundaries
├── CcExchangeRouterLogic.sol     ← modify _mintAndCalculateFees to use _getLockerPercentageFee()
├── BurnRouterStorage.sol         ← add dynamicLockerFee mapping + feeTierBoundaries
├── BurnRouterLogic.sol           ← add new entry points + modify _getFees to use _getLockerPercentageFee()
├── interfaces/
│   ├── ICcExchangeRouter.sol     ← add setter signatures
│   └── IBurnRouter.sol           ← add new function signatures (keep old ones unchanged)
└── chain_connectors/
    ├── PolyConnectorLogic.sol    ← call new BurnRouter functions with fee context + add setBridgeTokenMappingUniversal
    └── interfaces/
        └── IPolyConnector.sol    ← add setBridgeTokenMappingUniversal signature
```

### New Storage

**CcExchangeRouter (wrap: BTC → EVM):**
```solidity
/// @dev Dynamic locker fee for wrap direction
/// destChainId => destToken => thirdPartyId => tierIndex => fee percentage
/// destToken is bytes32 — resolved via bridgeTokenIDMapping[tokenIDs[1]][destRealChainId]
/// Fee of 0 means "not set, use default lockerPercentageFee"
mapping(uint => mapping(bytes32 => mapping(uint => mapping(uint => uint)))) public dynamicLockerFee;

/// @dev Sorted upper bounds for amount tiers (exclusive). Empty = single tier.
uint[] public feeTierBoundaries;

// Admin role: reuses existing `acrossAdmin` (CcExchangeRouterStorageV2) — no new storage.
```

**BurnRouter (unwrap: EVM → BTC):**
```solidity
/// @dev Dynamic locker fee for unwrap direction
/// sourceChainId => sourceToken => thirdPartyId => tierIndex => fee percentage
/// sourceToken is bytes32 — the token representation on the source chain,
/// resolved via bridgeTokenMappingUniversal[_tokenSent][chainId] in PolyConnector.
/// Fee of 0 means "not set, use default lockerPercentageFee"
mapping(uint => mapping(bytes32 => mapping(uint => mapping(uint => uint)))) public dynamicLockerFee;

/// @dev Sorted upper bounds for amount tiers (exclusive). Empty = single tier.
uint[] public feeTierBoundaries;

// Admin role: reuses existing `bitcoinFeeOracle` (BurnRouterStorage) — no new storage.
```

### Zero-Fallback Guarantee

Solidity nested mappings return the **default value (0)** for any key combination that was never explicitly set. This means:

```
dynamicLockerFee[999][bytes32(0xABC)][42][7]  →  0   (if never set)
```

The `_getLockerPercentageFee` function checks `fee > 0 ? fee : lockerPercentageFee`. This guarantees that:
- Any unset combination silently falls back to the default `lockerPercentageFee`
- There is no scenario where an unset mapping entry causes a revert or charges 0 fee
- Even if admin sets boundaries creating tiers 0–3 but only configures tier 1, the other tiers safely use the default
- Even if admin passes wrong chain/token/thirdParty values that don't match any real request, the worst case is the default fee applies

### Events

Both routers emit events for all fee configuration changes (for off-chain monitoring and audit trails):

```solidity
event DynamicLockerFeeSet(uint indexed chainId, bytes32 indexed token, uint[] thirdPartyIds, uint[] tierIndexes, uint[] fees);
event DynamicLockerFeeRemoved(uint indexed chainId, bytes32 indexed token, uint[] thirdPartyIds, uint[] tierIndexes);
event FeeTierBoundariesSet(uint[] boundaries);
```

### New Functions

**CcExchangeRouter** (admin = existing `acrossAdmin`)**:**
```solidity
/// @notice Batch-set dynamic fees for one (chainId, token) pair across multiple
///         thirdParty/tier combos. Arrays must be equal length.
/// @dev Callable by owner OR acrossAdmin.
function setDynamicLockerFee(
    uint _destChainId,
    bytes32 _destToken,
    uint[] calldata _thirdPartyIds,
    uint[] calldata _tierIndexes,
    uint[] calldata _fees
) external onlyOwnerOrAdmin;

function setFeeTierBoundaries(uint[] calldata _boundaries) external onlyOwnerOrAdmin;

function removeDynamicLockerFee(
    uint _destChainId,
    bytes32 _destToken,
    uint[] calldata _thirdPartyIds,
    uint[] calldata _tierIndexes
) external onlyOwnerOrAdmin;

/// @notice View: get effective locker fee for given wrap params
function getEffectiveLockerFee(
    uint _destChainId,
    bytes32 _destToken,
    uint _thirdPartyId,
    uint _amount
) external view returns (uint);
```

**BurnRouter** (admin = existing `bitcoinFeeOracle`)**:**
```solidity
/// @notice Batch-set dynamic fees for one (chainId, token) pair across multiple
///         thirdParty/tier combos. Arrays must be equal length.
/// @dev Callable by owner OR bitcoinFeeOracle.
function setDynamicLockerFee(
    uint _sourceChainId,
    bytes32 _sourceToken,
    uint[] calldata _thirdPartyIds,
    uint[] calldata _tierIndexes,
    uint[] calldata _fees
) external onlyOwnerOrAdmin;

function setFeeTierBoundaries(uint[] calldata _boundaries) external onlyOwnerOrAdmin;

function removeDynamicLockerFee(
    uint _sourceChainId,
    bytes32 _sourceToken,
    uint[] calldata _thirdPartyIds,
    uint[] calldata _tierIndexes
) external onlyOwnerOrAdmin;

/// @notice View: get effective locker fee for given unwrap params
function getEffectiveLockerFee(
    uint _sourceChainId,
    bytes32 _sourceToken,
    uint _thirdPartyId,
    uint _amount
) external view returns (uint);

/// @notice New entry point: unwrap with dynamic fee context
/// Existing unwrap() remains unchanged and uses default lockerPercentageFee
function unwrapWithDynamicFee(
    uint256 _amount,
    bytes memory _userScript,
    ScriptTypes _scriptType,
    bytes calldata _lockerLockingScript,
    uint256 _thirdParty,
    uint _sourceChainId,
    bytes32 _sourceToken
) external returns (uint256 burntAmount);

/// @notice New entry point: swapAndUnwrap with dynamic fee context
/// Existing swapAndUnwrap() remains unchanged and uses default lockerPercentageFee
function swapAndUnwrapWithDynamicFee(
    address _exchangeConnector,
    uint256[] calldata _amounts,
    bool _isFixedToken,
    address[] calldata _path,
    uint256 _deadline,
    bytes memory _userScript,
    ScriptTypes _scriptType,
    bytes calldata _lockerLockingScript,
    uint256 _thirdParty,
    uint _sourceChainId,
    bytes32 _sourceToken
) external payable returns (uint256);
```

### Non-Breaking Change Strategy

**Constraint: no existing function signatures are modified.** Old callers keep working exactly as before.

```
CcExchangeRouter (wrap):
  NO external interface changes needed.
  _mintAndCalculateFees already has access to destRealChainId, tokenIDs[1], thirdParty, inputAmount.
  destToken = bridgeTokenIDMapping[tokenIDs[1]][destRealChainId]  (already computed in wrapAndSwapV2)
  Only internal changes.

BurnRouter (unwrap):
  OLD functions KEPT (unchanged signatures):
  ├── unwrap(amount, script, scriptType, lockerScript, thirdParty)
  │     └── internally calls _unwrap(..., sourceChainId=0, sourceToken=bytes32(0))
  │         └── _getLockerPercentageFee(0, bytes32(0), thirdParty, amount)
  │             └── dynamicLockerFee[0][bytes32(0)][thirdParty][tier]
  │                 └── likely 0 (not set) → falls back to lockerPercentageFee ✓
  │
  └── swapAndUnwrap(connector, amounts, isFixed, path, deadline, script, scriptType, lockerScript, thirdParty)
        └── same: defaults to lockerPercentageFee ✓

  NEW functions ADDED:
  ├── unwrapWithDynamicFee(..., sourceChainId, sourceToken)
  │     └── internally calls _unwrap(..., sourceChainId, sourceToken)
  │         └── _getLockerPercentageFee(sourceChainId, sourceToken, thirdParty, amount)
  │             └── uses dynamic fee if set, else default ✓
  │
  └── swapAndUnwrapWithDynamicFee(..., sourceChainId, sourceToken)
        └── same: uses dynamic fee if set, else default ✓

PolyConnector:
  Updated _swapAndUnwrap() AND _swapAndUnwrapSolana() to call
  swapAndUnwrapWithDynamicFee() instead of swapAndUnwrap().
  Both paths resolve sourceToken via: bridgeTokenMappingUniversal[_tokenSent][arguments.chainId]
  PolyConnector is a proxy — implementation swap is transparent.
  External interface (handleV3AcrossMessage) is unchanged.
  Reuses bridgeTokenMappingUniversal (added in this branch for universal router).
```

### Modified Functions

| Contract | Function | Change |
|----------|----------|--------|
| CcExchangeRouterLogic | `_mintAndCalculateFees` (internal) | Replace `lockerPercentageFee` with `_getLockerPercentageFee(destRealChainId, bridgeTokenIDMapping[tokenIDs[1]][destRealChainId], thirdParty, inputAmount)` |
| BurnRouterLogic | `_unwrap` (internal) | Add `sourceChainId` + `sourceToken` params, pass to `_getFees` |
| BurnRouterLogic | `_getFees` (internal) | Add `sourceChainId` + `sourceToken` params; replace `lockerPercentageFee` with `_getLockerPercentageFee(...)` |
| BurnRouterLogic | `unwrap` (external) | **Signature unchanged** — calls `_unwrap` with `sourceChainId=0, sourceToken=bytes32(0)`. Behavior unchanged by default; admin _can_ override by setting `dynamicLockerFee[0][bytes32(0)][thirdParty][tier]`. |
| BurnRouterLogic | `swapAndUnwrap` (external) | **Signature unchanged** — same as `unwrap`: defaults to `lockerPercentageFee` unless admin explicitly sets fee at key `(0, bytes32(0), ...)`. |
| BurnRouterLogic | **NEW** `unwrapWithDynamicFee` | New function — same as `unwrap` but passes caller-provided `sourceChainId` + `sourceToken` |
| BurnRouterLogic | **NEW** `swapAndUnwrapWithDynamicFee` | New function — same as `swapAndUnwrap` but passes caller-provided `sourceChainId` + `sourceToken` |
| PolyConnectorLogic | `_swapAndUnwrap` (internal) | Call `swapAndUnwrapWithDynamicFee` instead of `swapAndUnwrap`, passing `arguments.chainId` + `bridgeTokenMappingUniversal[_tokenSent][arguments.chainId]` |
| PolyConnectorLogic | `_swapAndUnwrapSolana` (internal) | Same change as `_swapAndUnwrap` — call `swapAndUnwrapWithDynamicFee` instead of `swapAndUnwrap`, passing `arguments.chainId` + `bridgeTokenMappingUniversal[_tokenSent][arguments.chainId]` |

### Parameters per Router

| Parameter | CcExchangeRouter (wrap) | BurnRouter (unwrap) |
|-----------|------------------------|---------------------|
| **chain** | `destRealChainId` — the final destination chain the user wants tokens on | `sourceChainId` — the chain where the user originally initiated the unwrap (0 = direct call on intermediary chain, 0 = old functions) |
| **token** | `destToken` (`bytes32`) — `bridgeTokenIDMapping[tokenIDs[1]][destRealChainId]` | `sourceToken` (`bytes32`) — `bridgeTokenMappingUniversal[_tokenSent][chainId]` in PolyConnector (`bytes32(0)` = old functions) |
| **thirdPartyId** | `extendedRequest.thirdParty` | `_thirdParty` param |
| **amount (for tier)** | `inputAmount` — the BTC/teleBTC amount in sats (minted 1:1 as teleBTC) | `_amount` — the teleBTC amount to be burned (after swap, if applicable) |

### Token Resolution: `bytes32` from Existing Bridge Mappings

Both routers use `bytes32` for the token dimension, resolved from **existing bridge token mappings** that are already configured for cross-chain routing. This means:
- The admin sets dynamic fees using the **same token values** already in the bridge config
- No new token ID system or extra mappings needed
- **Identical mapping shape** in both routers: `mapping(uint => mapping(bytes32 => mapping(uint => mapping(uint => uint))))`

| Router | Bridge mapping used | Lookup |
|--------|-------------------|--------|
| CcExchangeRouter | `bridgeTokenIDMapping` (CcExchangeRouterStorageV2, line 70) | `bridgeTokenIDMapping[tokenIDs[1]][destRealChainId]` → `bytes32` dest token |
| BurnRouter | `bridgeTokenMappingUniversal` (PolyConnectorStorage) | `bridgeTokenMappingUniversal[_tokenSent][arguments.chainId]` → `bytes32` source token |

**Why not use intermediary chain addresses?** The `_inputToken` in BurnRouter's `_unwrap()` is the ERC20 address **on the intermediary chain** (e.g., USDT on BNB), not the source chain. The admin would be setting fees by BNB token addresses even for Ethereum users — confusing and incorrect.

**How `sourceToken` is provided in BurnRouter:**
- **Old functions** (`unwrap`, `swapAndUnwrap`): not available → defaults to `bytes32(0)` → falls back to `lockerPercentageFee`
- **New functions** (`unwrapWithDynamicFee`, `swapAndUnwrapWithDynamicFee`): caller passes `sourceToken` explicitly
- **PolyConnector**: resolves via `bridgeTokenMappingUniversal[_tokenSent][arguments.chainId]` (added in this branch for universal router, reused here)

### PolyConnector `bridgeTokenMappingUniversal` Setup

The `bridgeTokenMappingUniversal` mapping was added to PolyConnectorStorage in this branch for the universal router feature. Dynamic fees for cross-chain unwraps depend on this mapping being populated — if it's empty, `sourceToken` resolves to `bytes32(0)` and the fee lookup falls back to `lockerPercentageFee` (safe, but no dynamic fee differentiation).

**Setter** (added to PolyConnectorLogic, placed after `setBridgeTokenMapping`):

```solidity
/// @notice Setter for bridge token mapping universal
/// @param _sourceToken Address of the token on the current chain
/// @param _destinationChainId The ID of the destination chain
/// @param _destinationToken Address of the token on the target chain
function setBridgeTokenMappingUniversal(
    address _sourceToken,
    uint256 _destinationChainId,
    bytes32 _destinationToken
) external override onlyOwner {
    bridgeTokenMappingUniversal[_sourceToken][_destinationChainId] = _destinationToken;
}
```

**Admin must populate** this mapping for all supported token/chain combinations before dynamic fees can take effect for PolyConnector-routed unwraps. Example:

```
// On BNB (intermediary chain), map USDT_BNB + Ethereum(1) → bytes32 USDT representation on Ethereum
setBridgeTokenMappingUniversal(USDT_BNB_ADDRESS, 1, USDT_ETH_BYTES32)
```

### Gas Impact

| Operation | Estimated Additional Cost |
|-----------|--------------------------|
| `_getLockerPercentageFee` lookup (no tiers) | ~2,400 gas (4 nested SLOADs for mapping) |
| `_getLockerPercentageFee` lookup (3 tiers) | ~3,000 gas (3 comparisons + 4 nested SLOADs) |
| `setDynamicLockerFee` (admin, per entry) | ~22,000 gas (SSTORE per array element) |
| `setFeeTierBoundaries` (admin) | ~22,000 gas per boundary |

Note: nested mappings cost slightly more than a flat `mapping(bytes32 => uint)` due to multiple hash computations, but the readability tradeoff is worth it. The extra ~1,600 gas is negligible relative to the total transaction cost.

## BurnRouter Chain ID & Token Gap

**Current state:** BurnRouter's `_getFees()` receives `(amount, minOutput, lockerScript, thirdParty)` — **no chain ID, no source token**. When a user from Ethereum unwraps via PolyConnector on BNB, PolyConnector has `arguments.chainId` (= Ethereum) and `_tokenSent` (token on BNB) but does **not** pass either to BurnRouter.

**Solution: new non-breaking entry points.**

```
CURRENT (unchanged — keeps working with default fee):
─────────────────────────────────────────────────────
PolyConnector._swapAndUnwrap()
  └── BurnRouter.swapAndUnwrap(connector, amounts, isFixed, path, deadline, script, scriptType, lockerScript, thirdParty)
        └── _unwrap(..., sourceChainId=0, sourceToken=bytes32(0))
              └── _getFees(amount, ..., sourceChainId=0, sourceToken=bytes32(0))
                    └── dynamicLockerFee[0][bytes32(0)][thirdParty][tier] → 0 → lockerPercentageFee ✓

AFTER POLYCONNECTOR UPGRADE (uses dynamic fee):
───────────────────────────────────────────────
PolyConnector._swapAndUnwrap()          ← BTC unwraps
PolyConnector._swapAndUnwrapSolana()    ← Solana unwraps (same BurnRouter call)
  │  sourceToken = bridgeTokenMappingUniversal[_tokenSent][arguments.chainId]
  └── BurnRouter.swapAndUnwrapWithDynamicFee(..., thirdParty, arguments.chainId, sourceToken)  ← NEW FUNCTION
        └── _unwrap(..., sourceChainId, sourceToken)
              └── _getFees(amount, ..., sourceChainId, sourceToken)
                    └── dynamicLockerFee[sourceChainId][sourceToken][thirdParty][tier]
                        → if set: dynamic fee ✓
                        → if 0: lockerPercentageFee ✓

Note: _swapAndUnwrapRune() calls RuneRouter (not BurnRouter) — out of scope.
```

**Where PolyConnector gets the data:**
- `sourceChainId`: already available as `arguments.chainId` from the Across message
- `sourceToken`: resolved via `bridgeTokenMappingUniversal[_tokenSent][arguments.chainId]` — maps the intermediary chain ERC20 address + source chain ID to the `bytes32` token representation on the source chain. This mapping was added in this branch for universal router and is reused here. Admin must populate it via `setBridgeTokenMappingUniversal()` before dynamic fees can take effect for cross-chain unwraps (see [PolyConnector](#polyconnector-bridgetokenmappinguniversal-setup)).

**For direct calls** (user on BNB calling `unwrap()` directly): uses the old function → `sourceChainId=0, sourceToken=bytes32(0)` → default fee. If the admin wants to set a dynamic fee for direct callers too, they can set `dynamicLockerFee[0][bytes32(0)][thirdParty][tier]`.

## Testing

### Unit Tests

```
test/dynamic-fee/
├── dynamicLockerFee.test.ts        ← core mapping + tier logic
├── ccExchangeDynamicFee.test.ts    ← wrap flow with dynamic fees
└── burnRouterDynamicFee.test.ts    ← unwrap flow with dynamic fees
```

### Test Scenarios

| Scenario | Setup | Expected Result |
|----------|-------|-----------------|
| No dynamic fee set | Default only | Uses `lockerPercentageFee` |
| Exact match set | Set fee for (chain=56, token=USDT, thirdParty=4, tier=1) | Uses dynamic fee |
| Different tiers | Set different fees for tier 0, 1, 2 | Fee changes based on amount |
| Partial config | Set dynamic fee for tier 1 only | Tier 0 and 2 use default |
| Wrap vs unwrap | Different dynamic fees per router | Each router uses its own mapping |
| Boundary update | Change tier boundaries | New tier assignment, old fee entries may need updating |
| Fee = MAX_PERCENTAGE_FEE | Set fee to 10000 | Accepted (100%) |
| Fee > MAX_PERCENTAGE_FEE | Set fee to 10001 | Reverts |
| Empty boundaries | No boundaries set | tierIndex always 0, single-tier mode |
| Old `unwrap()` still works | No dynamic fee set | Uses `lockerPercentageFee` (backward compat) |
| `unwrapWithDynamicFee` with sourceChainId=0 | Direct call, fee set for key (0, bytes32(0), thirdParty, tier) | Uses dynamic fee |
| `swapAndUnwrapWithDynamicFee` via PolyConnector | sourceChainId=1, sourceToken=USDT_ON_ETH | Uses fee for sourceChainId=1 |
| Old `swapAndUnwrap()` after upgrade | No change to caller | Still uses `lockerPercentageFee` |
| `_swapAndUnwrapSolana` via PolyConnector | Solana unwrap with sourceChainId + sourceToken | Uses dynamic fee (same as `_swapAndUnwrap` path) |
| Amount on exact boundary | amount = 10000, boundary = [10000] | Falls into tier 1 (boundary is exclusive upper bound) |

### Security Tests

| Scenario | Action | Result |
|----------|--------|--------|
| Non-owner/non-admin sets fee | Call `setDynamicLockerFee` from unauthorized address | Reverts with access control error |
| Admin can set fees | CcExchange: call from `acrossAdmin`; Burn: call from `bitcoinFeeOracle` | Succeeds |
| Unsorted boundaries | Call `setFeeTierBoundaries([100, 50, 200])` | Reverts with validation error |
| Fee overflow | Set fee close to MAX and large amount | No overflow (uint256 arithmetic) |
| Zero amount | Wrap/unwrap with 0 amount | Handled by existing checks upstream |
| Total fees > amount | Dynamic fee set very high + protocol fee + network fee | Underflow revert (safe, but bad UX — see edge cases) |

## Phases

### Phase 1: Design & Documentation [in-progress]
- [x] Analyze current fee implementation
- [x] Design dynamic fee mapping structure
- [x] Choose amount range strategy (Global Tier Boundaries)
- [x] Write feature doc
- [ ] Review and finalize

### Phase 2: Core Implementation [pending]
- [ ] Add storage variables to new storage version contracts
- [ ] Implement `_getLockerPercentageFee()` and `_getTierIndex()` helper functions
- [ ] Add batch setters (`setDynamicLockerFee`, `setFeeTierBoundaries`, `removeDynamicLockerFee`) with `onlyOwnerOrAdmin` access (CcExchange: `acrossAdmin`, Burn: `bitcoinFeeOracle`)
- [ ] Add `getEffectiveLockerFee` view function
- [ ] Modify `_mintAndCalculateFees` in CcExchangeRouterLogic (internal only, no interface change)
- [ ] Add `unwrapWithDynamicFee` and `swapAndUnwrapWithDynamicFee` to BurnRouterLogic
- [ ] Modify `_unwrap` and `_getFees` internals to accept and use fee context
- [ ] Keep old `unwrap` and `swapAndUnwrap` unchanged (pass default context)
- [ ] Update PolyConnectorLogic `_swapAndUnwrap` to call new BurnRouter functions (using `bridgeTokenMappingUniversal`)
- [ ] Update PolyConnectorLogic `_swapAndUnwrapSolana` to call new BurnRouter functions (same change as `_swapAndUnwrap`)
- [ ] Add `setBridgeTokenMappingUniversal` to PolyConnectorLogic (after `setBridgeTokenMapping`) and IPolyConnector
- [ ] Add events (`DynamicLockerFeeSet`, `DynamicLockerFeeRemoved`, `FeeTierBoundariesSet`) to both routers
- [ ] Update interfaces (add new, don't modify existing)

### Phase 3: Testing [pending]
- [ ] Unit tests for tier computation
- [ ] Unit tests for fee lookup with fallback
- [ ] Integration tests for wrap flow with dynamic fees
- [ ] Integration tests for unwrap flow with dynamic fees
- [ ] Integration tests for PolyConnector → BurnRouter with sourceChainId
- [ ] Edge case and security tests

### Phase 4: Deployment [pending]

**Deployment order is critical.** BurnRouter must be upgraded before PolyConnector. If PolyConnector is upgraded first, it will call `swapAndUnwrapWithDynamicFee()` which doesn't exist on the old BurnRouter — reverting ALL cross-chain unwraps until BurnRouter catches up. Ideally, BurnRouter + PolyConnector upgrades should be batched in the same multisig transaction.

- [ ] Deploy upgraded BurnRouter implementation to testnet
- [ ] Deploy upgraded CcExchangeRouter implementation to testnet
- [ ] Deploy upgraded PolyConnector implementation to testnet (AFTER BurnRouter)
- [ ] Populate `bridgeTokenMappingUniversal` via `setBridgeTokenMappingUniversal()` for all supported token/chain combos
- [ ] Configure initial dynamic fees and tier boundaries
- [ ] Verify backward compatibility (no dynamic fees set = same behavior)
- [ ] Deploy to mainnet (same order: BurnRouter → CcExchangeRouter → PolyConnector, ideally in same multisig batch)

## Limitations & Edge Cases

### Limitations

- **0% dynamic fee not possible** — A value of 0 means "not set, use default". To charge 0% fee for a specific combo, a sentinel value (e.g., `1` = 0.01% as minimum) or a separate `isDynamicFeeSet` mapping would be needed.

- **Changing tier boundaries invalidates existing entries** — If boundaries change, the tierIndex for a given amount changes, so previously set fees may no longer apply to the intended range. Admin must re-set all dynamic fee entries after boundary changes (see [Updating Tier Boundaries](#updating-tier-boundaries)).

- **No wildcard support** — Each (chain, token, thirdParty, tier) combo must be set individually. No "all chains" or "all tokens" shortcut. If you want the same fee for 10 chains, you set it 10 times.

- **CcTransferRouter not covered** — This design targets CcExchangeRouter and BurnRouter only. CcTransferRouter also has `lockerPercentageFee` but is out of scope for this phase.

- **Fee change affects pending wrap requests (BTC → EVM)** — In CcExchangeRouter, the user sends BTC first, then a teleporter calls `wrapAndSwapV2` later to execute the request. The fee is calculated at **execution time**, NOT when the user sent BTC. If admin changes `dynamicLockerFee` (or `lockerPercentageFee`) between the BTC send and execution, the user pays the new fee, not the fee they expected. This is a known trade-off — there is no practical way to lock the fee at BTC-send time since the Solidity contract doesn't know about the request until execution.

### Non-Breaking Upgrade Notes

- **CcExchangeRouter**: Zero interface changes. Token resolved internally via `bridgeTokenIDMapping[tokenIDs[1]][destRealChainId]` (already available). Only internal `_mintAndCalculateFees` logic changes. Fully transparent upgrade.

- **BurnRouter**: Old `unwrap()` and `swapAndUnwrap()` are **untouched**. They keep the same function selectors. Existing callers (frontend, PolyConnector, integrators) continue to work and get `lockerPercentageFee` as before. New callers opt into dynamic fees by calling `unwrapWithDynamicFee()` / `swapAndUnwrapWithDynamicFee()`.

- **PolyConnector**: Internal `_swapAndUnwrap` and `_swapAndUnwrapSolana` updated to call the new BurnRouter function. PolyConnector is a proxy — implementation swap is transparent. Its external interface (`handleV3AcrossMessage`) is unchanged. Source token resolved via `bridgeTokenMappingUniversal` (added in this branch for universal router, reused here). Admin must populate the mapping via `setBridgeTokenMappingUniversal()` for all supported token/chain combinations before enabling dynamic fees.

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-02-18 | 0.1.0 | Initial design doc |
| 2026-02-18 | 0.2.0 | Nested mapping for readability, distinct naming per router, BurnRouter chain ID gap analysis, edge cases |
| 2026-02-18 | 0.3.0 | Universal tiers clarification, boundary update mechanics, teleBTC amount for all tiers, zero-fallback guarantee |
| 2026-02-18 | 0.4.0 | Non-breaking strategy (new functions instead of modifying old) |
| 2026-02-18 | 0.5.0 | bytes32 sourceToken via bridgeTokenMappingUniversal (reuses mapping added in this branch for universal router), added universal router vars to PolyConnectorStorage |
| 2026-02-18 | 0.6.0 | Unified bytes32 token type in both routers — CcExchangeRouter uses bridgeTokenIDMapping, BurnRouter uses bridgeTokenMappingUniversal. Identical mapping shapes. |
| 2026-02-18 | 0.7.0 | Review fixes: added `_swapAndUnwrapSolana` to PolyConnector changes, renamed `_getLockerFee` → `_getLockerPercentageFee`, added deployment order (BurnRouter before PolyConnector), added admin events, added `setBridgeTokenMappingUniversal` setter, clarified old function behavior overridability, fixed "no new storage" inconsistency. |
| 2026-02-18 | 0.8.0 | Batch setter: `setDynamicLockerFee` now accepts arrays `(thirdPartyIds[], tierIndexes[], fees[])` for one `(chainId, token)` pair. Reuses existing admin roles (`acrossAdmin` for CcExchange, `bitcoinFeeOracle` for Burn) — no new storage. Updated `removeDynamicLockerFee` to batch arrays too. |
