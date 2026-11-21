// Picks the translation provider chosen in Settings.

import { suggestTranslation as claudeTranslate, DEFAULT_MODEL as CLAUDE_DEFAULT_MODEL } from './ai.bundle.js';
import { geminiTranslate, GEMINI_DEFAULT_MODEL } from './gemini.js';
import { googleTranslate } from './google-translate.js';

export const PROVIDERS = {
  claude: { label: 'Claude (Anthropic)', defaultModel: CLAUDE_DEFAULT_MODEL },
  gemini: { label: 'Gemini (Google AI)', defaultModel: GEMINI_DEFAULT_MODEL },
  google: { label: 'Google Translate', defaultModel: null },
};

export { CLAUDE_DEFAULT_MODEL, GEMINI_DEFAULT_MODEL };

/** settings: the extension settings object. Returns { questionHtml, stepsHtml }. */
export function suggest(settings, language, question) {
  const provider = settings.provider || 'claude';
  const common = { language, glossary: settings.glossary, question };
  if (provider === 'gemini') {
    return geminiTranslate({ ...common, apiKey: settings.geminiKey, model: settings.geminiModel || GEMINI_DEFAULT_MODEL });
  }
  if (provider === 'google') {
    return googleTranslate({ ...common, apiKey: settings.googleKey });
  }
  return claudeTranslate({ ...common, apiKey: settings.apiKey, model: settings.model || CLAUDE_DEFAULT_MODEL });
}
