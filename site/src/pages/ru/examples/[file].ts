// Raw Russian example files: /region-js/ru/examples/<file>.
import type { APIRoute } from 'astro';
import { exampleFiles, rawExample } from '../../../lib/examples';

export const getStaticPaths = () => exampleFiles('ru').map((file) => ({ params: { file } }));
export const GET: APIRoute = ({ params }) => rawExample('ru', params.file!);
