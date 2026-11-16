import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { ApiEnvSchemaType } from '@openathlete/shared';

export type HostedAccessPolicy = 'subscribers' | 'everyone' | 'none';

/** Instance-wide AI rules. Custom endpoints require an explicit operator opt-in. */
@Injectable()
export class AiPolicyService {
  constructor(
    private readonly configService: ConfigService<ApiEnvSchemaType, true>,
  ) {}

  private get billingEnabled(): boolean {
    return Boolean(this.configService.get('STRIPE_SECRET_KEY'));
  }

  get hostedAccess(): HostedAccessPolicy {
    return (
      this.configService.get('AI_HOSTED_ACCESS') ??
      (this.billingEnabled ? 'subscribers' : 'everyone')
    );
  }

  /** Monthly spend per user on the instance keys (USD); undefined: no limit. */
  get hostedMonthlyBudgetUsd(): number | undefined {
    return this.configService.get('AI_HOSTED_MONTHLY_BUDGET_USD');
  }

  /** Users may add OpenAI-compatible endpoints and local providers. */
  get customEndpointsAllowed(): boolean {
    return this.configService.get('AI_ALLOW_CUSTOM_ENDPOINTS') ?? false;
  }
}
