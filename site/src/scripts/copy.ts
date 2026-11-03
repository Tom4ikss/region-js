/** Copies text to the clipboard, with a fallback for contexts where the Clipboard API is missing. */
export function copyText(text: string): Promise<void> {
	if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
	return new Promise((resolve, reject) => {
		const area = document.createElement('textarea');
		area.value = text;
		area.setAttribute('readonly', '');
		area.style.position = 'fixed';
		area.style.opacity = '0';
		document.body.appendChild(area);
		area.select();
		try {
			if (document.execCommand('copy')) resolve();
			else reject(new Error('copy failed'));
		} catch (e) {
			reject(e);
		} finally {
			document.body.removeChild(area);
		}
	});
}
