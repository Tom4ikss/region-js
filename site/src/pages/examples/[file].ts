// Raw English example files: /region-js/examples/<file>.
import type { APIRoute } from 'astro';
import { exampleFiles, rawExample } from '../../lib/examples';

export const getStaticPaths = () => exampleFiles('en').map((file) => ({ params: { file } }));
export const GET: APIRoute = ({ params }) => rawExample('en', params.file!);
