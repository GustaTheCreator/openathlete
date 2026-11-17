import { EmailLanguage, EmailPropsFromId } from '@openathlete/shared';

import { Language } from 'src/common/constants/languages.constant';

import { button, heading, note, paragraph } from '../core/blocks';
import { renderEmail } from '../core/layout';
import { describeCoachInvitation } from './coach-invitation-purpose';

const translations = {
  ES: {
    title: 'Invitación para unirte a OpenAthlete',
    buttonLabel: 'Crear mi cuenta',
    linkNote: (url: string) =>
      `Si el botón no funciona, copia y pega este enlace en tu navegador: ${url}`,
    expiryNote:
      'Esta invitación es válida durante 7 días. Si no te interesa, puedes ignorar este correo.',
  },
  FR: {
    title: 'Invitation à rejoindre OpenAthlete',
    buttonLabel: 'Créer mon compte',
    linkNote: (url: string) =>
      `Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur : ${url}`,
    expiryNote:
      "Cette invitation est valable pendant 7 jours. Si vous n'êtes pas intéressé, vous pouvez ignorer cet email.",
  },
  EN: {
    title: 'Invitation to join OpenAthlete',
    buttonLabel: 'Create my account',
    linkNote: (url: string) =>
      `If the button doesn't work, copy and paste this link into your browser: ${url}`,
    expiryNote:
      'This invitation is valid for 7 days. If you are not interested, you can ignore this email.',
  },
  IT: {
    title: 'Invito a unirsi a OpenAthlete',
    buttonLabel: 'Crea il mio account',
    linkNote: (url: string) =>
      `Se il pulsante non funziona, copia e incolla questo link nel tuo browser: ${url}`,
    expiryNote:
      'Questo invito è valido per 7 giorni. Se non sei interessato, puoi ignorare questa email.',
  },
  PT_BR: {
    title: 'Convite para entrar no OpenAthlete',
    buttonLabel: 'Criar minha conta',
    linkNote: (url: string) =>
      `Se o botão não funcionar, copie e cole este link no seu navegador: ${url}`,
    expiryNote:
      'Este convite é válido por 7 dias. Se não tiver interesse, você pode ignorar este e-mail.',
  },
} as const;

export function buildCoachInvitationNewEmail({
  athleteName,
  url,
  language = Language.FR,
  purpose = 'PERSONAL',
  athleteCount,
}: EmailPropsFromId<'coach-invitation-new'> & { language?: EmailLanguage }) {
  const t = translations[language];
  const title = t.title;
  const preview = describeCoachInvitation(
    language,
    purpose,
    athleteName,
    athleteCount,
  );

  const blocks = [
    heading(title),
    paragraph(preview),
    button({ href: url, label: t.buttonLabel }),
    note(t.linkNote(url)),
    note(t.expiryNote),
  ];

  return renderEmail({ language, title, preview, blocks });
}
