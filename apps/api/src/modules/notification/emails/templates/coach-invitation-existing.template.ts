import { EmailLanguage, EmailPropsFromId } from '@openathlete/shared';

import { Language } from 'src/common/constants/languages.constant';

import { button, heading, note, paragraph } from '../core/blocks';
import { renderEmail } from '../core/layout';
import { describeCoachInvitation } from './coach-invitation-purpose';

const translations = {
  ES: {
    title: 'Nueva invitación de entrenador',
    buttonLabel: 'Ver invitaciones',
    linkNote: (url: string) =>
      `Si el botón no funciona, copia y pega este enlace en tu navegador: ${url}`,
    settingsNote:
      'Puedes gestionar todas tus invitaciones en la sección Ajustes de tu cuenta.',
  },
  FR: {
    title: 'Nouvelle invitation de coach',
    buttonLabel: 'Voir les invitations',
    linkNote: (url: string) =>
      `Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur : ${url}`,
    settingsNote:
      'Vous pouvez gérer toutes vos invitations dans la section Paramètres de votre compte.',
  },
  EN: {
    title: 'New coach invitation',
    buttonLabel: 'View invitations',
    linkNote: (url: string) =>
      `If the button doesn't work, copy and paste this link into your browser: ${url}`,
    settingsNote:
      'You can manage all your invitations in the Settings section of your account.',
  },
  IT: {
    title: 'Nuovo invito come coach',
    buttonLabel: 'Visualizza gli inviti',
    linkNote: (url: string) =>
      `Se il pulsante non funziona, copia e incolla questo link nel tuo browser: ${url}`,
    settingsNote:
      'Puoi gestire tutti i tuoi inviti nella sezione Impostazioni del tuo account.',
  },
  PT_BR: {
    title: 'Novo convite de treinador',
    buttonLabel: 'Ver convites',
    linkNote: (url: string) =>
      `Se o botão não funcionar, copie e cole este link no seu navegador: ${url}`,
    settingsNote:
      'Você pode gerenciar todos os seus convites na seção Configurações da sua conta.',
  },
} as const;

export function buildCoachInvitationExistingEmail({
  athleteName,
  url,
  language = Language.FR,
  purpose = 'PERSONAL',
  athleteCount,
}: EmailPropsFromId<'coach-invitation-existing'> & {
  language?: EmailLanguage;
}) {
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
    note(t.settingsNote),
  ];

  return renderEmail({ language, title, preview, blocks });
}
