import DOMPurify from 'dompurify';
import { sandboxDocument } from './api';

/** Static HTML only. Keep the original content untouched for source and download. */
export function artifactPreview(content: string): string {
  const clean = DOMPurify.sanitize(`<div>${content}</div>`, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      'script',
      'iframe',
      'object',
      'embed',
      'form',
      'input',
      'button',
      'select',
      'textarea',
      'video',
      'audio',
      'link',
      'meta',
      'base',
    ],
    // Sandbox/CSP block execution and fetches; removing navigation attributes
    // additionally prevents the isolated frame from navigating itself away.
    FORBID_ATTR: ['href', 'xlink:href', 'srcdoc', 'action', 'formaction', 'ping'],
  });
  return sandboxDocument(clean);
}
