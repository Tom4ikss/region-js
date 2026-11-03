// @ts-check
import { defineConfig, passthroughImageService } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import { BASE, GITHUB, GROUPS, PAGES, SITE } from './src/lib/site.mjs';
import remarkRegionDocs from './src/plugins/remark-region-docs.mjs';
import rehypeRegionDocs from './src/plugins/rehype-region-docs.mjs';

// Sidebar groups in the old site's order. The landing page is the first item of the first group.
const sidebar = GROUPS.map((group, i) => ({
	label: group.en,
	translations: { ru: group.ru },
	items: PAGES.filter((p) => p.group === i).map((p) => p.slug),
}));

export default defineConfig({
	// Static output only; nothing here needs a server.
	output: 'static',
	site: SITE,
	base: BASE,
	trailingSlash: 'ignore',
	// No image optimisation: the site has a handful of SVGs and no native image dependency.
	image: { service: passthroughImageService() },
	// No telemetry from the dev toolbar, no external requests.
	devToolbar: { enabled: false },
	markdown: {
		// The remark pipeline, so the pages can use ordinary remark and rehype plugins. Text is kept
		// exactly as written: no smart quotes or dashes.
		processor: unified({
			remarkPlugins: [remarkRegionDocs],
			rehypePlugins: [rehypeRegionDocs],
			smartypants: false,
		}),
	},
	integrations: [
		starlight({
			title: { en: 'Ownership regions in V8', ru: 'Регионы владения в V8' },
			description: 'region-js: a research fork of V8 with ownership regions. Parallel JavaScript without copies.',
			logo: { src: './src/assets/logo.svg', alt: '' },
			favicon: '/favicon.svg',
			defaultLocale: 'root',
			locales: {
				root: { label: 'English', lang: 'en' },
				ru: { label: 'Русский', lang: 'ru' },
			},
			social: [{ icon: 'github', label: 'GitHub', href: GITHUB }],
			sidebar,
			tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
			lastUpdated: false,
			credits: false,
			pagination: true,
			customCss: [
				'@fontsource-variable/golos-text/wght.css',
				'@fontsource-variable/jetbrains-mono/wght.css',
				'@fontsource-variable/unbounded/wght.css',
				'./src/styles/theme.css',
				'./src/styles/docs.css',
				'./src/styles/diagrams.css',
			],
			components: {
				Head: './src/components/overrides/Head.astro',
				Header: './src/components/overrides/Header.astro',
				Hero: './src/components/overrides/Hero.astro',
				PageTitle: './src/components/overrides/PageTitle.astro',
				LanguageSelect: './src/components/overrides/LanguageSelect.astro',
				Footer: './src/components/overrides/Footer.astro',
				Sidebar: './src/components/overrides/Sidebar.astro',
			},
			expressiveCode: {
				themes: ['github-dark', 'github-light'],
				styleOverrides: {
					borderRadius: '0.875rem',
					borderColor: 'var(--rj-border)',
					codeBackground: 'var(--rj-code-bg)',
					codeFontFamily: 'var(--__sl-font-mono)',
					codeFontSize: '0.84rem',
					codeLineHeight: '1.65',
					uiFontFamily: 'var(--__sl-font)',
					frames: {
						shadowColor: 'transparent',
						frameBoxShadowCssValue: 'none',
						editorBackground: 'var(--rj-code-bg)',
						terminalBackground: 'var(--rj-out-bg)',
						terminalTitlebarBackground: 'var(--rj-surface-2)',
						terminalTitlebarBorderBottomColor: 'var(--rj-border)',
						terminalTitlebarDotsOpacity: '1',
						terminalTitlebarDotsForeground: 'var(--rj-dots)',
						inlineButtonBorder: 'var(--rj-border)',
						tooltipSuccessBackground: 'var(--rj-good)',
					},
				},
			},
		}),
	],
});
