import './globals.css';

export const metadata = {
  title: 'Medika Admin',
  description: 'Panneau d\'administration Medika',
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}