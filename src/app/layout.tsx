import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Excalibur: Earth — Earth is the server',
  description: 'A real-Earth 3D online world. Explore Lagos street by street, meet its people, live the city. Free, in your browser, on mobile and desktop.',
  applicationName: 'Excalibur: Earth',
  other: { 'mobile-web-app-capable': 'yes', 'apple-mobile-web-app-status-bar-style': 'black-translucent' }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0b0e13'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
