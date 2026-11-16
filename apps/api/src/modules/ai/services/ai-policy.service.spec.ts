import { AiPolicyService } from './ai-policy.service';

describe('AiPolicyService', () => {
  const policy = (values: Record<string, unknown>) =>
    new AiPolicyService({
      get: (key: string) => values[key],
    } as never);

  it('requires an explicit opt-in for user-defined endpoints', () => {
    expect(policy({}).customEndpointsAllowed).toBe(false);
  });

  it('honors the operator opt-in on a self-hosted instance', () => {
    expect(
      policy({ AI_ALLOW_CUSTOM_ENDPOINTS: true }).customEndpointsAllowed,
    ).toBe(true);
  });

  it('honors an explicit opt-out', () => {
    expect(
      policy({ AI_ALLOW_CUSTOM_ENDPOINTS: false }).customEndpointsAllowed,
    ).toBe(false);
  });
});
