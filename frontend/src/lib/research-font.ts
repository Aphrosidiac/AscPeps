import { IBM_Plex_Sans } from 'next/font/google';

/** Research is set in IBM Plex Sans (Teliti's face, 400 and 500 only), self-hosted by next/font and
 *  scoped to the section: each `.rs` root carries this class, so the admin preview gets it too. */
export const researchFont = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex', display: 'swap' });
