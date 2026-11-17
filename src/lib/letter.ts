// Builds a permission or notice letter for a landlord or HOA. Pure function so
// the wording is unit-tested and never leaves the reader's browser.

import { effectiveStatus, formatDate, type StateRecord } from './law.ts';

export interface LetterInput {
  recipientType: 'landlord' | 'hoa';
  senderName: string;
  senderAddress: string;
  recipientName: string;
  /** e.g. "Hoymiles HiFlow Pro kit, two 400 W panels" */
  device: string;
  watts: number;
  /** Where and how it will be mounted. */
  location: string;
  /** Free text, e.g. "UL 3700 (certificate attached)". */
  certification: string;
  date: string; // ISO
  state: StateRecord | null;
}

export interface Letter {
  /** "notice" when state law gives the sender a right; otherwise a "request". */
  kind: 'notice' | 'request';
  subject: string;
  body: string;
}

const blank = (value: string, placeholder: string) => value.trim() || `[${placeholder}]`;

export function buildLetter(input: LetterInput): Letter {
  const { state, recipientType } = input;
  const isHoa = recipientType === 'hoa';
  const status = state ? effectiveStatus(state, input.date) : 'none';
  const lawExists = state != null && (status === 'legal' || status === 'legal_soon');
  const protectedHere = lawExists && (isHoa ? state!.hoa_protection : state!.renter_protection);
  const kind: Letter['kind'] = protectedHere ? 'notice' : 'request';
  const cite = state?.bill
    ? [state.bill.name, state.bill.number, state.bill.citation].filter(Boolean).join(', ')
    : null;
  const watts = `${input.watts.toLocaleString('en-US')} watts`;
  const home = isHoa ? 'unit' : 'rental unit';

  const subject = kind === 'notice'
    ? `Notice of plug-in solar device at ${blank(input.senderAddress, 'your address')}`
    : `Request to install a plug-in solar device at ${blank(input.senderAddress, 'your address')}`;

  const paragraphs: string[] = [];

  paragraphs.push(kind === 'notice'
    ? `I am writing to give you written notice that I intend to place a small plug-in solar device at my ${home}. Details are below so you can see exactly what it is and where it will go.`
    : `I am writing to ask for your written permission to place a small plug-in solar device at my ${home}. I have set out the details below, and I am happy to adjust the plan to address any concern you have.`);

  paragraphs.push(
    `What it is: ${blank(input.device, 'make and model')}, with a maximum output of ${watts}. `
    + 'It is a self-contained appliance that plugs into an ordinary outlet. It needs no changes to the building\'s wiring, '
    + 'and it comes down without leaving a trace when I move out.');

  paragraphs.push(`Where it will go: ${blank(input.location, 'location and how it will be secured')}.`);

  paragraphs.push(
    `Safety: The device is certified: ${blank(input.certification, 'certification, e.g. UL 3700')}. `
    + 'It shuts off automatically within a fraction of a second if it is unplugged or the grid goes down, so it cannot energize the plug or the building during an outage. '
    + `At ${watts} it adds at most ${(input.watts / 120).toFixed(1)} amps to one circuit. I can send you the certificate and the manufacturer's installation manual.`);

  if (lawExists && state) {
    const starts = status === 'legal_soon' ? `, which takes effect ${formatDate(state.effective_date)},` : '';
    const law = `${state.name} law (${cite})${starts}`;
    if (protectedHere) {
      // Written in the letter's own voice: the state record's text is addressed to the tenant.
      paragraphs.push(
        `The law: ${law} covers devices like this one. As I understand it, it does not allow `
        + (isHoa ? 'an association to prohibit a qualifying device, though you may set reasonable rules on its size and placement. '
          : 'a covered landlord to prohibit a qualifying device, though you may set reasonable restrictions on its size and placement. ')
        + (state.renter_notice_days && !isHoa ? `This letter is my written notice under that law, sent at least ${state.renter_notice_days} days before installation. ` : '')
        + (state.bill?.url ? `The text is at ${state.bill.url}. ` : '')
        + 'If you would like reasonable conditions, please tell me and I will follow them.');
    } else {
      paragraphs.push(
        `The law: ${law} allows devices like this one to be plugged in without utility approval. `
        + `It leaves the decision about this property with you, which is why I am asking.`);
    }
  } else if (state) {
    paragraphs.push(
      `The law: ${state.name} does not yet have a plug-in solar law, so I will also get any approval my electric utility requires before I plug it in. `
      + 'I am asking you first because nothing goes up without your agreement.');
  }

  paragraphs.push(
    'My commitments: I will install it according to the manufacturer\'s instructions, secure it so it cannot fall or blow loose, '
    + 'keep it within my own space, pay for any damage it causes, and remove it when I leave or if it ever becomes unsafe. '
    + 'I can add it to my renter\'s or homeowner\'s insurance and send you proof if you would like.');

  paragraphs.push(kind === 'notice'
    ? 'Please reply with any reasonable conditions, or sign below to confirm you have received this notice.'
    : 'If this works for you, please sign below or reply in writing. If you have concerns, I would welcome the chance to talk them through.');

  const body = [
    blank(input.senderName, 'Your name'),
    blank(input.senderAddress, 'Your address'),
    '',
    formatDate(input.date),
    '',
    blank(input.recipientName, isHoa ? 'HOA board or manager' : 'Landlord or property manager'),
    '',
    `Re: ${subject}`,
    '',
    `Dear ${blank(input.recipientName, isHoa ? 'Board members' : 'Landlord')},`,
    '',
    paragraphs.join('\n\n'),
    '',
    'Thank you,',
    '',
    blank(input.senderName, 'Your name'),
    '',
    '',
    kind === 'notice' ? 'Received by:' : 'Approved by:',
    '',
    'Name: ______________________________',
    '',
    'Signature: __________________________    Date: ______________',
    '',
    'Conditions, if any: ______________________________________________',
  ].join('\n');

  return { kind, subject, body };
}
