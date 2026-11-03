// Redirects from the old English URLs (/region-js/spawn.html), see src/lib/legacy.ts.
import type { APIRoute } from 'astro';
import { legacyPaths, redirectPage } from '../lib/legacy';

export const getStaticPaths = legacyPaths;
export const GET: APIRoute = ({ params }) => redirectPage('en', params.slug!);
