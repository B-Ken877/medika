import './globals.css';

export const metadata = {
  title: 'Medika Admin — Panneau d\'administration',
  description: 'Panneau d\'administration de la plateforme de télémédecine Medika',
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
