## **Bitcoin → DestChain**

Sections A to D and their sub-sections (e.g. D1, …) can be used as the different states of a “wrap and swap universal” transaction.

### **A: Happy Path**

1. Mint TeleBTC
2. Swap TeleBTC → intermediaryToken (on Polygon).
3. Bridge intermediaryToken → destChain. Here we send the intermediaryToken to the TeleSwap contract on the destChain along with a message so that contract can swap it to the destToken and send it to the correct address or refund it if necessary.
4. Swap intermediaryToken → destToken (on destChain).
5. Deliver destToken to user.

Sequence Diagram:

```mermaid
sequenceDiagram
  title **Bitcoin → DestChain** Transaction Flow (Happy Path)
  participant Teleporter
  participant CcExchangeRouter as CcExchangeRouter<br/>(Polygon/Bsc)
  participant LockersManager as LockersManager
  participant DexConnector as DexConnector<br/>(Polygon/Bsc)
  participant Across as Across Bridge
  participant EthConnector as EthConnector<br/>(Ethereum/Solana)
  participant DexConnectorDest as DexConnector<br/>(Ethereum/Solana)
  participant User as User

  Teleporter->>CcExchangeRouter: wrapAndSwapUniversal()
  Note over CcExchangeRouter: Validates request,<br/>extracts txId
  CcExchangeRouter->>LockersManager: mint(TeleBTC)
  Note over CcExchangeRouter: Calculates fees<br/>(network, protocol,<br/>thirdParty, locker)
  CcExchangeRouter->>DexConnector: swap(TeleBTC → Intermediary Token)
  DexConnector-->>CcExchangeRouter: Swap successful
  CcExchangeRouter-->>CcExchangeRouter: event: NewWrapAndSwapUniversal
  CcExchangeRouter->>Across: deposit/depositV3(intermediaryToken + message)
  Note over Across: Cross-chain bridge<br/>to destination chain
  Across->>EthConnector: handleV3AcrossMessage(intermediaryToken, message)
  EthConnector-->>EthConnector: event: MsgReceived("wrapAndSwapUniversal")
  Note over EthConnector: Decodes message,<br/>validates path & amounts
  EthConnector->>DexConnectorDest: swap(Intermediary Token → Dest Token)
  DexConnectorDest-->>EthConnector: Swap successful
  EthConnector-->>EthConnector: event: WrappedAndSwappedToDestChain
  EthConnector->>User: safeTransfer(destToken, amount)
```

### **B: Sad Path (**TeleBTC → intermediaryToken swap **fails on the intermediary chain)**

Refund BTC to user through the refund admin (following our current refund process through calling refundByOwnerOrAdmin)

### **C: Sad Path (bridging from intermediary to destination chain fails)**

Intermediary token will be sent to across admin. Then we can refund BTC to user through the refund admin, following our current refund process (TODO: what is the current process?)

### **D: Sad Path (**intermediaryToken → destToken swap **fails on destChain)**

Refund BTC to user (handled by refund admin). Ideally, the refund admin should be able to perform all the steps below in a single transaction on the destination chain, initiating a request to swap the intermediaryToken back to BTC.

1. Bridge intermediary token back to intermediary chain.

    **D1: Sad Path:** If bridging fails here, intermediary tokens will be refunded to the across admin’s address on the destChain and admin can refund manually. (TODO: is manual refund in this case ok?)

2. Swap intermediaryToken → TeleBTC.

    **D2: Sad Path**: The swap fails.

3. Unwrap TeleBTC → BTC.

```mermaid
sequenceDiagram
  title Bitcoin → DestChain Transaction Flow (Sad Path D - Swap Fails on Dest Chain)
  participant EthConnector as EthConnector<br/>(Ethereum/Solana)
  participant DexConnectorDest as DexConnector<br/>(Ethereum/Solana)
  participant Admin as Admin
  participant Across as Across Bridge
  participant PolyConnector as PolyConnector<br/>(Polygon/Bsc)
  participant BurnRouter as BurnRouter
  participant DexConnectorPoly as DexConnector<br/>(Polygon/Bsc)
  participant LockersManager as LockersManager

  Note over EthConnector,DexConnectorDest: ... (Previous processes:<br/>wrapAndSwapUniversal on intermediary chain,<br/>bridge to destination chain)

  EthConnector->>DexConnectorDest: swap(Intermediary Token → Dest Token)
  DexConnectorDest-->>EthConnector: Swap failed
  EthConnector-->>EthConnector: event: FailedWrapAndSwapToDestChain
  Note over EthConnector: Saves failed request<br/>in newFailedWrapAndSwapReqs

  Admin->>EthConnector: swapBackAndRefundBTCByAdmin()
  Note over EthConnector: Validates & retrieves<br/>failed request amount
  EthConnector-->>EthConnector: event: SwappedBackAndRefundedBTCUniversal
  Note over Across: Cross-chain bridge<br/>to intermediary chain

  Across->>PolyConnector: handleV3AcrossMessage(intermediaryToken, message)
  PolyConnector-->>PolyConnector: event: MsgReceived("swapBackAndRefundBTC")
  Note over PolyConnector: Decodes message,<br/>validates path & amounts
  PolyConnector->>BurnRouter: swapAndUnwrap(intermediaryToken → TeleBTC)
  BurnRouter->>DexConnectorPoly: swap(Intermediary Token → TeleBTC)
  DexConnectorPoly-->>BurnRouter: Swap successful
  BurnRouter->>LockersManager: burn(TeleBTC)
  Note over LockersManager: Burns TeleBTC,<br/>records burn request<br/>for BTC refund
  PolyConnector-->>PolyConnector: event: NewSwapAndUnwrapUniversal<br/>(Differentiated from normal swapAndUnwrap<br/>by uniqueId being bitcoin txId<br/>rather than a counter)
```

