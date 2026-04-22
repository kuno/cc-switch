export interface QuotaWindow {
  name: string;
  status?: string | null;
  utilization?: number | null;
  reset?: number | null;
}

export interface BalanceSnapshot {
  plan_name?: string | null;
  currency?: string | null;
  total?: number | null;
  used?: number | null;
  remaining?: number | null;
  is_valid?: boolean | null;
  invalid_message?: string | null;
}

export interface ProviderQuotaSnapshot {
  app_type: string;
  provider_id: string;
  provider_name: string;
  source?: string | null;
  status?: string | null;
  windows: QuotaWindow[];
  balances?: BalanceSnapshot[] | null;
  representative_claim?: string | null;
  overage_status?: string | null;
  fallback_percentage?: number | null;
  requests_remaining?: number | null;
  requests_limit?: number | null;
  tokens_remaining?: number | null;
  tokens_limit?: number | null;
  captured_at: number;
}

export interface QuotaResponse {
  providers: ProviderQuotaSnapshot[];
  timestamp: string;
}
