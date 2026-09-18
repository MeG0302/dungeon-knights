import MenuClient from './client';

export const metadata = {
  title: 'Squad Management',
  description:
    'Manage your knight squad: sort and filter by rarity, power, speed and stamina, select up to 15 knights and deploy them into the dungeons.',
  alternates: { canonical: '/menu' },
  openGraph: {
    url: '/menu',
    title: 'Squad Management | Dungeon Knights',
    description:
      'Select up to 15 knights and deploy them into the dungeons.',
  },
};

export default function MenuPage() {
  return <MenuClient />;
}
