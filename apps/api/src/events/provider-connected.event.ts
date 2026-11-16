export class ProviderConnectedEvent {
  static readonly SLUG = 'provider.connected';

  constructor(
    public readonly athleteId: number,
    public readonly provider: 'WAHOO' | 'GARMIN',
  ) {}
}