### **D2: Sad Path (**Swapping intermediaryToken → TeleBTC fails in a BTC refund)

If the swap fails here, intermediary tokens will remain in the intermediary chain’s connector contract. The refund admin can then swap to TeleBTC and refund BTC to user.

```mermaid
sequenceDiagram
  title Bitcoin → DestChain Transaction Flow (Sad Path D2 - Swap to TeleBTC Fails on Intermediary Chain)
  participant PolyConnector as PolyConnector<br/>(Polygon/Bsc)
  participant BurnRouter as BurnRouter
  participant DexConnectorPoly as DexConnector<br/>(Polygon/Bsc)
  participant Admin as Admin
  participant LockersManager as LockersManager

  Note over PolyConnector,DexConnectorPoly: ... (Previous processes:<br/>wrapAndSwapUniversal on intermediary chain,<br/>bridge to destination chain,<br/>swap fails on destination chain,<br/>admin calls swapBackAndRefundBTCByAdmin<br/>on EthConnector, bridge back to intermediary chain)

  PolyConnector->>BurnRouter: swapAndUnwrap(intermediaryToken → TeleBTC)
  BurnRouter->>DexConnectorPoly: swap(Intermediary Token → TeleBTC)
  DexConnectorPoly-->>BurnRouter: Swap failed
  Note over BurnRouter: _exchange reverts<br/>(require(result, "exchange failed"))
  BurnRouter-->>PolyConnector: Revert
  Note over PolyConnector: Catch block saves amount<br/>in newFailedRefundBTCReqs
  PolyConnector-->>PolyConnector: event: FailedSwapAndUnwrapUniversal<br/>(Differentiated from normal swapAndUnwrap<br/>by uniqueId being bitcoin txId<br/>rather than a counter)

  Admin->>PolyConnector: swapBackAndRefundBTCByAdmin()
  Note over PolyConnector: Validates & retrieves<br/>failed request amount
  PolyConnector->>BurnRouter: swapAndUnwrap(intermediaryToken → TeleBTC)
  BurnRouter->>DexConnectorPoly: swap(Intermediary Token → TeleBTC)
  DexConnectorPoly-->>BurnRouter: Swap successful
  BurnRouter->>LockersManager: burn(TeleBTC)
  Note over LockersManager: Burns TeleBTC,<br/>records burn request<br/>for BTC refund
  PolyConnector-->>PolyConnector: event: NewSwapAndUnwrapUniversal<br/>(Differentiated from normal swapAndUnwrap<br/>by uniqueId being bitcoin txId<br/>rather than counter)
```

## **SourceChain → Bitcoin**

Sections A to D and their sub-sections (e.g. D1, …) can be used as the different states of a “swap and unwrap universal” transaction.

### **A: Happy Path**

1. Swap sourceToken → intermediaryToken (on sourceChain).
2. Bridge intermediaryToken → Polygon. We send intermediaryToken with a message to the TeleSwap contract on Polygon, which swaps it for TeleBTC and unwraps TeleBTC for the user.
3. Swap intermediaryToken → TeleBTC (on Polygon).
4. Deliver BTC to user (Unwrap TeleBTC → BTC)

