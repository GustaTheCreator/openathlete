import { EmailLanguage } from '@openathlete/shared';

import { buildCoachInvitationExistingEmail } from './coach-invitation-existing.template';
import { buildCoachInvitationNewEmail } from './coach-invitation-new.template';

describe.each([
  ['new account', buildCoachInvitationNewEmail],
  ['existing account', buildCoachInvitationExistingEmail],
] as const)('coach invitation email: %s', (_, build) => {
  const options = {
    athleteName: 'Ari',
    url: 'https://example.test/invitation',
    language: 'EN' as EmailLanguage,
  };

  it('keeps legacy invitations personal and explains the scope', () => {
    expect(build(options).text).toContain(
      'only their personal athlete profile',
    );
  });

  it('explains that a colleague invitation creates no athlete associations', () => {
    const input = { ...options, purpose: 'COLLEAGUE' as const };
    const email = build(input);
    expect(email.text).toContain('does not link any athlete');
    expect(email.html).not.toContain('invites you to become their coach');
  });

  it.each([
    ['SHARE', 'keeps their access'],
    ['TRANSFER', 'loses only these coaching associations'],
  ] as const)('explains %s before acceptance', (purpose, consequence) => {
    const input = { ...options, purpose, athleteCount: 3 };
    const email = build(input);
    expect(email.text).toContain('3 athletes');
    expect(email.text).toContain(consequence);
    expect(email.text).toContain('history');
  });

  it.each(['EN', 'FR', 'ES', 'IT', 'PT_BR'] as const)(
    'renders every purpose in %s and escapes the sender name',
    (language) => {
      for (const purpose of [
        'PERSONAL',
        'COLLEAGUE',
        'SHARE',
        'TRANSFER',
      ] as const) {
        const input = {
          ...options,
          purpose,
          athleteCount: 2,
          language,
          athleteName: '<script>sender</script>',
        };
        const email = build(input);
        expect(email.text).not.toContain('undefined');
        expect(email.html).not.toContain('<script>sender</script>');
        expect(email.html).toContain('&lt;script&gt;sender&lt;/script&gt;');
      }
    },
  );
});
