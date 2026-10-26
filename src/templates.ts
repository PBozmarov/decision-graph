import { makeItem, sampleItems, type Item, type Kind } from './model';

export type Template = {
  id: string;
  title: string;
  subtitle: string;
  kind: Kind; // icon/color for the tile
  build: () => Item[];
};

/** Small builder so templates read like outlines. */
function outline(fn: (add: (parent: Item | null, kind: Kind, title: string, extra?: Partial<Item>) => Item) => void) {
  const out: Item[] = [];
  fn((parent, kind, title, extra = {}) => {
    const it = { ...makeItem(parent?.id ?? null, kind, title), ...extra };
    out.push(it);
    return it;
  });
  return out;
}

const jobOffer = () =>
  outline((add) => {
    const root = add(null, 'problem', 'Should I take the new job offer?');

    const accept = add(root, 'option', 'Accept the offer');
    add(accept, 'requirement', 'Notice period fits the start date');
    add(accept, 'pro', 'About 20% higher salary', { weight: 4 });
    add(accept, 'pro', 'Bigger scope and room to grow', { weight: 4 });
    add(accept, 'con', 'Longer commute', { weight: 2 });
    add(accept, 'risk', 'Team culture is an unknown', { weight: 3 });
    add(accept, 'action', 'Talk to someone already on the team');

    const stay = add(root, 'option', 'Stay where I am');
    add(stay, 'pro', 'I know the team and the codebase', { weight: 3 });
    add(stay, 'pro', 'Promotion likely next cycle', { weight: 3 });
    add(stay, 'con', 'Growth has slowed down', { weight: 3 });
    add(stay, 'risk', 'The promotion might not happen', { weight: 2 });

    const negotiate = add(root, 'option', 'Negotiate with my current employer');
    add(negotiate, 'pro', 'Could get a raise without switching', { weight: 3 });
    add(negotiate, 'risk', 'Relationship with my manager could get awkward', { weight: 2 });
    add(negotiate, 'action', 'Prepare the case for a counter-offer');
  });

const buyOrRent = () =>
  outline((add) => {
    const root = add(null, 'problem', 'Buy a home or keep renting?');

    const buy = add(root, 'option', 'Buy a home');
    add(buy, 'requirement', '20% down payment saved');
    add(buy, 'requirement', 'Stable income for the next 5+ years', { met: true, must: true });
    add(buy, 'pro', 'Building equity instead of paying rent', { weight: 4 });
    add(buy, 'pro', 'Freedom to renovate', { weight: 2 });
    add(buy, 'con', 'Big upfront costs and fees', { weight: 4 });
    add(buy, 'risk', 'Prices could fall', { weight: 3 });
    add(buy, 'action', 'Get a mortgage pre-approval');

    const rent = add(root, 'option', 'Keep renting');
    add(rent, 'pro', 'Flexibility to move', { weight: 4 });
    add(rent, 'pro', 'No maintenance costs', { weight: 2 });
    add(rent, 'con', 'Rent keeps going up', { weight: 3 });
    add(rent, 'risk', 'Landlord could decide to sell', { weight: 2 });

    const later = add(root, 'option', 'Rent now, buy in two years');
    add(later, 'pro', 'Time to save a bigger deposit', { weight: 3 });
    add(later, 'con', 'Two more years of rent', { weight: 2 });
    add(later, 'action', 'Set up an automatic savings plan');
  });

export const TEMPLATES: Template[] = [
  {
    id: 'tech',
    title: 'Tech choice',
    subtitle: 'Pick a database: Postgres, Mongo or Dynamo',
    kind: 'option',
    build: sampleItems,
  },
  {
    id: 'job',
    title: 'Job offer',
    subtitle: 'Accept, stay, or negotiate',
    kind: 'action',
    build: jobOffer,
  },
  {
    id: 'home',
    title: 'Buy vs. rent',
    subtitle: 'Buy now, keep renting, or wait',
    kind: 'requirement',
    build: buyOrRent,
  },
];