```mermaid
sequenceDiagram
  title Source Chain → Bitcoin Transaction Flow (Happy Path)
  participant User as User
  participant EthConnector as EthConnector<br/>(Ethereum/Solana)
  participant DexConnectorSource as DexConnector<br/>(Ethereum/Solana)
  participant Across as Across Bridge
  participant PolyConnector as PolyConnector<br/>(Polygon/Bsc)
  participant BurnRouter as BurnRouter
  participant DexConnectorPoly as DexConnector<br/>(Polygon/Bsc)
  participant LockersManager as LockersManager

  User->>EthConnector: swapAndUnwrapUniversal()
  Note over EthConnector: Validates message value,<br/>extracts intermediary token
  EthConnector->>DexConnectorSource: swap(Input Token → Intermediary Token)
  DexConnectorSource-->>EthConnector: Swap successful
  EthConnector-->>EthConnector: event: MsgSent("swapAndUnwrapUniversal")
  EthConnector->>Across: deposit/depositV3(intermediaryToken + message)
  Note over Across: Cross-chain bridge<br/>to intermediary chain

  Across->>PolyConnector: handleV3AcrossMessage(intermediaryToken, message)
  PolyConnector-->>PolyConnector: event: MsgReceived("swapAndUnwrapUniversal")
  Note over PolyConnector: Decodes message,<br/>validates path & amounts
  PolyConnector->>BurnRouter: swapAndUnwrap(intermediaryToken → TeleBTC)
  BurnRouter->>DexConnectorPoly: swap(Intermediary Token → TeleBTC)
  DexConnectorPoly-->>BurnRouter: Swap successful
  BurnRouter->>LockersManager: burn(TeleBTC)
  Note over LockersManager: Burns TeleBTC,<br/>records burn request<br/>for BTC refund
  PolyConnector-->>PolyConnector: event: NewSwapAndUnwrapUniversal
```

### **B: Sad Path (**sourceToken → intermediaryToken swap **fails on sourceChain)**

Refund sourceToken to user (call reverts)

### **C: Sad Path (bridging from source to destination chain fails)**

When the bridge fails, intermediary token will be sent to across admin. Then we can refund the input token to user through the refund admin. (TODO: can it be manual?)

### **D: Sad Path (**intermediaryToken → TeleBTC swap **fails on the intermediary chain)**

Refund sourceToken to user (handled by refund admin). Ideally, the refund admin should be able to perform all the steps below in a single transaction on Polygon, initiating a request to swap the intermediaryToken back to sourceToken.

1. Bridge intermediaryToken back to sourceChain

    **D1: Sad Path:** If bridging fails here, intermediary tokens will be refunded to the across admin’s address on the intermediary chain and admin can manually refund input token on source chain to user (TODO: manual refund is ok?)

2. Swap intermediaryToken → sourceToken.

    **D2: Sad Path**: The swap fails.

3. Refund sourceToken to user.

```mermaid
sequenceDiagram
  title Source Chain → Bitcoin Transaction Flow (Sad Path - Swap to TeleBTC Fails)
  participant PolyConnector as PolyConnector<br/>(Polygon/Bsc)
  participant BurnRouter as BurnRouter
  participant DexConnectorPoly as DexConnector<br/>(Polygon/Bsc)
  participant Admin as Admin
  participant Across as Across Bridge
  participant EthConnector as EthConnector<br/>(Ethereum/Solana)
  participant DexConnectorSource as DexConnector<br/>(Ethereum/Solana)
  participant User as User

  Note over PolyConnector,DexConnectorPoly: ... (Previous processes:<br/>swapAndUnwrapUniversal on source chain,<br/>swap input token to intermediary token,<br/>bridge to intermediary chain)

  PolyConnector->>BurnRouter: swapAndUnwrap(intermediaryToken → TeleBTC)
  BurnRouter->>DexConnectorPoly: swap(Intermediary Token → TeleBTC)
  DexConnectorPoly-->>BurnRouter: Swap failed
  Note over BurnRouter: _exchange reverts<br/>(require(result, "exchange failed"))
  BurnRouter-->>PolyConnector: Revert
  Note over PolyConnector: Catch block saves amount<br/>in newFailedUniversalSwapAndUnwrapReqs
  PolyConnector-->>PolyConnector: event: FailedSwapAndUnwrapUniversal

  Admin->>PolyConnector: withdrawFundsToSourceChainByAdminUniversal()
  Note over PolyConnector: Validates & retrieves<br/>failed request amount
  PolyConnector-->>PolyConnector: event: WithdrewFundsToSourceChainUniversal
  PolyConnector->>Across: deposit(intermediaryToken + message)
  Note over Across: Cross-chain bridge<br/>back to source chain

  Across->>EthConnector: handleV3AcrossMessage(intermediaryToken, message)
  EthConnector-->>EthConnector: event: MsgReceived("swapBackAndRefund")
  Note over EthConnector: Decodes message,<br/>validates path & amounts
  EthConnector->>DexConnectorSource: swap(Intermediary Token → Input Token)
  DexConnectorSource-->>EthConnector: Swap successful
  EthConnector->>User: safeTransfer(inputToken, amount)
  EthConnector-->>EthConnector: event: swappedBackAndRefundedToSourceChain
```

### **D2: Sad Path (intermediary token swap to input token on the source chain fails)**

The failed swap back and refund request will be saved in the source chain’s connector proxy contract and the refund admin can call a function to retry swap and refund to user.
