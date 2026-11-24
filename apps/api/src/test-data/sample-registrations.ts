import { COURT_POSITIONS } from '../planner/types';

export const sampleAssociations = [
  { name: 'MENA', primaryContactName: 'Morgan Chen', primaryContactEmail: 'contact.mena@example.test' },
  { name: 'Ariels', primaryContactName: 'Avery Taylor', primaryContactEmail: 'contact.ariels@example.test' },
  { name: 'Manningham', primaryContactName: 'Mackenzie Lee', primaryContactEmail: 'contact.manningham@example.test' },
  { name: 'Whitehorse', primaryContactName: 'Willow Ford', primaryContactEmail: 'contact.whitehorse@example.test' },
  { name: 'Boroondara', primaryContactName: 'Bailey Nguyen', primaryContactEmail: 'contact.boroondara@example.test' },
];

const samplePlayerFirstNames = ['Arielle', 'Briar', 'Calla', 'Daphne', 'Elodie', 'Freya', 'Gemma', 'Harlow', 'Indigo', 'Juniper'];
const samplePlayerLastNames = ['Ashford', 'Bellamy', 'Calder', 'Delaney', 'Ellery', 'Fairchild', 'Gresham'];

export function sampleRegistration(index: number) {
  const isTicketPlayer = index === 69;
  const playerFirstName = isTicketPlayer ? 'Ada' : samplePlayerFirstNames[index % samplePlayerFirstNames.length]!;
  const playerLastName = isTicketPlayer ? 'Ticket' : samplePlayerLastNames[Math.floor(index / samplePlayerFirstNames.length)]!;
  const rank1Index = (index * 2 + Math.floor(index / 8)) % COURT_POSITIONS.length;
  const rank2Index = (rank1Index + 1 + (index % 3)) % COURT_POSITIONS.length;
  const rank3Index = (rank2Index + 1 + (index % 2)) % COURT_POSITIONS.length;
  return {
    isTicketPlayer,
    playerFirstName,
    playerLastName,
    playerNameNormalized: `${playerFirstName} ${playerLastName}`.toLowerCase(),
    association: sampleAssociations[index % sampleAssociations.length]!,
    rank1Position: COURT_POSITIONS[rank1Index],
    rank2Position: COURT_POSITIONS[rank2Index],
    rank3Position: index % 4 === 0 ? null : COURT_POSITIONS[rank3Index],
  };
}
