/**
 * Base execution via Privy's native swap API.
 *
 *   privy.wallets().swaps().quote(walletId, { source, destination, base_amount,
 *                                             amount_type, slippage_bps, authorization_context })
 *   privy.wallets().swaps().execute(walletId, { ...same, authorization_context })
 *
 * Note the accessor is `wallets().swaps()` (plural) — verified against
 * `node_modules/@privy-io/node/public-api/services/wallets.d.ts` and `swaps.d.ts`.
 * `asset_address: 'native'` means ETH.
 */
import type { AgentWalletRef } from "@/lib/x402/types";
import { fromBaseUnits, toBaseUnits, type Fill, type Quote, type TradeExecutor, type TradeRequest } from "./executor";
import { CAIP2_BASE, USDC_BASE } from "./tokens";
import { getPriceUsd } from "./prices";

const USDC_DECIMALS = 6;

interface SwapLegs {
  source: { caip2: string; asset_address: string };
  destination: { caip2: string; asset_address: string };
  base_amount: string;
  amount_type: "exact_input";
  slippage_bps: number;
}

export class BaseSwapExecutor implements TradeExecutor {
  readonly venue = "privy-base" as const;
  readonly isPaper = false;
  private readonly wallet: AgentWalletRef;

  constructor(wallet: AgentWalletRef) {
    this.wallet = wallet;
  }

  private async legs(req: TradeRequest): Promise<SwapLegs> {
    const isBuy = req.side === "buy";
    if (isBuy) {
      return {
        source: { caip2: CAIP2_BASE, asset_address: USDC_BASE },
        destination: { caip2: CAIP2_BASE, asset_address: req.tokenAddress },
        base_amount: toBaseUnits(req.amountUsd, USDC_DECIMALS),
        amount_type: "exact_input",
        slippage_bps: req.slippageBps,
      };
    }
    const price = await getPriceUsd("base", req.tokenAddress);
    if (price === null || price <= 0) throw new Error(`No price for ${req.symbol} on Base — cannot size the sell.`);
    return {
      source: { caip2: CAIP2_BASE, asset_address: req.tokenAddress },
      destination: { caip2: CAIP2_BASE, asset_address: USDC_BASE },
      base_amount: toBaseUnits(req.amountUsd / price, req.decimals),
      amount_type: "exact_input",
      slippage_bps: req.slippageBps,
    };
  }

  async quote(req: TradeRequest): Promise<Quote> {
    const legs = await this.legs(req);
    const { privy, authorizationContext } = await import("@/lib/privy");
    const quoted = await privy()
      .wallets()
      .swaps()
      .quote(this.wallet.walletId, { ...legs, authorization_context: authorizationContext() });

    const isBuy = req.side === "buy";
    const inAmount = fromBaseUnits(quoted.input_amount, isBuy ? USDC_DECIMALS : req.decimals);
    const outAmount = fromBaseUnits(quoted.est_output_amount, isBuy ? req.decimals : USDC_DECIMALS);
    const amountToken = isBuy ? outAmount : inAmount;
    const amountUsd = isBuy ? inAmount : outAmount;

    return {
      request: req,
      venue: "privy-base",
      priceUsd: amountToken > 0 ? amountUsd / amountToken : 0,
      amountToken,
      amountUsd,
      feeUsd: 0,
      handle: legs,
    };
  }

  async execute(quote: Quote): Promise<Fill> {
    const legs = quote.handle as SwapLegs;
    const { privy, authorizationContext } = await import("@/lib/privy");
    try {
      const action = await privy()
        .wallets()
        .swaps()
        .execute(this.wallet.walletId, { ...legs, authorization_context: authorizationContext() });

      const isBuy = quote.request.side === "buy";
      const inAmount = action.input_amount
        ? fromBaseUnits(action.input_amount, isBuy ? USDC_DECIMALS : quote.request.decimals)
        : null;
      const outAmount = action.output_amount
        ? fromBaseUnits(action.output_amount, isBuy ? quote.request.decimals : USDC_DECIMALS)
        : null;
      const amountToken = (isBuy ? outAmount : inAmount) ?? quote.amountToken;
      const amountUsd = (isBuy ? inAmount : outAmount) ?? quote.amountUsd;
      const txHash = readTxHash(action);

      return {
        status: "filled",
        txHash,
        priceUsd: amountToken > 0 ? amountUsd / amountToken : quote.priceUsd,
        amountToken,
        amountUsd,
        feeUsd: 0,
      };
    } catch (err) {
      return {
        status: "failed",
        txHash: null,
        priceUsd: quote.priceUsd,
        amountToken: quote.amountToken,
        amountUsd: quote.amountUsd,
        feeUsd: 0,
        error: err instanceof Error ? err.message : "Privy swap failed",
      };
    }
  }
}

/** Privy returns the hash under different keys depending on the action state. */
function readTxHash(action: unknown): string | null {
  if (!action || typeof action !== "object") return null;
  const a = action as Record<string, unknown>;
  for (const key of ["transaction_hash", "hash", "transaction_id", "id"]) {
    const v = a[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}
