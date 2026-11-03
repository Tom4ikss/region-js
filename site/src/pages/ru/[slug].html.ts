// Redirects from the old Russian URLs (/region-js/ru/spawn.html), see src/lib/legacy.ts.
import type { APIRoute } from 'astro';
import { legacyPaths, redirectPage } from '../../lib/legacy';

export const getStaticPaths = legacyPaths;
export const GET: APIRoute = ({ params }) => redirectPage('ru', params.slug!);
